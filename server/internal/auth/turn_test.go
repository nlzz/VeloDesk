package auth

import (
	"testing"
	"time"
)

func TestGenerateTURNCredentials(t *testing.T) {
	secret := "test_secret_key"
	stunURL := "stun:stun.example.com:3478"
	turnURL := "turn:turn.example.com:3478"
	clientID := "agent-123-456"
	ttl := 1 * time.Hour

	creds := GenerateTURNCredentials(secret, stunURL, turnURL, clientID, ttl)

	if len(creds.ICEServers) != 2 {
		t.Fatalf("expected 2 ICE servers, got %d", len(creds.ICEServers))
	}

	stunServer := creds.ICEServers[0]
	if len(stunServer.URLs) != 1 || stunServer.URLs[0] != stunURL {
		t.Errorf("unexpected STUN URL: %v", stunServer.URLs)
	}

	turnServer := creds.ICEServers[1]
	if turnServer.Username == "" {
		t.Errorf("expected non-empty username")
	}
	if turnServer.Credential == "" {
		t.Errorf("expected non-empty credential")
	}

	// Valida autenticação
	if !ValidateTURNAuth(secret, turnServer.Username, turnServer.Credential) {
		t.Errorf("expected ValidateTURNAuth to return true for generated credentials")
	}

	// Valida se falha com chave incorreta
	if ValidateTURNAuth("wrong_secret", turnServer.Username, turnServer.Credential) {
		t.Errorf("expected ValidateTURNAuth to fail with wrong secret")
	}
}
