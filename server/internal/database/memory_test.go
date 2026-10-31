package database

import (
	"context"
	"testing"
)

func TestMemoryStoreTenantIsolation(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	// Tenant A
	tenantA := &Tenant{
		Name:         "Escritório Alfa",
		Slug:         "escritorio-alfa",
		PrimaryColor: "#10B981",
	}
	if err := store.CreateTenant(ctx, tenantA); err != nil {
		t.Fatalf("Erro ao criar Tenant A: %v", err)
	}

	// Tenant B
	tenantB := &Tenant{
		Name:         "Contabilidade Beta",
		Slug:         "beta-contabil",
		PrimaryColor: "#EF4444",
	}
	if err := store.CreateTenant(ctx, tenantB); err != nil {
		t.Fatalf("Erro ao criar Tenant B: %v", err)
	}

	// User no Tenant A
	userA := &User{
		TenantID:     tenantA.ID,
		Name:         "Técnico Alfa",
		Email:        "tech@alfa.com",
		PasswordHash: "dummyhash",
		Role:         RoleTechUnattended,
	}
	if err := store.CreateUser(ctx, userA); err != nil {
		t.Fatalf("Erro ao criar User A: %v", err)
	}

	// Dispositivo no Tenant A
	devA := &Device{
		TenantID: tenantA.ID,
		AgentID:  "111-222-333",
		Hostname: "PC-Alfa-01",
		Status:   "ONLINE",
	}
	if err := store.UpsertDevice(ctx, devA); err != nil {
		t.Fatalf("Erro ao inserir Device A: %v", err)
	}

	// Dispositivo no Tenant B
	devB := &Device{
		TenantID: tenantB.ID,
		AgentID:  "444-555-666",
		Hostname: "PC-Beta-01",
		Status:   "ONLINE",
	}
	if err := store.UpsertDevice(ctx, devB); err != nil {
		t.Fatalf("Erro ao inserir Device B: %v", err)
	}

	// Validação de Isolamento RLS: Listar devices do Tenant A
	devicesA, err := store.ListDevices(ctx, tenantA.ID)
	if err != nil {
		t.Fatalf("Erro ao listar dispositivos de A: %v", err)
	}
	if len(devicesA) != 1 || devicesA[0].AgentID != "111-222-333" {
		t.Fatalf("Dispositivos de A vazaram ou estão incorretos: %+v", devicesA)
	}

	// Validação de Isolamento RLS: Listar devices do Tenant B
	devicesB, err := store.ListDevices(ctx, tenantB.ID)
	if err != nil {
		t.Fatalf("Erro ao listar dispositivos de B: %v", err)
	}
	if len(devicesB) != 1 || devicesB[0].AgentID != "444-555-666" {
		t.Fatalf("Dispositivos de B vazaram ou estão incorretos: %+v", devicesB)
	}

	// Chamados (Tickets) e Isolamento
	ticketA := &Ticket{
		TenantID:      tenantA.ID,
		RequesterName: "Cliente Alfa",
		Subject:       "Ajuda com impressora",
	}
	if err := store.CreateTicket(ctx, ticketA); err != nil {
		t.Fatalf("Erro ao criar ticket A: %v", err)
	}

	// Consulta de ticket de A tentando passar tenantB.ID deve dar ErrNotFound
	_, err = store.GetTicketByID(ctx, tenantB.ID, ticketA.ID)
	if err != ErrNotFound {
		t.Fatalf("Falha no isolamento: Tenant B conseguiu acessar ticket de Tenant A! Erro: %v", err)
	}

	// Tenant A acessa normalmente
	foundTicket, err := store.GetTicketByID(ctx, tenantA.ID, ticketA.ID)
	if err != nil || foundTicket.Subject != "Ajuda com impressora" {
		t.Fatalf("Tenant A não encontrou seu próprio ticket: %v", err)
	}
}
