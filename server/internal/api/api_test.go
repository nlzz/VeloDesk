package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"velodesk-server/internal/audit"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/database"
	"velodesk-server/internal/hub"
)

func setupTestServer(t *testing.T) (*http.ServeMux, database.Store, *config.Config, *database.Tenant, *database.User) {
	cfg := config.LoadConfig()
	store := database.NewMemoryStore()
	auditMgr := audit.NewManager([]byte(cfg.AuditMasterKey))
	realtimeHub := hub.NewRealtimeHub()

	// Cria Tenant de teste
	tenant := &database.Tenant{
		Name:         "Escritório Alfa",
		Slug:         "escritorio-alfa",
		PrimaryColor: "#10B981",
		LogoURL:      "https://example.com/logo.png",
	}
	if err := store.CreateTenant(context.Background(), tenant); err != nil {
		t.Fatalf("Erro ao criar tenant: %v", err)
	}

	// Cria Usuário com hash Argon2id
	passHash, err := auth.HashPassword("SenhaForte2026!", &auth.Argon2Params{
		Memory:      16 * 1024,
		Iterations:  1,
		Parallelism: 2,
		SaltLength:  16,
		KeyLength:   32,
	})
	if err != nil {
		t.Fatalf("Erro ao gerar hash: %v", err)
	}

	user := &database.User{
		TenantID:     tenant.ID,
		Name:         "Técnico de Suporte",
		Email:        "tech@alfa.com",
		PasswordHash: passHash,
		Role:         database.RoleTechUnattended,
	}
	if err := store.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("Erro ao criar usuário: %v", err)
	}

	mux := http.NewServeMux()
	SetupRouter(mux, store, cfg, realtimeHub, auditMgr)

	return mux, store, cfg, tenant, user
}

func TestAPILoginAndBranding(t *testing.T) {
	mux, _, _, tenant, _ := setupTestServer(t)

	// 1. Testa Branding Público (/api/v1/tenants/escritorio-alfa)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenants/escritorio-alfa", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Status esperado 200, obtido: %d", rr.Code)
	}

	var brandResp map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &brandResp); err != nil {
		t.Fatalf("Erro ao decodificar JSON: %v", err)
	}
	if brandResp["slug"] != "escritorio-alfa" || brandResp["primary_color"] != "#10B981" {
		t.Fatalf("Branding incorreto retornado: %+v", brandResp)
	}

	// 2. Testa Login do Técnico
	loginBody, _ := json.Marshal(LoginRequest{
		Slug:     tenant.Slug,
		Email:    "tech@alfa.com",
		Password: "SenhaForte2026!",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRR := httptest.NewRecorder()
	mux.ServeHTTP(loginRR, loginReq)

	if loginRR.Code != http.StatusOK {
		t.Fatalf("Login falhou com status %d: %s", loginRR.Code, loginRR.Body.String())
	}

	var loginResp map[string]interface{}
	if err := json.Unmarshal(loginRR.Body.Bytes(), &loginResp); err != nil {
		t.Fatalf("Erro ao decodificar resposta de login: %v", err)
	}

	token, ok := loginResp["token"].(string)
	if !ok || token == "" {
		t.Fatal("Token JWT não retornado no login")
	}

	// 3. Testa listagem de dispositivos com o Token JWT obtido
	devReq := httptest.NewRequest(http.MethodGet, "/api/v1/devices", nil)
	devReq.Header.Set("Authorization", "Bearer "+token)
	devReq.Header.Set("X-Tenant-Slug", tenant.Slug)
	devRR := httptest.NewRecorder()
	mux.ServeHTTP(devRR, devReq)

	if devRR.Code != http.StatusOK {
		t.Fatalf("Listagem de dispositivos falhou: %d - %s", devRR.Code, devRR.Body.String())
	}
}

func TestAPITicketsAndAuditTrail(t *testing.T) {
	mux, _, cfg, tenant, user := setupTestServer(t)

	// Gera token direto para o técnico
	token, err := auth.GenerateToken(cfg.JWTSecret, tenant.ID, user.ID, user.Name, user.Email, user.Role, 1*time.Hour)
	if err != nil {
		t.Fatalf("Erro ao gerar token: %v", err)
	}

	// 1. Cliente abre chamado via POST /api/v1/tickets
	ticketBody, _ := json.Marshal(map[string]interface{}{
		"subject":         "Erro no SPED Fiscal",
		"requester_name":  "Maria Financeiro",
		"agent_id":        "123-456-789",
		"screenshot_data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	})
	ticketReq := httptest.NewRequest(http.MethodPost, "/api/v1/tickets", bytes.NewReader(ticketBody))
	ticketReq.Header.Set("Content-Type", "application/json")
	ticketReq.Header.Set("X-Tenant-Slug", tenant.Slug)
	ticketRR := httptest.NewRecorder()
	mux.ServeHTTP(ticketRR, ticketReq)

	if ticketRR.Code != http.StatusCreated {
		t.Fatalf("Falha ao criar ticket: %d - %s", ticketRR.Code, ticketRR.Body.String())
	}

	var createdTicket database.Ticket
	if err := json.Unmarshal(ticketRR.Body.Bytes(), &createdTicket); err != nil {
		t.Fatalf("Erro ao decodificar ticket: %v", err)
	}

	// 2. Enviar mensagem de chat no chamado
	msgBody, _ := json.Marshal(map[string]string{
		"sender_name": "Técnico de Suporte",
		"sender_type": "TECH",
		"message":     "Estamos verificando seu sistema.",
	})
	msgURL := fmt.Sprintf("/api/v1/tickets/%s/messages", createdTicket.ID)
	msgReq := httptest.NewRequest(http.MethodPost, msgURL, bytes.NewReader(msgBody))
	msgReq.Header.Set("Authorization", "Bearer "+token)
	msgReq.Header.Set("Content-Type", "application/json")
	msgRR := httptest.NewRecorder()
	mux.ServeHTTP(msgRR, msgReq)

	if msgRR.Code != http.StatusCreated {
		t.Fatalf("Falha ao enviar mensagem de chat: %d - %s", msgRR.Code, msgRR.Body.String())
	}

	// 3. Validação da Trilha Forense Tamper-Evident (/api/v1/audit/verify)
	verifyReq := httptest.NewRequest(http.MethodGet, "/api/v1/audit/verify", nil)
	verifyReq.Header.Set("Authorization", "Bearer "+token)
	verifyReq.Header.Set("X-Tenant-Slug", tenant.Slug)
	verifyRR := httptest.NewRecorder()
	mux.ServeHTTP(verifyRR, verifyReq)

	if verifyRR.Code != http.StatusOK {
		t.Fatalf("Verificação de auditoria falhou com status %d: %s", verifyRR.Code, verifyRR.Body.String())
	}

	var verifyResp map[string]interface{}
	if err := json.Unmarshal(verifyRR.Body.Bytes(), &verifyResp); err != nil {
		t.Fatalf("Erro ao decodificar resposta: %v", err)
	}

	if verified, ok := verifyResp["verified"].(bool); !ok || !verified {
		t.Fatalf("A integridade da trilha de auditoria falhou: %+v", verifyResp)
	}
}
