package signaling

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
)

var jsonMarshal = json.Marshal

// Session representa uma sessão WebRTC ativa entre um Host e um Viewer
type Session struct {
	ID        string
	Agent     *Client
	Viewer    *Client
	CreatedAt time.Time
}

// Hub gerencia agentes registrados, visualizadores conectados e sessões ativas
type Hub struct {
	config    *config.Config
	agents    map[string]*Client  // agent_id -> Client
	viewers   map[string]*Client  // viewer_id -> Client
	sessions  map[string]*Session // session_id -> Session
	startTime time.Time
	mu        sync.RWMutex
}

// NewHub instancia um novo Hub central de sinalização
func NewHub(cfg *config.Config) *Hub {
	return &Hub{
		config:    cfg,
		agents:    make(map[string]*Client),
		viewers:   make(map[string]*Client),
		sessions:  make(map[string]*Session),
		startTime: time.Now(),
	}
}

// Stats armazena métricas operacionais para o endpoint /api/v1/health
type Stats struct {
	UptimeSeconds  int64 `json:"uptime_seconds"`
	ActiveAgents   int   `json:"active_agents"`
	ActiveViewers  int   `json:"active_viewers"`
	ActiveSessions int   `json:"active_sessions"`
}

// GetStats retorna as estatísticas em tempo real
func (h *Hub) GetStats() Stats {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return Stats{
		UptimeSeconds:  int64(time.Since(h.startTime).Seconds()),
		ActiveAgents:   len(h.agents),
		ActiveViewers:  len(h.viewers),
		ActiveSessions: len(h.sessions),
	}
}

// UnregisterClient limpa referências do cliente ao desconectar
func (h *Hub) UnregisterClient(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if c.Role == RoleAgent && c.ID != "" {
		delete(h.agents, c.ID)
		log.Printf("[Signaling] Agente desconectado: ID %s", c.ID)
	} else if c.Role == RoleViewer && c.ID != "" {
		delete(h.viewers, c.ID)
		log.Printf("[Signaling] Viewer desconectado: ID %s", c.ID)
	}

	// Se estava em uma sessão ativa, notifica o peer e destrói a sessão
	if c.SessionID != "" {
		if session, exists := h.sessions[c.SessionID]; exists {
			var peer *Client
			if c == session.Agent {
				peer = session.Viewer
			} else {
				peer = session.Agent
			}

			if peer != nil {
				peer.SendJSON(DisconnectMessage{
					Type:      TypeDisconnect,
					SessionID: session.ID,
					Reason:    "peer_disconnected",
				})
				peer.SessionID = ""
			}

			delete(h.sessions, c.SessionID)
			log.Printf("[Signaling] Sessão encerrada por desconexão: %s", session.ID)
		}
		c.SessionID = ""
	}
}

// HandleMessage processa e roteia mensagens JSON recebidas de um cliente
func (h *Hub) HandleMessage(c *Client, raw []byte) {
	var env MessageEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		log.Printf("[Signaling] Mensagem inválida recebida: %v", err)
		return
	}

	switch env.Type {
	case TypeRegister:
		h.handleRegister(c, raw)

	case TypeConnectRequest:
		h.handleConnectRequest(c, raw)

	case TypeWebRTCOffer:
		h.forwardToPeer(c, raw, TypeWebRTCOffer)

	case TypeWebRTCAnswer:
		h.forwardToPeer(c, raw, TypeWebRTCAnswer)

	case TypeICECandidate:
		h.forwardToPeer(c, raw, TypeICECandidate)

	case TypeDisconnect:
		h.handleDisconnect(c, raw)

	case TypePing:
		c.SendJSON(HeartbeatMessage{Type: TypePong})

	default:
		log.Printf("[Signaling] Tipo de mensagem desconhecido: %s", env.Type)
	}
}

// handleRegister registra o Host Agent e gera credenciais TURN
func (h *Hub) handleRegister(c *Client, raw []byte) {
	var msg RegisterMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		c.SendJSON(RegisterAckMessage{
			Type:    TypeRegisterAck,
			Status:  "error",
			Message: "Payload de registro malformado",
		})
		return
	}

	agentID := msg.AgentID
	if agentID == "" {
		agentID = generateRandomAgentID()
	}

	h.mu.Lock()
	c.ID = agentID
	c.Role = RoleAgent
	c.Hostname = msg.Hostname
	c.Version = msg.Version
	c.PasswordHash = msg.PasswordHash
	h.agents[agentID] = c
	h.mu.Unlock()

	turnCreds := auth.GenerateTURNCredentials(
		h.config.TurnSecret,
		h.config.StunURL,
		h.config.TurnURL,
		agentID,
		h.config.TurnTTL,
	)

	c.SendJSON(RegisterAckMessage{
		Type:            TypeRegisterAck,
		Status:          "ok",
		AgentID:         agentID,
		TURNCredentials: turnCreds,
	})

	log.Printf("[Signaling] Agente registrado: ID=%s, Host=%s, Versão=%s", agentID, msg.Hostname, msg.Version)
}

