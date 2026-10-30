package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/signaling"
)

type Handler struct {
	hub      *signaling.Hub
	cfg      *config.Config
	upgrader websocket.Upgrader
}

func NewHandler(hub *signaling.Hub, cfg *config.Config) *Handler {
	return &Handler{
		hub: hub,
		cfg: cfg,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024 * 64,
			WriteBufferSize: 1024 * 64,
			CheckOrigin: func(r *http.Request) bool {
				// Permite origens cruzadas para o Web Client PWA e ferramentas de teste
				return true
			},
		},
	}
}

// HandleWebSocket processa o upgrade de requisições HTTP para conexão WebSocket de sinalização
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Signaling] Falha no upgrade WebSocket: %v", err)
		return
	}

	client := signaling.NewClient(h.hub, conn)
	go client.WritePump()
	client.ReadPump()
}

// HandleHealth retorna o status de integridade do servidor e contadores de conexão
func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	stats := h.hub.GetStats()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "velodesk-signaling",
		"version": "1.0.0",
		"stats":   stats,
	})
}

// HandleTURNCredentials entrega credenciais efêmeras TURN via API REST (RFC 5766)
func (h *Handler) HandleTURNCredentials(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		clientID = "rest-client"
	}

	creds := auth.GenerateTURNCredentials(
		h.cfg.TurnSecret,
		h.cfg.StunURL,
		h.cfg.TurnURL,
		clientID,
		h.cfg.TurnTTL,
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(creds)
}
