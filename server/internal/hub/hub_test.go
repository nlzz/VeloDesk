package hub

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRealtimeHubTenantAndTicketBroadcast(t *testing.T) {
	h := NewRealtimeHub()
	tenantA := uuid.New()
	tenantB := uuid.New()
	ticket1 := uuid.New()

	subTechA := NewSubscriber("tech-a", tenantA, "TECH_UNATTENDED")
	subTechB := NewSubscriber("tech-b", tenantB, "TECH_ATTENDED")
	subClient := NewSubscriber("client-1", uuid.Nil, "CLIENT")

	h.Register(subTechA)
	h.Register(subTechB)
	h.Register(subClient)

	// Inscreve cliente e técnico no chamado 1
	h.SubscribeTicket("client-1", ticket1)
	h.SubscribeTicket("tech-a", ticket1)

	// 1. Broadcast para Tenant A: Novo Chamado
	h.BroadcastToTenant(tenantA, HubMessage{
		Type:     TypeNewTicket,
		TenantID: tenantA.String(),
		Payload: map[string]string{
			"subject": "Ajuda com VPN",
		},
	})

	// Tech A deve receber
	select {
	case msg := <-subTechA.Send:
		var hm HubMessage
		if err := json.Unmarshal(msg, &hm); err != nil {
			t.Fatalf("Erro ao deserializar mensagem: %v", err)
		}
		if hm.Type != TypeNewTicket {
			t.Fatalf("Tipo incorreto recebido: %s", hm.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Tech A não recebeu broadcast de novo chamado")
	}

	// Tech B (Tenant B) NÃO deve receber
	select {
	case msg := <-subTechB.Send:
		t.Fatalf("Vazamento entre tenants! Tech B recebeu mensagem de Tenant A: %s", string(msg))
	default:
		// Correto: Tech B não recebeu
	}

	// 2. Broadcast de Mensagem no Chat do Ticket 1
	h.BroadcastToTicket(ticket1, HubMessage{
		Type:     TypeTicketMessage,
		TicketID: ticket1.String(),
		Payload: map[string]string{
			"sender":  "Suporte",
			"message": "Olá, qual erro aparece?",
		},
	})

	// Cliente deve receber
	select {
	case msg := <-subClient.Send:
		var hm HubMessage
		_ = json.Unmarshal(msg, &hm)
		if hm.Type != TypeTicketMessage {
			t.Fatalf("Cliente recebeu tipo errado: %s", hm.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Cliente não recebeu mensagem de chat do ticket")
	}

	h.Unregister(subTechA)
	h.Unregister(subTechB)
	h.Unregister(subClient)
}
