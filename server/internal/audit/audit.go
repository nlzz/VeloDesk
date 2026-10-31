package audit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/database"
)

var (
	ErrBrokenSequence       = errors.New("quebra de sequência numérica nos eventos de auditoria")
	ErrPreviousHashMismatch = errors.New("inconsistência no hash do evento anterior (cadeia violada)")
	ErrPayloadHashMismatch  = errors.New("payload corrompido ou adulterado")
	ErrHMACSignatureInvalid = errors.New("assinatura HMAC inválida (adulteração detectada)")
)

// GenesisHash é o hash padrão para o primeiro evento da cadeia.
const GenesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

// Manager gerencia a criação e verificação da cadeia de auditoria.
type Manager struct {
	masterKey []byte
}

// NewManager instancia o gerenciador com a chave mestra HMAC.
func NewManager(masterKey []byte) *Manager {
	return &Manager{
		masterKey: masterKey,
	}
}

// ComputePayloadHash calcula o hash SHA-256 canônico dos dados do evento.
func ComputePayloadHash(tenantID uuid.UUID, eventType string, details map[string]interface{}, createdAt time.Time) (string, error) {
	canonicalJSON, err := json.Marshal(details)
	if err != nil {
		return "", fmt.Errorf("falha ao serializar detalhes do evento: %w", err)
	}

	hasher := sha256.New()
	hasher.Write([]byte(tenantID.String()))
	hasher.Write([]byte(":"))
	hasher.Write([]byte(eventType))
	hasher.Write([]byte(":"))
	hasher.Write(canonicalJSON)
	hasher.Write([]byte(":"))
	hasher.Write([]byte(createdAt.UTC().Format(time.RFC3339Nano)))

	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// ComputeHMAC calcula a assinatura HMAC-SHA256 do elo da cadeia.
func (m *Manager) ComputeHMAC(tenantID uuid.UUID, seq int64, prevHash, payloadHash string) string {
	mac := hmac.New(sha256.New, m.masterKey)
	message := fmt.Sprintf("%s:%d:%s:%s", tenantID.String(), seq, prevHash, payloadHash)
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// CreateAuditEvent cria e sela o próximo elo na cadeia de auditoria do tenant.
func (m *Manager) CreateAuditEvent(
	tenantID uuid.UUID,
	lastEvent *database.AuditEvent,
	eventType string,
	details map[string]interface{},
	timestamp time.Time,
) (*database.AuditEvent, error) {
	if details == nil {
		details = make(map[string]interface{})
	}

	var seq int64 = 1
	prevHash := GenesisHash

	if lastEvent != nil {
		seq = lastEvent.SequenceNumber + 1
		// O hash anterior é o HMAC do elo anterior, encadeando a criptografia
		prevHash = lastEvent.HMACSHA256
	}

	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}

	payloadHash, err := ComputePayloadHash(tenantID, eventType, details, timestamp)
	if err != nil {
		return nil, err
	}

	hmacSig := m.ComputeHMAC(tenantID, seq, prevHash, payloadHash)

	event := &database.AuditEvent{
		ID:                uuid.New(),
		TenantID:          tenantID,
		SequenceNumber:    seq,
		PreviousEventHash: prevHash,
		PayloadHash:       payloadHash,
		HMACSHA256:        hmacSig,
		EventType:         eventType,
		Details:           details,
		CreatedAt:         timestamp,
	}

	return event, nil
}

// VerifyChain valida matematicamente a integridade de uma lista ordenada de eventos.
func (m *Manager) VerifyChain(events []database.AuditEvent) (bool, error) {
	if len(events) == 0 {
		return true, nil
	}

	expectedPrevHash := GenesisHash
	for i, evt := range events {
		expectedSeq := int64(i + 1)
		if evt.SequenceNumber != expectedSeq {
			return false, fmt.Errorf("%w: esperado seq %d, obtido %d", ErrBrokenSequence, expectedSeq, evt.SequenceNumber)
		}

		if evt.PreviousEventHash != expectedPrevHash {
			return false, fmt.Errorf("%w no evento %d", ErrPreviousHashMismatch, evt.SequenceNumber)
		}

		calculatedPayloadHash, err := ComputePayloadHash(evt.TenantID, evt.EventType, evt.Details, evt.CreatedAt)
		if err != nil {
			return false, fmt.Errorf("falha ao recalcular payload: %w", err)
		}

		if calculatedPayloadHash != evt.PayloadHash {
			return false, fmt.Errorf("%w no evento %d", ErrPayloadHashMismatch, evt.SequenceNumber)
		}

		calculatedHMAC := m.ComputeHMAC(evt.TenantID, evt.SequenceNumber, evt.PreviousEventHash, evt.PayloadHash)
		if calculatedHMAC != evt.HMACSHA256 {
			return false, fmt.Errorf("%w no evento %d", ErrHMACSignatureInvalid, evt.SequenceNumber)
		}

		expectedPrevHash = evt.HMACSHA256
	}

	return true, nil
}
