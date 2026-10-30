//! Mensagens de Sinalização (WebSocket) entre o Agente e o velodesk-server.

use serde::{Deserialize, Serialize};

/// Envelope base para identificar o tipo de mensagem recebida
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEnvelope {
    /// Tipo discriminador da mensagem
    pub r#type: String,
}

/// Mensagem de registro de presença enviada pelo Agente ao Servidor
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegisterMessage {
    /// Tipo fixo: "register"
    pub r#type: String,
    /// Identificador do agente
    pub agent_id: String,
    /// Versão do agente
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Nome de host da máquina
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    /// Hash de senha (opcional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
}

impl RegisterMessage {
    /// Cria uma nova mensagem de registro
    pub fn new(agent_id: &str, hostname: &str, password_hash: &str) -> Self {
        Self {
            r#type: "register".to_string(),
            agent_id: agent_id.to_string(),
            version: Some("1.0.0".to_string()),
            hostname: Some(hostname.to_string()),
            password_hash: if password_hash.is_empty() {
                None
            } else {
                Some(password_hash.to_string())
            },
        }
    }
}

/// Resposta do Servidor confirmando o registro e entregando credenciais TURN
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterAckMessage {
    /// Tipo fixo: "register_ack"
    pub r#type: String,
    /// Status: "ok" ou "error"
    pub status: String,
    /// ID atribuído ou confirmado
    pub agent_id: String,
    /// Credenciais do Coturn geradas pelo servidor
    pub turn_credentials: Option<TURNCredentialsResponse>,
    /// Mensagem de erro ou aviso (se houver)
    pub message: Option<String>,
}

/// Servidor ICE (STUN ou TURN)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ICEServer {
    /// URLs do servidor (ex: stun:..., turn:...:3478?transport=udp)
    pub urls: Vec<String>,
    /// Nome de usuário temporário (para TURN)
    pub username: Option<String>,
    /// Credencial / senha efêmera derivada via HMAC-SHA1
    pub credential: Option<String>,
}

/// Resposta de credenciais TURN efêmeras
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TURNCredentialsResponse {
    /// Lista de servidores STUN/TURN
    pub ice_servers: Vec<ICEServer>,
    /// Time-to-live em segundos
    pub ttl: i64,
    /// Timestamp Unix de expiração
    pub expires_at: i64,
}

/// Notificação enviada pelo Servidor avisando sobre conexão iniciada pelo Operador
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingConnectionMessage {
    /// Tipo fixo: "incoming_connection"
    pub r#type: String,
    /// Identificador único da sessão WebRTC
    pub session_id: String,
    /// Informações sobre o operador ou solicitante
    pub operator_info: Option<String>,
}

/// Oferta SDP enviada pelo Host ao Viewer
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRTCOfferMessage {
    /// Tipo fixo: "webrtc_offer"
    pub r#type: String,
    /// ID da sessão
    pub session_id: String,
    /// Payload SDP formatado
    pub sdp: String,
}

/// Resposta SDP enviada pelo Viewer ao Host
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRTCAnswerMessage {
    /// Tipo fixo: "webrtc_answer"
    pub r#type: String,
    /// ID da sessão
    pub session_id: String,
    /// Payload SDP formatado
    pub sdp: String,
}

/// Troca de candidatos ICE bidirecional
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICECandidateMessage {
    /// Tipo fixo: "ice_candidate"
    pub r#type: String,
    /// ID da sessão
    pub session_id: String,
    /// Candidato ICE codificado em JSON (ou objeto com candidate, sdpMid, sdpMLineIndex)
    pub candidate: serde_json::Value,
}

/// Mensagem de encerramento de sessão
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisconnectMessage {
    /// Tipo fixo: "disconnect"
    pub r#type: String,
    /// ID da sessão
    pub session_id: String,
    /// Motivo da desconexão
    pub reason: Option<String>,
}

/// Mensagem de batimento cardíaco (Heartbeat)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeartbeatMessage {
    /// Tipo fixo: "ping" ou "pong"
    pub r#type: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_message_serialization() {
        let reg = RegisterMessage::new("123-456-789", "DESKTOP-TEST", "hash123");
        let json = serde_json::to_string(&reg).expect("serialization failed");
        assert!(json.contains("\"type\":\"register\""));
        assert!(json.contains("\"agent_id\":\"123-456-789\""));
        assert!(json.contains("\"hostname\":\"DESKTOP-TEST\""));
        assert!(json.contains("\"password_hash\":\"hash123\""));
    }

    #[test]
    fn test_register_ack_deserialization() {
        let raw = r#"{
            "type": "register_ack",
            "status": "ok",
            "agent_id": "832-192-041",
            "turn_credentials": {
                "ice_servers": [
                    {"urls": ["stun:stun.staycloud.net:3478"]},
                    {
                        "urls": ["turn:turn.staycloud.net:3478?transport=udp"],
                        "username": "1730000000:832-192-041",
                        "credential": "base64secret=="
                    }
                ],
                "ttl": 86400,
                "expires_at": 1730086400
            }
        }"#;

        let ack: RegisterAckMessage = serde_json::from_str(raw).expect("deserialization failed");
        assert_eq!(ack.status, "ok");
        assert_eq!(ack.agent_id, "832-192-041");
        assert!(ack.turn_credentials.is_some());
        let creds = ack.turn_credentials.unwrap();
        assert_eq!(creds.ice_servers.len(), 2);
    }
}
