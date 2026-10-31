//! Injetor de eventos de mouse e teclado via Win32 `SendInput`.

use crate::protocol::input::InputMessage;
use thiserror::Error;
use windows::Win32::UI::Input::KeyboardAndMouse::*;

/// Erros possíveis durante injeção de input
#[derive(Debug, Error)]
pub enum InjectError {
    /// Falha na API Win32 SendInput (retornou 0 eventos inseridos)
    #[error("Win32 SendInput falhou ao injetar eventos")]
    SendInputFailed,
    /// Botão de mouse desconhecido ou não suportado
    #[error("Botão de mouse inválido: {0}")]
    InvalidMouseButton(u8),
}

/// Contrato para injeção de eventos de entrada no sistema operacional
pub trait InputInjector: Send + Sync {
    /// Injeta um evento de entrada recebido do operador
    fn inject(&self, msg: &InputMessage) -> Result<(), InjectError>;
}

use std::sync::Arc;

/// Injetor padrão de produção que utiliza as APIs nativas do Windows
#[derive(Default, Clone)]
pub struct DefaultInputInjector {
    preemption: Option<Arc<crate::privacy::InputPreemptionManager>>,
}

impl DefaultInputInjector {
    /// Cria uma nova instância do injetor padrão
    pub fn new() -> Self {
        Self { preemption: None }
    }

    /// Cria injetor integrado à salvaguarda de preempção física LGPD
    pub fn with_preemption(preemption: Arc<crate::privacy::InputPreemptionManager>) -> Self {
        Self {
            preemption: Some(preemption),
        }
    }

    /// Envia uma lista de estruturas INPUT para o subsistema Win32 de forma segura
    fn send_inputs(&self, inputs: &[INPUT]) -> Result<(), InjectError> {
        if inputs.is_empty() {
            return Ok(());
        }

        if let Some(ref p) = self.preemption {
            if p.is_blocked_sync() {
                log::debug!("[InputInjector] Entrada remota descartada por preempção local ativa.");
                return Ok(());
            }
        }

        // SAFETY: Passamos uma fatia válida e contígua de structs `INPUT` inicializadas
        // com tipos e flags suportados pela API Win32. O tamanho especificado corresponde
        // com precisão a std::mem::size_of::<INPUT>().
        let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };

        if sent as usize != inputs.len() {
            Err(InjectError::SendInputFailed)
        } else {
            Ok(())
        }
    }
}

impl InputInjector for DefaultInputInjector {
    fn inject(&self, msg: &InputMessage) -> Result<(), InjectError> {
        match msg {
            InputMessage::MouseMove { x, y } => {
                // Converte as coordenadas normalizadas 0.0..=1.0 para o espaço absoluto 0..=65535 do Win32
                let clamped_x = x.clamp(0.0, 1.0);
                let clamped_y = y.clamp(0.0, 1.0);
                let abs_x = (clamped_x * 65535.0).round() as i32;
                let abs_y = (clamped_y * 65535.0).round() as i32;

                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: abs_x,
                            dy: abs_y,
                            mouseData: 0,
                            dwFlags: MOUSEEVENTF_MOVE
                                | MOUSEEVENTF_ABSOLUTE
                                | MOUSEEVENTF_VIRTUALDESK,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                self.send_inputs(&[input])
            }

            InputMessage::MouseDown { b } => {
                let flag = match b {
                    0 => MOUSEEVENTF_LEFTDOWN,
                    1 => MOUSEEVENTF_MIDDLEDOWN,
                    2 => MOUSEEVENTF_RIGHTDOWN,
                    other => return Err(InjectError::InvalidMouseButton(*other)),
                };

                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: 0,
                            dwFlags: flag,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                self.send_inputs(&[input])
            }

            InputMessage::MouseUp { b } => {
                let flag = match b {
                    0 => MOUSEEVENTF_LEFTUP,
                    1 => MOUSEEVENTF_MIDDLEUP,
                    2 => MOUSEEVENTF_RIGHTUP,
                    other => return Err(InjectError::InvalidMouseButton(*other)),
                };

                let input = INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: 0,
                            dwFlags: flag,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                self.send_inputs(&[input])
            }

            InputMessage::MouseWheel { dx, dy } => {
                let mut inputs = Vec::with_capacity(2);

                if *dy != 0 {
                    inputs.push(INPUT {
                        r#type: INPUT_MOUSE,
                        Anonymous: INPUT_0 {
                            mi: MOUSEINPUT {
                                dx: 0,
                                dy: 0,
                                mouseData: *dy as u32,
                                dwFlags: MOUSEEVENTF_WHEEL,
                                time: 0,
                                dwExtraInfo: 0,
                            },
                        },
                    });
                }

                if *dx != 0 {
                    inputs.push(INPUT {
                        r#type: INPUT_MOUSE,
                        Anonymous: INPUT_0 {
                            mi: MOUSEINPUT {
                                dx: 0,
                                dy: 0,
                                mouseData: *dx as u32,
                                dwFlags: MOUSEEVENTF_HWHEEL,
                                time: 0,
                                dwExtraInfo: 0,
                            },
                        },
                    });
                }

                self.send_inputs(&inputs)
            }

            InputMessage::KeyDown { v, .. } => {
                let input = INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(*v as u16),
                            wScan: 0,
                            dwFlags: KEYBD_EVENT_FLAGS(0),
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                self.send_inputs(&[input])
            }

            InputMessage::KeyUp { v, .. } => {
                let input = INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(*v as u16),
                            wScan: 0,
                            dwFlags: KEYEVENTF_KEYUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                };
                self.send_inputs(&[input])
            }
        }
    }
}

/// Injetor simulado para suítes de testes unitários
#[derive(Debug, Default)]
pub struct MockInputInjector {
    /// Histórico de eventos recebidos
    pub events: std::sync::Mutex<Vec<InputMessage>>,
}

impl InputInjector for MockInputInjector {
    fn inject(&self, msg: &InputMessage) -> Result<(), InjectError> {
        if let InputMessage::MouseDown { b } | InputMessage::MouseUp { b } = msg {
            if *b > 2 {
                return Err(InjectError::InvalidMouseButton(*b));
            }
        }
        if let Ok(mut lock) = self.events.lock() {
            lock.push(msg.clone());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_injector_mouse_move() {
        let injector = MockInputInjector::default();
        let msg = InputMessage::MouseMove { x: 0.5, y: 0.5 };
        assert!(injector.inject(&msg).is_ok());

        let events = injector.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], msg);
    }

    #[test]
    fn test_mock_injector_invalid_button() {
        let injector = MockInputInjector::default();
        let invalid = InputMessage::MouseDown { b: 99 };
        assert!(injector.inject(&invalid).is_err());
    }
}
