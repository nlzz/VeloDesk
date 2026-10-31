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

	"github.com/google/uuid"
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

func TestSuperAdminAndAuthEndpoints(t *testing.T) {
	mux, store, cfg, tenant, user := setupTestServer(t)

	// 1. Testa Login Global (apenas e-mail + senha com Argon2id, sem slug)
	loginBody, _ := json.Marshal(map[string]string{
		"email":    user.Email,
		"password": "SenhaForte2026!",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRR := httptest.NewRecorder()
	mux.ServeHTTP(loginRR, loginReq)

	if loginRR.Code != http.StatusOK {
		t.Fatalf("Login global falhou: %d - %s", loginRR.Code, loginRR.Body.String())
	}

	var loginResp map[string]interface{}
	if err := json.Unmarshal(loginRR.Body.Bytes(), &loginResp); err != nil {
		t.Fatalf("Erro ao decodificar JSON do login: %v", err)
	}
	techToken := loginResp["token"].(string)

	// 2. Testa GET /api/v1/auth/me autenticado
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+techToken)
	meRR := httptest.NewRecorder()
	mux.ServeHTTP(meRR, meReq)

	if meRR.Code != http.StatusOK {
		t.Fatalf("GET /auth/me falhou: %d - %s", meRR.Code, meRR.Body.String())
	}

	// 3. Verifica que técnico comum recebe 403 ao tentar acessar /api/v1/admin/tenants
	adminTenantsReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/tenants", nil)
	adminTenantsReq.Header.Set("Authorization", "Bearer "+techToken)
	adminTenantsRR := httptest.NewRecorder()
	mux.ServeHTTP(adminTenantsRR, adminTenantsReq)

	if adminTenantsRR.Code != http.StatusForbidden {
		t.Fatalf("Esperava 403 Forbidden para técnico acessando /admin/tenants, obteve %d", adminTenantsRR.Code)
	}

	// 4. Cria Super-Admin e gera token
	superAdminPassHash, _ := auth.HashPassword("SuperSecret2026!", auth.DefaultArgon2Params)
	superAdmin := &database.User{
		TenantID:     uuid.Nil,
		Name:         "Master Admin",
		Email:        "super@velodesk.test",
		PasswordHash: superAdminPassHash,
		Role:         database.RoleSuperAdmin,
		Status:       database.UserStatusActive,
	}
	_ = store.CreateUser(context.Background(), superAdmin)

	superToken, err := auth.GenerateToken(cfg.JWTSecret, uuid.Nil, superAdmin.ID, superAdmin.Name, superAdmin.Email, superAdmin.Role, time.Hour)
	if err != nil {
		t.Fatalf("Erro ao gerar token de super-admin: %v", err)
	}

	// 5. Super-Admin lista empresas GET /api/v1/admin/tenants
	superListReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/tenants", nil)
	superListReq.Header.Set("Authorization", "Bearer "+superToken)
	superListRR := httptest.NewRecorder()
	mux.ServeHTTP(superListRR, superListReq)

	if superListRR.Code != http.StatusOK {
		t.Fatalf("SuperAdmin GET /admin/tenants falhou: %d - %s", superListRR.Code, superListRR.Body.String())
	}

	// 6. Super-Admin cria nova empresa POST /api/v1/admin/tenants
	newTenantBody, _ := json.Marshal(map[string]interface{}{
		"name":          "Escritório Beta",
		"slug":          "escritorio-beta",
		"primary_color": "#8B5CF6",
		"logo_url":      "https://example.com/beta.png",
		"max_devices":   75,
	})
	newTenantReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/tenants", bytes.NewReader(newTenantBody))
	newTenantReq.Header.Set("Authorization", "Bearer "+superToken)
	newTenantReq.Header.Set("Content-Type", "application/json")
	newTenantRR := httptest.NewRecorder()
	mux.ServeHTTP(newTenantRR, newTenantReq)

	if newTenantRR.Code != http.StatusCreated {
		t.Fatalf("POST /admin/tenants falhou: %d - %s", newTenantRR.Code, newTenantRR.Body.String())
	}

	var createdTenant database.Tenant
	_ = json.Unmarshal(newTenantRR.Body.Bytes(), &createdTenant)

	// 7. Super-Admin edita a empresa PUT /api/v1/admin/tenants/:id
	editBody, _ := json.Marshal(map[string]interface{}{
		"name":        "Escritório Beta Renovado",
		"max_devices": 120,
		"status":      "ACTIVE",
	})
	editReq := httptest.NewRequest(http.MethodPut, "/api/v1/admin/tenants/"+createdTenant.ID.String(), bytes.NewReader(editBody))
	editReq.Header.Set("Authorization", "Bearer "+superToken)
	editReq.Header.Set("Content-Type", "application/json")
	editRR := httptest.NewRecorder()
	mux.ServeHTTP(editRR, editReq)

	if editRR.Code != http.StatusOK {
		t.Fatalf("PUT /admin/tenants/:id falhou: %d - %s", editRR.Code, editRR.Body.String())
	}

	// 8. Super-Admin cria novo usuário POST /api/v1/admin/users
	newUserBody, _ := json.Marshal(map[string]interface{}{
		"tenant_id": createdTenant.ID.String(),
		"name":      "Novo Técnico Beta",
		"email":     "tech@beta.com",
		"password":  "SenhaBeta2026!",
		"role":      "TECHNICIAN",
	})
	newUserReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users", bytes.NewReader(newUserBody))
	newUserReq.Header.Set("Authorization", "Bearer "+superToken)
	newUserReq.Header.Set("Content-Type", "application/json")
	newUserRR := httptest.NewRecorder()
	mux.ServeHTTP(newUserRR, newUserReq)

	if newUserRR.Code != http.StatusCreated {
		t.Fatalf("POST /admin/users falhou: %d - %s", newUserRR.Code, newUserRR.Body.String())
	}

	// 9. Super-Admin lista todos os usuários GET /api/v1/admin/users
	listUsersReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	listUsersReq.Header.Set("Authorization", "Bearer "+superToken)
	listUsersRR := httptest.NewRecorder()
	mux.ServeHTTP(listUsersRR, listUsersReq)

	if listUsersRR.Code != http.StatusOK {
		t.Fatalf("GET /admin/users falhou: %d - %s", listUsersRR.Code, listUsersRR.Body.String())
	}

	// 10. Super-Admin audita o tenant 'escritorio-alfa' via X-Tenant-Slug
	superAuditTicketsReq := httptest.NewRequest(http.MethodGet, "/api/v1/tickets", nil)
	superAuditTicketsReq.Header.Set("Authorization", "Bearer "+superToken)
	superAuditTicketsReq.Header.Set("X-Tenant-Slug", tenant.Slug)
	superAuditTicketsRR := httptest.NewRecorder()
	mux.ServeHTTP(superAuditTicketsRR, superAuditTicketsReq)

	if superAuditTicketsRR.Code != http.StatusOK {
		t.Fatalf("SuperAdmin GET /api/v1/tickets com X-Tenant-Slug falhou: %d - %s", superAuditTicketsRR.Code, superAuditTicketsRR.Body.String())
	}

	// 11. Super-Admin cria grupo e tag no tenant 'escritorio-alfa'
	newGroupBody, _ := json.Marshal(map[string]interface{}{
		"name": "Servidores Alfa",
	})
	newGroupReq := httptest.NewRequest(http.MethodPost, "/api/v1/groups", bytes.NewReader(newGroupBody))
	newGroupReq.Header.Set("Authorization", "Bearer "+superToken)
	newGroupReq.Header.Set("X-Tenant-Slug", tenant.Slug)
	newGroupReq.Header.Set("Content-Type", "application/json")
	newGroupRR := httptest.NewRecorder()
	mux.ServeHTTP(newGroupRR, newGroupReq)

	if newGroupRR.Code != http.StatusCreated {
		t.Fatalf("SuperAdmin POST /api/v1/groups falhou: %d - %s", newGroupRR.Code, newGroupRR.Body.String())
	}

	newTagBody, _ := json.Marshal(map[string]interface{}{
		"name":      "VIP",
		"color_hex": "#10B981",
	})
	newTagReq := httptest.NewRequest(http.MethodPost, "/api/v1/tags", bytes.NewReader(newTagBody))
	newTagReq.Header.Set("Authorization", "Bearer "+superToken)
	newTagReq.Header.Set("X-Tenant-Slug", tenant.Slug)
	newTagReq.Header.Set("Content-Type", "application/json")
	newTagRR := httptest.NewRecorder()
	mux.ServeHTTP(newTagRR, newTagReq)

	if newTagRR.Code != http.StatusCreated {
		t.Fatalf("SuperAdmin POST /api/v1/tags falhou: %d - %s", newTagRR.Code, newTagRR.Body.String())
	}

	// 12. Super-Admin sem tenant especificado deve ser rejeitado em /api/v1/tickets com 401
	superNoTenantTicketsReq := httptest.NewRequest(http.MethodGet, "/api/v1/tickets", nil)
	superNoTenantTicketsReq.Header.Set("Authorization", "Bearer "+superToken)
	superNoTenantTicketsRR := httptest.NewRecorder()
	mux.ServeHTTP(superNoTenantTicketsRR, superNoTenantTicketsReq)

	if superNoTenantTicketsRR.Code != http.StatusUnauthorized {
		t.Fatalf("Esperava 401 Unauthorized para SuperAdmin sem tenant em /api/v1/tickets, obteve %d", superNoTenantTicketsRR.Code)
	}
}
