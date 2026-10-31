package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

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

// HandleWebSocket processa o upgrade de requisições HTTP para conexão WebSocket de sinalização,
// exigindo compulsoriamente a validação de token JWT no handshake.
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}
	if tokenStr == "" {
		proto := r.Header.Get("Sec-WebSocket-Protocol")
		if proto != "" {
			parts := strings.Split(proto, ",")
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if strings.HasPrefix(p, "bearer.") || strings.HasPrefix(p, "token.") {
					tokenStr = strings.TrimPrefix(strings.TrimPrefix(p, "bearer."), "token.")
					break
				}
			}
		}
	}

	if tokenStr == "" {
		http.Error(w, `{"error":true,"message":"Token JWT obrigatório para conexão de sinalização"}`, http.StatusUnauthorized)
		return
	}

	claims, err := auth.ValidateToken(h.cfg.JWTSecret, tokenStr)
	if err != nil {
		http.Error(w, `{"error":true,"message":"Token JWT inválido ou expirado"}`, http.StatusUnauthorized)
		return
	}

	var responseHeader http.Header
	if proto := r.Header.Get("Sec-WebSocket-Protocol"); proto != "" {
		responseHeader = http.Header{
			"Sec-WebSocket-Protocol": []string{proto},
		}
	}

	conn, err := h.upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Printf("[Signaling] Falha no upgrade WebSocket: %v", err)
		return
	}

	client := signaling.NewClient(h.hub, conn)
	_ = claims
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
