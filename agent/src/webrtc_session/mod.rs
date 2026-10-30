//! Gerenciador de Sessão WebRTC (PeerConnection, SDP Offer/Answer e ICE).

pub mod datachannel;
pub mod stream;

use crate::capture::ScreenCapturer;
use crate::encoder::VideoEncoder;
use crate::input::InputInjector;
use crate::protocol::signaling::{ICECandidateMessage, ICEServer};
use datachannel::DataChannelDispatcher;
use rtc::data_channel::RTCDataChannelInit;
use rtc::interceptor::Registry;
use rtc::media_stream::MediaStreamTrack;
use rtc::peer_connection::configuration::interceptor_registry::register_default_interceptors;
use rtc::peer_connection::configuration::media_engine::{MediaEngine, MIME_TYPE_H264};
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::transport::{RTCIceCandidateInit, RTCIceServer};
use rtc::rtp_transceiver::rtp_sender::{
    RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters,
    RtpCodecKind,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use stream::VideoStreamer;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use webrtc::data_channel::DataChannel;
use webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample;
use webrtc::media_stream::track_local::TrackLocal;
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCIceGatheringState,
    RTCPeerConnectionIceEvent, RTCPeerConnectionState,
};

/// Erros relacionados ao ciclo de vida da sessão WebRTC
#[derive(Debug, Error)]
pub enum WebRtcError {
    /// Falha na inicialização da PeerConnection
    #[error("Falha ao criar PeerConnection: {0}")]
    PeerConnectionFailed(String),
    /// Falha na negociação SDP
    #[error("Falha ao negociar SDP (Offer/Answer): {0}")]
    SdpNegotiationFailed(String),
    /// Falha ao adicionar candidato ICE
    #[error("Falha ao processar candidato ICE: {0}")]
    IceCandidateFailed(String),
    /// Trilha de vídeo não configurada
    #[error("Trilha de vídeo não configurada")]
    TrackNotConfigured,
}

/// Manipulador de eventos da PeerConnection
#[derive(Clone)]
struct WebRtcEventHandler {
    session_id: String,
    outbox_tx: mpsc::Sender<String>,
    injector: Arc<dyn InputInjector>,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for WebRtcEventHandler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(json_cand) = serde_json::to_value(&event.candidate) {
            let cand_msg = ICECandidateMessage {
                r#type: "ice_candidate".to_string(),
                session_id: self.session_id.clone(),
                candidate: json_cand,
            };
            if let Ok(json) = serde_json::to_string(&cand_msg) {
                let _ = self.outbox_tx.send(json).await;
            }
        }
    }

    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        log::debug!("[WebRTC] ICE Gathering State: {:?}", state);
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        log::info!("[WebRTC] Peer Connection State: {:?}", state);
    }

    async fn on_data_channel(&self, data_channel: Arc<dyn DataChannel>) {
        DataChannelDispatcher::spawn_listener(data_channel, Arc::clone(&self.injector));
    }
}

/// Sessão WebRTC completa associada a um técnico conectado
pub struct WebRtcSession {
    /// Identificador único da sessão
    pub session_id: String,
    peer_connection: Arc<dyn PeerConnection>,
    _video_track: Arc<TrackLocalStaticSample>,
    is_running: Arc<AtomicBool>,
}

