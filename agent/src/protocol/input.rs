//! Protocolo do WebRTC Data Channel para controle e injeção de input.
//!
//! Mensagens compactadas recebidas no canal não-ordenado `velodesk-input`.

use serde::{Deserialize, Serialize};

/// Mensagem de entrada do operador recebida via Data Channel
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "t")]
pub enum InputMessage {
    /// Movimento do Mouse com coordenadas normalizadas (0.0 a 1.0)
    #[serde(rename = "mm")]
    MouseMove {
        /// Coordenada horizontal normalizada (0.0 = esquerda, 1.0 = direita)
        x: f64,
        /// Coordenada vertical normalizada (0.0 = topo, 1.0 = base)
        y: f64,
    },
    /// Pressionamento de botão do Mouse
    #[serde(rename = "md")]
    MouseDown {
        /// Botão do mouse: 0 = Esquerdo, 1 = Meio, 2 = Direito
        b: u8,
    },
    /// Liberação de botão do Mouse
    #[serde(rename = "mu")]
    MouseUp {
        /// Botão do mouse: 0 = Esquerdo, 1 = Meio, 2 = Direito
        b: u8,
    },
    /// Tecla pressionada no teclado físico
    #[serde(rename = "kd")]
    KeyDown {
        /// Código do scancode da tecla física (ex: "KeyA", "Enter")
        c: String,
        /// Virtual Key Code do Windows (ex: 65 para 'A')
        v: u32,
    },
    /// Tecla liberada
    #[serde(rename = "ku")]
    KeyUp {
        /// Código do scancode da tecla física
        c: String,
        /// Virtual Key Code do Windows
        v: u32,
    },
    /// Rolagem da roda do mouse (Scroll Wheel)
    #[serde(rename = "wh")]
    MouseWheel {
        /// Delta de rolagem horizontal
        dx: i32,
        /// Delta de rolagem vertical (negativo = baixo, positivo = cima)
        dy: i32,
    },
}

impl InputMessage {
    /// Tenta deserializar a partir de fatia de bytes (JSON ou UTF-8)
    pub fn from_slice(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(bytes)
    }

    /// Serializa para representação JSON
    pub fn to_json_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mouse_move_serde() {
        let msg = InputMessage::MouseMove {
            x: 0.4512,
            y: 0.8931,
        };
        let bytes = msg.to_json_bytes().expect("serialization failed");
        let parsed = InputMessage::from_slice(&bytes).expect("deserialization failed");
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_mouse_buttons_serde() {
        let down = InputMessage::MouseDown { b: 0 };
        let bytes = down.to_json_bytes().expect("serialization failed");
        let parsed = InputMessage::from_slice(&bytes).expect("deserialization failed");
        assert_eq!(down, parsed);

        let up = InputMessage::MouseUp { b: 2 };
        let bytes = up.to_json_bytes().expect("serialization failed");
        let parsed = InputMessage::from_slice(&bytes).expect("deserialization failed");
        assert_eq!(up, parsed);
    }

    #[test]
    fn test_keyboard_serde() {
        let kd = InputMessage::KeyDown {
            c: "KeyA".to_string(),
            v: 65,
        };
        let bytes = kd.to_json_bytes().expect("serialization failed");
        let parsed = InputMessage::from_slice(&bytes).expect("deserialization failed");
        assert_eq!(kd, parsed);
    }

    #[test]
    fn test_wheel_serde() {
        let wh = InputMessage::MouseWheel { dx: 0, dy: -120 };
        let bytes = wh.to_json_bytes().expect("serialization failed");
        let parsed = InputMessage::from_slice(&bytes).expect("deserialization failed");
        assert_eq!(wh, parsed);
    }
}
