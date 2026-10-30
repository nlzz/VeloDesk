//! Gerenciamento de WebRTC Data Channels para injeção de input e controle.

use crate::input::InputInjector;
use crate::protocol::input::InputMessage;
use std::sync::Arc;
use webrtc::data_channel::{DataChannel, DataChannelEvent};

/// Despachante de mensagens do Data Channel `velodesk-input`
pub struct DataChannelDispatcher;

impl DataChannelDispatcher {
    /// Inicia uma tarefa assíncrona para escutar eventos no Data Channel informado
    pub fn spawn_listener(channel: Arc<dyn DataChannel>, injector: Arc<dyn InputInjector>) {
        tokio::spawn(async move {
            let label = channel
                .label()
                .await
                .unwrap_or_else(|_| "unknown".to_string());
            log::info!(
                "[DataChannel] Canal '{}' conectado e pronto para processamento",
                label
            );

            while let Some(event) = channel.poll().await {
                match event {
                    DataChannelEvent::OnMessage(msg) => {
                        if label == "velodesk-input" || label == "input" {
                            match InputMessage::from_slice(&msg.data) {
                                Ok(input_msg) => {
                                    if let Err(e) = injector.inject(&input_msg) {
                                        log::warn!(
                                            "[DataChannel] Falha ao injetar evento de entrada: {e}"
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::debug!(
                                        "[DataChannel] Mensagem de input inválida recebida: {e}"
                                    );
                                }
                            }
                        } else if label == "velodesk-control" {
                            log::debug!(
                                "[DataChannel] Mensagem de controle recebida: {} bytes",
                                msg.data.len()
                            );
                        }
                    }
                    DataChannelEvent::OnClose => {
                        log::info!("[DataChannel] Canal '{}' foi encerrado", label);
                        break;
                    }
                    DataChannelEvent::OnError => {
                        log::warn!("[DataChannel] Erro reportado no canal '{}'", label);
                    }
                    _ => {}
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::injector::MockInputInjector;

    #[test]
    fn test_input_dispatch_deserialization() {
        let injector = Arc::new(MockInputInjector::default());
        let raw = br#"{"t":"mm","x":0.25,"y":0.75}"#;

        let parsed: InputMessage = InputMessage::from_slice(raw).expect("deserialization failed");
        assert!(injector.inject(&parsed).is_ok());

        let events = injector.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], InputMessage::MouseMove { x: 0.25, y: 0.75 });
    }
}
