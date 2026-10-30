package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/signaling"
)

func TestIntegrationEndpoints(t *testing.T) {
	cfg := &config.Config{
		Port:       "0",
		TurnSecret: "integration_secret",
		StunURL:    "stun:127.0.0.1:3478",
		TurnURL:    "turn:127.0.0.1:3478",
		TurnTTL:    3600 * time.Second,
	}

	hub := signaling.NewHub(cfg)
	h := NewHandler(hub, cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.HandleWebSocket)
	mux.HandleFunc("/api/v1/health", h.HandleHealth)
	mux.HandleFunc("/api/v1/turn-credentials", h.HandleTURNCredentials)

	server := httptest.NewServer(mux)
	defer server.Close()

	// 1. Testa /api/v1/health
	res, err := http.Get(server.URL + "/api/v1/health")
	if err != nil {
		t.Fatalf("failed to GET /health: %v", err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from /health, got %d", res.StatusCode)
	}

	// 2. Testa /api/v1/turn-credentials
	resTurn, err := http.Get(server.URL + "/api/v1/turn-credentials?client_id=test-agent")
	if err != nil {
		t.Fatalf("failed to GET /turn-credentials: %v", err)
	}
	var turnResp auth.TURNCredentialsResponse
	if err := json.NewDecoder(resTurn.Body).Decode(&turnResp); err != nil {
		t.Fatalf("failed to decode turn response: %v", err)
	}
	if len(turnResp.ICEServers) != 2 {
		t.Fatalf("expected 2 ICE servers, got %d", len(turnResp.ICEServers))
	}

	// 3. Testa WebSocket /ws
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect websocket: %v", err)
	}
	defer wsConn.Close()

	// Envia registro
	regMsg := signaling.RegisterMessage{
		Type:     signaling.TypeRegister,
		AgentID:  "999-888-777",
		Hostname: "test-host",
	}
	if err := wsConn.WriteJSON(regMsg); err != nil {
		t.Fatalf("failed to send register: %v", err)
	}

	// Recebe RegisterAck
	var ack signaling.RegisterAckMessage
	if err := wsConn.ReadJSON(&ack); err != nil {
		t.Fatalf("failed to read register ack: %v", err)
	}
	if ack.Type != signaling.TypeRegisterAck || ack.AgentID != "999-888-777" {
		t.Fatalf("unexpected register ack: %+v", ack)
	}
}
