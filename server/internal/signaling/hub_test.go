package signaling

import (
	"encoding/json"
	"testing"
	"time"

	"velodesk-server/internal/config"
)

func TestHubRegistrationAndSession(t *testing.T) {
	cfg := &config.Config{
		TurnSecret: "test_secret",
		StunURL:    "stun:stun.test:3478",
		TurnURL:    "turn:turn.test:3478",
		TurnTTL:    3600 * time.Second,
	}

	hub := NewHub(cfg)

	// Simula Host Agent
	agentClient := &Client{
		Hub:  hub,
		Send: make(chan []byte, 10),
	}

	regMsg, _ := json.Marshal(RegisterMessage{
		Type:         TypeRegister,
		AgentID:      "123-456-789",
		Hostname:     "host-pc",
		Version:      "1.0.0",
		PasswordHash: "secret_hash",
	})

	hub.HandleMessage(agentClient, regMsg)

	if agentClient.ID != "123-456-789" {
		t.Fatalf("expected agent ID 123-456-789, got %s", agentClient.ID)
	}

	// Verifica se recebeu RegisterAck
	select {
	case ackRaw := <-agentClient.Send:
		var ack RegisterAckMessage
		if err := json.Unmarshal(ackRaw, &ack); err != nil {
			t.Fatalf("failed to parse ack: %v", err)
		}
		if ack.Type != TypeRegisterAck || ack.Status != "ok" {
			t.Fatalf("unexpected ack status: %+v", ack)
		}
		if ack.TURNCredentials == nil || len(ack.TURNCredentials.ICEServers) != 2 {
			t.Fatalf("missing TURN credentials in register ack")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for register ack")
	}

	// Simula Viewer tentando conectar com senha errada
	viewerClient := &Client{
		Hub:  hub,
		Send: make(chan []byte, 10),
	}

	connectWrongPwd, _ := json.Marshal(ConnectRequestMessage{
		Type:         TypeConnectRequest,
		TargetID:     "123-456-789",
		PasswordHash: "wrong_hash",
	})

	hub.HandleMessage(viewerClient, connectWrongPwd)

	select {
	case errRaw := <-viewerClient.Send:
		var errMsg ConnectErrorMessage
		json.Unmarshal(errRaw, &errMsg)
		if errMsg.Type != TypeConnectError {
			t.Fatalf("expected connect error for wrong password, got: %s", errMsg.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for connect error")
	}

	// Simula Viewer conectando com senha correta
	connectValid, _ := json.Marshal(ConnectRequestMessage{
		Type:         TypeConnectRequest,
		TargetID:     "123-456-789",
		PasswordHash: "secret_hash",
		OperatorInfo: "Tech Operator",
	})

	hub.HandleMessage(viewerClient, connectValid)

	// Agent deve receber IncomingConnection
	var sessionID string
	select {
	case incRaw := <-agentClient.Send:
		var inc IncomingConnectionMessage
		json.Unmarshal(incRaw, &inc)
		if inc.Type != TypeIncomingConnection {
			t.Fatalf("expected incoming connection, got: %s", inc.Type)
		}
		sessionID = inc.SessionID
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for incoming connection")
	}

	// Viewer deve receber ConnectAck
	select {
	case ackRaw := <-viewerClient.Send:
		var ack ConnectAckMessage
		json.Unmarshal(ackRaw, &ack)
		if ack.Type != TypeConnectAck || ack.SessionID != sessionID {
			t.Fatalf("unexpected connect ack: %+v", ack)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for connect ack")
	}

	// Testa repasse de SDP Offer (Host -> Viewer)
	offerMsg, _ := json.Marshal(WebRTCOfferMessage{
		Type:      TypeWebRTCOffer,
		SessionID: sessionID,
		SDP:       "v=0\r\no=...",
	})

	hub.HandleMessage(agentClient, offerMsg)

	select {
	case fwdRaw := <-viewerClient.Send:
		var fwd WebRTCOfferMessage
		json.Unmarshal(fwdRaw, &fwd)
		if fwd.SDP != "v=0\r\no=..." {
			t.Fatalf("unexpected forwarded SDP: %s", fwd.SDP)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for forwarded offer")
	}
}
