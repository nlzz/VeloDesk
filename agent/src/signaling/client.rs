//! Cliente WebSocket assíncrono para sinalização e handshake WebRTC.

use crate::capture::{AutoCapturer, ScreenCapturer};
use crate::config::AgentConfig;
use crate::encoder::{MftEncoder, VideoEncoder};
use crate::input::{DefaultInputInjector, InputInjector};
use crate::protocol::signaling::*;
use crate::webrtc_session::WebRtcSession;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

/// Erros na comunicação com o servidor de sinalização
#[derive(Debug, Error)]
pub enum SignalingError {
    /// Falha na conexão WebSocket inicial
    #[error("Falha ao conectar no servidor de sinalização: {0}")]
    ConnectionFailed(Box<tokio_tungstenite::tungstenite::Error>),
    /// Erro de serialização JSON
    #[error("Erro de codificação JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// Registro rejeitado pelo servidor
    #[error("Registro rejeitado pelo servidor: {0}")]
    RegistrationRejected(String),
}

impl From<tokio_tungstenite::tungstenite::Error> for SignalingError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        Self::ConnectionFailed(Box::new(e))
    }
}

/// Cliente de sinalização que gerencia a presença do agente e sessões ativas
pub struct SignalingClient {
    config: AgentConfig,
    turn_credentials: Option<TURNCredentialsResponse>,
    active_session: Arc<Mutex<Option<WebRtcSession>>>,
    injector: Arc<dyn InputInjector>,
}

impl SignalingClient {
    /// Cria uma nova instância do cliente com a configuração informada
    pub fn new(config: AgentConfig) -> Self {
        Self {
            config,
            turn_credentials: None,
            active_session: Arc::new(Mutex::new(None)),
            injector: Arc::new(DefaultInputInjector::new()),
        }
    }

    /// Executa o loop contínuo de conexão, registro e sinalização
    pub async fn run(&mut self) {
        let mut retry_delay = Duration::from_secs(2);

        loop {
            log::info!(
                "[Signaling] Conectando ao velodesk-server em {}...",
                self.config.server_url
            );

            match connect_async(&self.config.server_url).await {
                Ok((ws_stream, _)) => {
                    log::info!("[Signaling] WebSocket conectado com sucesso!");
                    retry_delay = Duration::from_secs(2);

                    if let Err(e) = self.handle_connection(ws_stream).await {
                        log::warn!("[Signaling] Conexão encerrada: {e}");
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[Signaling] Falha ao conectar no servidor (tentando novamente em {:?}): {e}",
                        retry_delay
                    );
                }
            }

            tokio::time::sleep(retry_delay).await;
            retry_delay = (retry_delay * 2).min(Duration::from_secs(30));
        }
    }