// handleConnectRequest processa pedido de conexão de um técnico (Viewer)
func (h *Hub) handleConnectRequest(c *Client, raw []byte) {
	var msg ConnectRequestMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		c.SendJSON(ConnectErrorMessage{
			Type:    TypeConnectError,
			Message: "Payload de conexão malformado",
		})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if c.ID == "" {
		c.ID = "viewer-" + uuid.New().String()[:8]
	}
	c.Role = RoleViewer
	h.viewers[c.ID] = c

	agent, found := h.agents[msg.TargetID]
	if !found {
		c.SendJSON(ConnectErrorMessage{
			Type:    TypeConnectError,
			Message: fmt.Sprintf("Agente com ID %s não encontrado ou está offline.", msg.TargetID),
		})
		return
	}

	// Validação de senha se o agente definiu hash de senha
	if agent.PasswordHash != "" && agent.PasswordHash != msg.PasswordHash {
		c.SendJSON(ConnectErrorMessage{
			Type:    TypeConnectError,
			Message: "Senha de acesso incorreta.",
		})
		return
	}

	sessionID := "sess_" + uuid.New().String()
	session := &Session{
		ID:        sessionID,
		Agent:     agent,
		Viewer:    c,
		CreatedAt: time.Now(),
	}

	h.sessions[sessionID] = session
	agent.SessionID = sessionID
	c.SessionID = sessionID

	turnCreds := auth.GenerateTURNCredentials(
		h.config.TurnSecret,
		h.config.StunURL,
		h.config.TurnURL,
		c.ID,
		h.config.TurnTTL,
	)

	// Notifica o Host Agent da conexão entrante
	agent.SendJSON(IncomingConnectionMessage{
		Type:         TypeIncomingConnection,
		SessionID:    sessionID,
		OperatorInfo: msg.OperatorInfo,
	})

	// Confirma para o Viewer e entrega credenciais TURN
	c.SendJSON(ConnectAckMessage{
		Type:            TypeConnectAck,
		SessionID:       sessionID,
		TargetID:        msg.TargetID,
		TURNCredentials: turnCreds,
	})

	log.Printf("[Signaling] Nova sessão iniciada: %s (Viewer %s -> Agent %s)", sessionID, c.ID, agent.ID)
}

// forwardToPeer encaminha mensagens WebRTC (Offer, Answer, Candidate) diretamente ao outro lado da sessão
func (h *Hub) forwardToPeer(c *Client, raw []byte, msgType string) {
	var base struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(raw, &base); err != nil || base.SessionID == "" {
		log.Printf("[Signaling] Falha ao extrair session_id para %s", msgType)
		return
	}

	h.mu.RLock()
	session, exists := h.sessions[base.SessionID]
	h.mu.RUnlock()

	if !exists {
		log.Printf("[Signaling] Sessão %s não encontrada para repasse de %s", base.SessionID, msgType)
		return
	}

	var peer *Client
	if c == session.Agent {
		peer = session.Viewer
	} else if c == session.Viewer {
		peer = session.Agent
	}

	if peer != nil {
		// Repasse zero-copy direto dos bytes recebidos
		peer.mu.RLock()
		defer peer.mu.RUnlock()
		if !peer.closed {
			peer.Send <- raw
		}
	}
}

// handleDisconnect encerra uma sessão ativa
func (h *Hub) handleDisconnect(c *Client, raw []byte) {
	var msg DisconnectMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	session, exists := h.sessions[msg.SessionID]
	if !exists {
		return
	}

	var peer *Client
	if c == session.Agent {
		peer = session.Viewer
	} else {
		peer = session.Agent
	}

	if peer != nil {
		peer.SendJSON(DisconnectMessage{
			Type:      TypeDisconnect,
			SessionID: msg.SessionID,
			Reason:    msg.Reason,
		})
		peer.SessionID = ""
	}

	c.SessionID = ""
	delete(h.sessions, msg.SessionID)
	log.Printf("[Signaling] Sessão %s encerrada amigavelmente por %s", msg.SessionID, c.ID)
}

// generateRandomAgentID gera um ID numérico de 9 dígitos no formato 123-456-789
func generateRandomAgentID() string {
	n1, _ := rand.Int(rand.Reader, big.NewInt(900))
	n2, _ := rand.Int(rand.Reader, big.NewInt(900))
	n3, _ := rand.Int(rand.Reader, big.NewInt(900))
	return fmt.Sprintf("%03d-%03d-%03d", n1.Int64()+100, n2.Int64()+100, n3.Int64()+100)
}