impl WebRtcSession {
    /// Constrói e inicializa uma nova sessão WebRTC configurada com STUN/TURN
    pub async fn new(
        session_id: &str,
        ice_servers: &[ICEServer],
        capturer: Arc<Mutex<Box<dyn ScreenCapturer>>>,
        encoder: Arc<Mutex<Box<dyn VideoEncoder>>>,
        injector: Arc<dyn InputInjector>,
        fps: u32,
        outbox_tx: mpsc::Sender<String>,
    ) -> Result<Self, WebRtcError> {
        // 1. Configura MediaEngine com H.264
        let mut media_engine = MediaEngine::default();
        let video_codec = RTCRtpCodecParameters {
            rtp_codec: RTCRtpCodec {
                mime_type: MIME_TYPE_H264.to_string(),
                clock_rate: 90000,
                channels: 0,
                sdp_fmtp_line:
                    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                        .to_string(),
                rtcp_feedback: vec![],
            },
            payload_type: 102,
        };
        media_engine
            .register_codec(video_codec.clone(), RtpCodecKind::Video)
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?;

        let registry = register_default_interceptors(Registry::new(), &mut media_engine)
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?;

        // 2. Converte servidores ICE da sinalização para o WebRTC
        let mut rtc_ice_servers = Vec::new();
        for s in ice_servers {
            rtc_ice_servers.push(RTCIceServer {
                urls: s.urls.clone(),
                username: s.username.clone().unwrap_or_default(),
                credential: s.credential.clone().unwrap_or_default(),
            });
        }

        if rtc_ice_servers.is_empty() {
            rtc_ice_servers.push(RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_string()],
                ..Default::default()
            });
        }

        let config = RTCConfigurationBuilder::new()
            .with_ice_servers(rtc_ice_servers)
            .build();

        let handler = Arc::new(WebRtcEventHandler {
            session_id: session_id.to_string(),
            outbox_tx,
            injector: Arc::clone(&injector),
        });

        // 3. Constrói a PeerConnection
        let pc = PeerConnectionBuilder::new()
            .with_configuration(config)
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .with_handler(handler)
            .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
            .build()
            .await
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?;

        // 4. Cria a trilha de vídeo H.264
        let ssrc = 1001;
        let track = Arc::new(
            TrackLocalStaticSample::new(
                Instant::now(),
                MediaStreamTrack::new(
                    "velodesk-stream".to_string(),
                    "velodesk-video".to_string(),
                    "VeloDesk Desktop".to_string(),
                    RtpCodecKind::Video,
                    vec![RTCRtpEncodingParameters {
                        rtp_coding_parameters: RTCRtpCodingParameters {
                            ssrc: Some(ssrc),
                            ..Default::default()
                        },
                        codec: video_codec.rtp_codec,
                        ..Default::default()
                    }],
                ),
            )
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?,
        );

        let sender = pc
            .add_track(Arc::clone(&track) as Arc<dyn TrackLocal>)
            .await
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?;

        // 5. Pre-cria o canal de entrada velodesk-input (ordered: false, maxRetransmits: 0)
        let input_init = RTCDataChannelInit {
            ordered: false,
            max_retransmits: Some(0),
            ..Default::default()
        };
        let input_dc = pc
            .create_data_channel("velodesk-input", Some(input_init))
            .await
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?;
        DataChannelDispatcher::spawn_listener(input_dc, Arc::clone(&injector));

        // 6. Pre-cria o canal de controle velodesk-control (ordered: true)
        let control_init = RTCDataChannelInit {
            ordered: true,
            ..Default::default()
        };
        let control_dc = pc
            .create_data_channel("velodesk-control", Some(control_init))
            .await
            .map_err(|e| WebRtcError::PeerConnectionFailed(e.to_string()))?;
        DataChannelDispatcher::spawn_listener(control_dc, injector);

        let is_running = Arc::new(AtomicBool::new(true));

        // 7. Inicia a transmissão de vídeo contínua
        VideoStreamer::spawn(
            Arc::clone(&track),
            sender,
            capturer,
            encoder,
            fps,
            Arc::clone(&is_running),
        );

        Ok(Self {
            session_id: session_id.to_string(),
            peer_connection: Arc::new(pc),
            _video_track: track,
            is_running,
        })
    }

    /// Cria uma SDP Offer para iniciar a negociação com o operador
    pub async fn create_offer(&self) -> Result<String, WebRtcError> {
        let offer = self
            .peer_connection
            .create_offer(None)
            .await
            .map_err(|e| WebRtcError::SdpNegotiationFailed(e.to_string()))?;

        self.peer_connection
            .set_local_description(offer.clone())
            .await
            .map_err(|e| WebRtcError::SdpNegotiationFailed(e.to_string()))?;

        Ok(offer.sdp)
    }

    /// Aplica a SDP Answer retornada pelo operador
    pub async fn set_remote_answer(&self, sdp: &str) -> Result<(), WebRtcError> {
        let desc = RTCSessionDescription::answer(sdp.to_string())
            .map_err(|e| WebRtcError::SdpNegotiationFailed(e.to_string()))?;
        self.peer_connection
            .set_remote_description(desc)
            .await
            .map_err(|e| WebRtcError::SdpNegotiationFailed(e.to_string()))?;
        Ok(())
    }

    /// Adiciona um candidato ICE recebido do operador via sinalização
    pub async fn add_remote_candidate(
        &self,
        cand_json: &serde_json::Value,
    ) -> Result<(), WebRtcError> {
        let candidate_str = if let Some(s) = cand_json.get("candidate").and_then(|v| v.as_str()) {
            s.to_string()
        } else if let Some(s) = cand_json.as_str() {
            s.to_string()
        } else {
            return Ok(());
        };

        let sdp_mid = cand_json
            .get("sdpMid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let sdp_mline_index = cand_json
            .get("sdpMLineIndex")
            .and_then(|v| v.as_u64())
            .map(|n| n as u16);

        let init = RTCIceCandidateInit {
            candidate: candidate_str,
            sdp_mid,
            sdp_mline_index,
            username_fragment: None,
            url: None,
        };

        self.peer_connection
            .add_ice_candidate(init)
            .await
            .map_err(|e| WebRtcError::IceCandidateFailed(e.to_string()))?;

        Ok(())
    }

    /// Encerra a sessão e desliga a captura e streaming
    pub async fn close(&mut self) {
        self.is_running.store(false, Ordering::Relaxed);
        let _ = self.peer_connection.close().await;
        log::info!("[WebRTC] Sessão {} encerrada com sucesso", self.session_id);
    }
}
