package hub

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Message types for real-time hub
const (
	TypeNewTicket     = "new_ticket"
	TypeTicketUpdate  = "ticket_update"
	TypeTicketMessage = "ticket_message"
	TypeSessionChat   = "session_chat"
	TypeDeviceStatus  = "device_status"
	TypeFileTransfer  = "file_transfer_alert"
)

// HubMessage envelope padrão para mensagens em tempo real
type HubMessage struct {
	Type      string      `json:"type"`
	TenantID  string      `json:"tenant_id,omitempty"`
	TicketID  string      `json:"ticket_id,omitempty"`
	SessionID string      `json:"session_id,omitempty"`
	Payload   interface{} `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
}

// Subscriber representa um cliente conectado escutando eventos em tempo real
type Subscriber struct {
	ID        string
	TenantID  uuid.UUID
	Role      string
	Send      chan []byte
	TicketIDs map[uuid.UUID]bool
	mu        sync.RWMutex
}

// NewSubscriber cria um novo assinante
func NewSubscriber(id string, tenantID uuid.UUID, role string) *Subscriber {
	return &Subscriber{
		ID:        id,
		TenantID:  tenantID,
		Role:      role,
		Send:      make(chan []byte, 128),
		TicketIDs: make(map[uuid.UUID]bool),
	}
}

// RealtimeHub gerencia broadcast e mensageria em tempo real
type RealtimeHub struct {
	subscribers map[string]*Subscriber
	tenantSubs  map[uuid.UUID]map[string]*Subscriber
	ticketSubs  map[uuid.UUID]map[string]*Subscriber
	mu          sync.RWMutex
}

// NewRealtimeHub inicializa o hub de mensageria
func NewRealtimeHub() *RealtimeHub {
	return &RealtimeHub{
		subscribers: make(map[string]*Subscriber),
		tenantSubs:  make(map[uuid.UUID]map[string]*Subscriber),
		ticketSubs:  make(map[uuid.UUID]map[string]*Subscriber),
	}
}

// Register adiciona um assinante ao hub
func (h *RealtimeHub) Register(sub *Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.subscribers[sub.ID] = sub

	if sub.TenantID != uuid.Nil {
		if h.tenantSubs[sub.TenantID] == nil {
			h.tenantSubs[sub.TenantID] = make(map[string]*Subscriber)
		}
		h.tenantSubs[sub.TenantID][sub.ID] = sub
	}
}

// Unregister remove um assinante
func (h *RealtimeHub) Unregister(sub *Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.subscribers, sub.ID)

	if sub.TenantID != uuid.Nil && h.tenantSubs[sub.TenantID] != nil {
		delete(h.tenantSubs[sub.TenantID], sub.ID)
		if len(h.tenantSubs[sub.TenantID]) == 0 {
			delete(h.tenantSubs, sub.TenantID)
		}
	}

	for ticketID := range sub.TicketIDs {
		if h.ticketSubs[ticketID] != nil {
			delete(h.ticketSubs[ticketID], sub.ID)
			if len(h.ticketSubs[ticketID]) == 0 {
				delete(h.ticketSubs, ticketID)
			}
		}
	}

	close(sub.Send)
}

// SubscribeTicket inscreve um cliente para receber atualizações de um chamado específico
func (h *RealtimeHub) SubscribeTicket(subID string, ticketID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	sub, ok := h.subscribers[subID]
	if !ok {
		return
	}

	sub.mu.Lock()
	sub.TicketIDs[ticketID] = true
	sub.mu.Unlock()

	if h.ticketSubs[ticketID] == nil {
		h.ticketSubs[ticketID] = make(map[string]*Subscriber)
	}
	h.ticketSubs[ticketID][subID] = sub
}

// BroadcastToTenant envia mensagem a todos os técnicos de um determinado tenant
func (h *RealtimeHub) BroadcastToTenant(tenantID uuid.UUID, msg HubMessage) {
	h.mu.RLock()
	subsMap := h.tenantSubs[tenantID]
	if len(subsMap) == 0 {
		h.mu.RUnlock()
		return
	}

	// Copia lista de canais para enviar fora do lock
	channels := make([]chan []byte, 0, len(subsMap))
	for _, sub := range subsMap {
		channels = append(channels, sub.Send)
	}
	h.mu.RUnlock()

	msg.Timestamp = time.Now().UTC()
	raw, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[RealtimeHub] Erro ao serializar broadcast de tenant: %v", err)
		return
	}

	for _, ch := range channels {
		select {
		case ch <- raw:
		default:
			// Canal cheio, descarta silenciosamente para não bloquear
		}
	}
}

// BroadcastToTicket envia mensagem para técnicos e clientes no chat do ticket
func (h *RealtimeHub) BroadcastToTicket(ticketID uuid.UUID, msg HubMessage) {
	h.mu.RLock()
	subsMap := h.ticketSubs[ticketID]
	if len(subsMap) == 0 {
		h.mu.RUnlock()
		return
	}

	channels := make([]chan []byte, 0, len(subsMap))
	for _, sub := range subsMap {
		channels = append(channels, sub.Send)
	}
	h.mu.RUnlock()

	msg.Timestamp = time.Now().UTC()
	raw, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[RealtimeHub] Erro ao serializar broadcast de ticket: %v", err)
		return
	}

	for _, ch := range channels {
		select {
		case ch <- raw:
		default:
		}
	}
}

// PumpSubscriber escuta mensagens e envia via WebSocket
func PumpSubscriber(conn *websocket.Conn, sub *Subscriber) {
	for raw := range sub.Send {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, raw); err != nil {
			break
		}
	}
}
