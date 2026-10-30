package signaling

import (
	"encoding/json"
	"velodesk-server/internal/auth"
)

// Tipos de Mensagem do Protocolo VeloDesk
const (
	TypeRegister           = "register"
	TypeRegisterAck        = "register_ack"
	TypeConnectRequest     = "connect_request"
	TypeIncomingConnection = "incoming_connection"
	TypeConnectAck         = "connect_ack"
	TypeConnectError       = "connect_error"
	TypeWebRTCOffer        = "webrtc_offer"
	TypeWebRTCAnswer       = "webrtc_answer"
	TypeICECandidate       = "ice_candidate"
	TypeDisconnect         = "disconnect"
	TypePing               = "ping"
	TypePong               = "pong"
)

// Envelope base para parsing polimórfico de mensagens
type MessageEnvelope struct {
	Type string `json:"type"`
}

// RegisterMessage enviada pelo Host Agent para registrar presença
type RegisterMessage struct {
	Type         string `json:"type"`
	AgentID      string `json:"agent_id"`
	Version      string `json:"version,omitempty"`
	Hostname     string `json:"hostname,omitempty"`
	PasswordHash string `json:"password_hash,omitempty"`
}

// RegisterAckMessage resposta do servidor confirmando registro e entregando credenciais TURN
type RegisterAckMessage struct {
	Type            string                        `json:"type"`
	Status          string                        `json:"status"`
	AgentID         string                        `json:"agent_id"`
	TURNCredentials *auth.TURNCredentialsResponse `json:"turn_credentials,omitempty"`
	Message         string                        `json:"message,omitempty"`
}

// ConnectRequestMessage enviada pelo Operador (Viewer) para iniciar sessão com um agente
type ConnectRequestMessage struct {
	Type         string `json:"type"`
	TargetID     string `json:"target_id"`
	PasswordHash string `json:"password_hash,omitempty"`
	OperatorInfo string `json:"operator_info,omitempty"`
}

// IncomingConnectionMessage enviada pelo servidor ao Host Agent para notificar nova sessão
type IncomingConnectionMessage struct {
	Type         string `json:"type"`
	SessionID    string `json:"session_id"`
	OperatorInfo string `json:"operator_info,omitempty"`
}

// ConnectAckMessage enviada pelo servidor ao Viewer confirmando início da sessão
type ConnectAckMessage struct {
	Type            string                        `json:"type"`
	SessionID       string                        `json:"session_id"`
	TargetID        string                        `json:"target_id"`
	TURNCredentials *auth.TURNCredentialsResponse `json:"turn_credentials,omitempty"`
}

// ConnectErrorMessage resposta de erro caso agente esteja offline ou senha incorreta
type ConnectErrorMessage struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// WebRTCOfferMessage transporte de SDP Offer (Host -> Viewer)
type WebRTCOfferMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	SDP       string `json:"sdp"`
}

// WebRTCAnswerMessage transporte de SDP Answer (Viewer -> Host)
type WebRTCAnswerMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	SDP       string `json:"sdp"`
}

// ICECandidateMessage transporte de candidatos ICE bidirecional
type ICECandidateMessage struct {
	Type      string          `json:"type"`
	SessionID string          `json:"session_id"`
	Candidate json.RawMessage `json:"candidate"`
}

// DisconnectMessage encerramento de sessão
type DisconnectMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	Reason    string `json:"reason,omitempty"`
}

// HeartbeatMessage para manter conexão viva através de proxies e firewalls
type HeartbeatMessage struct {
	Type string `json:"type"`
}
