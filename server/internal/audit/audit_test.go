package audit

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/database"
)

func TestAuditHashChainAndTamperDetection(t *testing.T) {
	masterKey := []byte("secret_master_audit_key_1234567890")
	mgr := NewManager(masterKey)
	tenantID := uuid.New()

	var events []database.AuditEvent

	// Cria evento 1 (Gênese)
	now := time.Now().UTC()
	evt1, err := mgr.CreateAuditEvent(tenantID, nil, "SESSION_START", map[string]interface{}{
		"agent_id": "123-456-789",
		"tech":     "suporte@escritorioalfa.com",
	}, now)
	if err != nil {
		t.Fatalf("Erro ao criar evento 1: %v", err)
	}
	events = append(events, *evt1)

	// Cria evento 2
	evt2, err := mgr.CreateAuditEvent(tenantID, evt1, "FILE_TRANSFER", map[string]interface{}{
		"filename":    "relatorio.pdf",
		"sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	}, now.Add(10*time.Second))
	if err != nil {
		t.Fatalf("Erro ao criar evento 2: %v", err)
	}
	events = append(events, *evt2)

	// Cria evento 3
	evt3, err := mgr.CreateAuditEvent(tenantID, evt2, "SESSION_END", map[string]interface{}{
		"duration_seconds": 120,
	}, now.Add(120*time.Second))
	if err != nil {
		t.Fatalf("Erro ao criar evento 3: %v", err)
	}
	events = append(events, *evt3)

	// 1. Valida cadeia íntegra
	valid, err := mgr.VerifyChain(events)
	if err != nil || !valid {
		t.Fatalf("Cadeia legítima falhou na validação: %v", err)
	}

	// 2. Tenta adulteração no payload do evento 2
	tamperedEvents := make([]database.AuditEvent, len(events))
	copy(tamperedEvents, events)
	tamperedEvents[1].Details = map[string]interface{}{
		"filename":    "malware.exe", // Adulteração do nome do arquivo
		"sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	}

	validTampered, err := mgr.VerifyChain(tamperedEvents)
	if validTampered || err == nil {
		t.Fatal("Adulteração de payload não foi detectada pelo verificador de auditoria!")
	}

	// 3. Tenta quebra de sequência (deletando evento 2)
	deletedEvents := []database.AuditEvent{events[0], events[2]}
	validDeleted, err := mgr.VerifyChain(deletedEvents)
	if validDeleted || err == nil {
		t.Fatal("Deleção de evento intermediário não foi detectada!")
	}
}