    /// Gerencia uma conexão WebSocket ativa
    async fn handle_connection<S>(&mut self, ws_stream: S) -> Result<(), SignalingError>
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Unpin
            + Send
            + 'static,
    {
        let (mut write, mut read) = ws_stream.split();

        // 1. Envia registro de presença
        let reg_msg = RegisterMessage::new(
            &self.config.agent_id,
            &self.config.hostname,
            &self.config.password_hash,
        );
        let reg_json = serde_json::to_string(&reg_msg)?;
        write.send(Message::Text(reg_json.into())).await?;

        let mut heartbeat_timer =
            tokio::time::interval(Duration::from_secs(self.config.heartbeat_interval_secs));
        let (outbox_tx, mut outbox_rx) = tokio::sync::mpsc::channel::<String>(32);

        loop {
            tokio::select! {
                // Heartbeat periódico (ping)
                _ = heartbeat_timer.tick() => {
                    let ping = HeartbeatMessage { r#type: "ping".to_string() };
                    if let Ok(json) = serde_json::to_string(&ping) {
                        let _ = write.send(Message::Text(json.into())).await;
                    }
                }

                // Envio de mensagens da caixa de saída (Offer, Candidatos ICE)
                Some(outgoing) = outbox_rx.recv() => {
                    write.send(Message::Text(outgoing.into())).await?;
                }

                // Recepção de mensagens do servidor
                Some(msg_res) = read.next() => {
                    match msg_res {
                        Ok(Message::Text(text)) => {
                            let text_str = text.as_str();
                            self.process_server_message(text_str, &outbox_tx).await?;
                        }
                        Ok(Message::Close(_)) => {
                            log::info!("[Signaling] Servidor solicitou encerramento da conexão");
                            break;
                        }
                        Ok(Message::Ping(p)) => {
                            let _ = write.send(Message::Pong(p)).await;
                        }
                        Err(e) => {
                            return Err(e.into());
                        }
                        _ => {}
                    }
                }
            }
        }

        // Limpa sessão ativa se houver desconexão do WebSocket
        let mut session_guard = self.active_session.lock().await;
        if let Some(mut session) = session_guard.take() {
            session.close().await;
        }

        Ok(())
    }

    /// Processa uma mensagem de texto JSON recebida do servidor de sinalização
    async fn process_server_message(
        &mut self,
        raw: &str,
        outbox: &tokio::sync::mpsc::Sender<String>,
    ) -> Result<(), SignalingError> {
        let env: MessageEnvelope = match serde_json::from_str(raw) {
            Ok(e) => e,
            Err(e) => {
                log::debug!("[Signaling] Mensagem não parseável: {e}");
                return Ok(());
            }
        };

        match env.r#type.as_str() {
            "register_ack" => {
                let ack: RegisterAckMessage = serde_json::from_str(raw)?;
                if ack.status == "ok" {
                    log::info!(
                        "[Signaling] Agente autenticado e registrado com sucesso! ID: {}",
                        ack.agent_id
                    );
                    self.config.agent_id = ack.agent_id;
                    self.turn_credentials = ack.turn_credentials;
                } else {
                    let err_msg = ack
                        .message
                        .unwrap_or_else(|| "Motivo não especificado".to_string());
                    return Err(SignalingError::RegistrationRejected(err_msg));
                }
            }

            "incoming_connection" => {
                let inc: IncomingConnectionMessage = serde_json::from_str(raw)?;
                log::info!(
                    "[Signaling] Nova conexão entrante iniciada: sessão={}, operador={:?}",
                    inc.session_id,
                    inc.operator_info
                );
                self.start_session(&inc.session_id, outbox).await;
            }

            "webrtc_answer" => {
                let ans: WebRTCAnswerMessage = serde_json::from_str(raw)?;
                let session_guard = self.active_session.lock().await;
                if let Some(session) = session_guard.as_ref() {
                    if session.session_id == ans.session_id {
                        if let Err(e) = session.set_remote_answer(&ans.sdp).await {
                            log::warn!("[Signaling] Falha ao aplicar SDP Answer: {e}");
                        } else {
                            log::info!("[Signaling] SDP Answer aplicada com sucesso!");
                        }
                    }
                }
            }

            "ice_candidate" => {
                let cand: ICECandidateMessage = serde_json::from_str(raw)?;
                let session_guard = self.active_session.lock().await;
                if let Some(session) = session_guard.as_ref() {
                    if session.session_id == cand.session_id {
                        if let Err(e) = session.add_remote_candidate(&cand.candidate).await {
                            log::debug!("[Signaling] Erro ao adicionar candidato ICE remoto: {e}");
                        }
                    }
                }
            }

            "disconnect" => {
                let disc: DisconnectMessage = serde_json::from_str(raw)?;
                log::info!(
                    "[Signaling] Sessão encerrada pelo peer: {}",
                    disc.session_id
                );
                let mut session_guard = self.active_session.lock().await;
                if let Some(mut session) = session_guard.take() {
                    session.close().await;
                }
            }

            "pong" => {
                log::trace!("[Signaling] Pong recebido do servidor");
            }

            other => {
                log::debug!("[Signaling] Tipo de mensagem não tratado: {other}");
            }
        }

        Ok(())
    }

    /// Inicializa a sessão WebRTC, gera SDP Offer e repassa candidatos ICE locais
    async fn start_session(
        &mut self,
        session_id: &str,
        outbox: &tokio::sync::mpsc::Sender<String>,
    ) {
        let ice_servers = self
            .turn_credentials
            .as_ref()
            .map(|t| t.ice_servers.clone())
            .unwrap_or_default();

        let capturer: Arc<Mutex<Box<dyn ScreenCapturer>>> = match AutoCapturer::new() {
            Ok(cap) => Arc::new(Mutex::new(Box::new(cap))),
            Err(e) => {
                log::warn!("[Signaling] Fallback para capturador mock: {e}");
                let mock = AutoCapturer::new_mock(1280, 720)
                    .unwrap_or_else(|_| panic!("mock init failed"));
                Arc::new(Mutex::new(Box::new(mock)))
            }
        };

        let encoder: Arc<Mutex<Box<dyn VideoEncoder>>> = match MftEncoder::new(
            1920,
            1080,
            self.config.target_fps,
            self.config.target_bitrate,
        ) {
            Ok(enc) => Arc::new(Mutex::new(Box::new(enc))),
            Err(e) => {
                log::error!("[Signaling] Falha ao inicializar MftEncoder: {e}");
                return;
            }
        };

        match WebRtcSession::new(
            session_id,
            &ice_servers,
            capturer,
            encoder,
            Arc::clone(&self.injector),
            self.config.target_fps,
            outbox.clone(),
        )
        .await
        {
            Ok(session) => {
                match session.create_offer().await {
                    Ok(sdp) => {
                        let offer_msg = WebRTCOfferMessage {
                            r#type: "webrtc_offer".to_string(),
                            session_id: session_id.to_string(),
                            sdp,
                        };
                        if let Ok(json) = serde_json::to_string(&offer_msg) {
                            let _ = outbox.send(json).await;
                        }
                    }
                    Err(e) => {
                        log::error!("[Signaling] Falha ao criar SDP Offer: {e}");
                        return;
                    }
                }

                let mut session_guard = self.active_session.lock().await;
                *session_guard = Some(session);
            }
            Err(e) => {
                log::error!("[Signaling] Falha ao inicializar sessão WebRTC: {e}");
            }
        }
    }
}
