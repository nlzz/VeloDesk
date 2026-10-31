package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/audit"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/database"
)

type AuthHandler struct {
	store    database.Store
	cfg      *config.Config
	auditMgr *audit.Manager
}

func NewAuthHandler(store database.Store, cfg *config.Config, auditMgr *audit.Manager) *AuthHandler {
	return &AuthHandler{
		store:    store,
		cfg:      cfg,
		auditMgr: auditMgr,
	}
}

type LoginRequest struct {
	Slug      string `json:"slug"`
	Email     string `json:"email"`
	Password  string `json:"password"`
	MFASecret string `json:"mfa_secret,omitempty"`
}

type SuperAdminLoginRequest struct {
	Password string `json:"password"`
}

func (h *AuthHandler) HandleTenantLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		ErrorResponse(w, http.StatusBadRequest, "Payload de login inválido")
		return
	}

	if req.Email == "" || req.Password == "" {
		ErrorResponse(w, http.StatusBadRequest, "E-mail e senha são obrigatórios")
		return
	}

	var user *database.User
	var tenant *database.Tenant
	var err error

	if req.Slug != "" {
		tenant, err = h.store.GetTenantBySlug(r.Context(), req.Slug)
		if err != nil {
			ErrorResponse(w, http.StatusUnauthorized, "Tenant ou credenciais inválidas")
			return
		}
		user, err = h.store.GetUserByEmail(r.Context(), tenant.ID, req.Email)
	} else {
		user, err = h.store.GetUserByEmailGlobal(r.Context(), req.Email)
		if err == nil && user.TenantID != uuid.Nil {
			tenant, _ = h.store.GetTenantByID(r.Context(), user.TenantID)
		}
	}

	if err != nil || user == nil {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant ou credenciais inválidas")
		return
	}

	if user.Status == database.UserStatusBlocked {
		ErrorResponse(w, http.StatusForbidden, "Usuário bloqueado pelo administrador")
		return
	}

	if tenant != nil && tenant.Status == database.TenantStatusBlocked {
		ErrorResponse(w, http.StatusForbidden, "Empresa bloqueada pelo administrador")
		return
	}

	valid, err := auth.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !valid {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant ou credenciais inválidas")
		return
	}

	token, err := auth.GenerateToken(h.cfg.JWTSecret, user.TenantID, user.ID, user.Name, user.Email, user.Role, 24*time.Hour)
	if err != nil {
		ErrorResponse(w, http.StatusInternalServerError, "Falha ao gerar sessão")
		return
	}

	// Registra evento de login na auditoria se houver tenant
	if tenant != nil {
		lastEvt, _ := h.store.GetLastAuditEvent(r.Context(), tenant.ID)
		auditEvt, err := h.auditMgr.CreateAuditEvent(tenant.ID, lastEvt, "AUTH_LOGIN", map[string]interface{}{
			"user_id": user.ID.String(),
			"email":   user.Email,
			"role":    user.Role,
			"ip":      r.RemoteAddr,
		}, time.Now().UTC())
		if err == nil {
			_ = h.store.AppendAuditEvent(r.Context(), auditEvt)
		}
	}

	resp := map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":        user.ID,
			"tenant_id": user.TenantID,
			"name":      user.Name,
			"email":     user.Email,
			"role":      user.Role,
			"status":    user.Status,
		},
	}
	if tenant != nil {
		resp["tenant"] = map[string]interface{}{
			"id":            tenant.ID,
			"name":          tenant.Name,
			"slug":          tenant.Slug,
			"logo_url":      tenant.LogoURL,
			"primary_color": tenant.PrimaryColor,
			"status":        tenant.Status,
			"max_devices":   tenant.MaxDevices,
		}
	}

	JSONResponse(w, http.StatusOK, resp)
}

// HandleMe valida a sessão do token e retorna dados do usuário logado
func (h *AuthHandler) HandleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	claimsVal := r.Context().Value(ContextKeyClaims)
	if claimsVal == nil {
		ErrorResponse(w, http.StatusUnauthorized, "Não autenticado")
		return
	}
	claims := claimsVal.(*auth.JWTClaims)

	user, err := h.store.GetUserByIDGlobal(r.Context(), claims.UserID)
	if err != nil {
		ErrorResponse(w, http.StatusNotFound, "Usuário não localizado")
		return
	}

	resp := map[string]interface{}{
		"user": map[string]interface{}{
			"id":        user.ID,
			"tenant_id": user.TenantID,
			"name":      user.Name,
			"email":     user.Email,
			"role":      user.Role,
			"status":    user.Status,
		},
	}

	if user.TenantID != uuid.Nil {
		if tenant, err := h.store.GetTenantByID(r.Context(), user.TenantID); err == nil {
			resp["tenant"] = map[string]interface{}{
				"id":            tenant.ID,
				"name":          tenant.Name,
				"slug":          tenant.Slug,
				"logo_url":      tenant.LogoURL,
				"primary_color": tenant.PrimaryColor,
				"status":        tenant.Status,
				"max_devices":   tenant.MaxDevices,
			}
		}
	}

	JSONResponse(w, http.StatusOK, resp)
}

func (h *AuthHandler) HandleSuperAdminLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	var req SuperAdminLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
		return
	}

	if req.Password != h.cfg.SuperAdminPassword {
		ErrorResponse(w, http.StatusUnauthorized, "Senha de Super Admin incorreta")
		return
	}

	superAdminID := uuid.New()
	token, err := auth.GenerateToken(h.cfg.JWTSecret, uuid.Nil, superAdminID, "Super Administrator", "admin@velodesk.global", database.RoleSuperAdmin, 12*time.Hour)
	if err != nil {
		ErrorResponse(w, http.StatusInternalServerError, "Erro ao gerar token")
		return
	}

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":    superAdminID,
			"name":  "Super Administrator",
			"email": "admin@velodesk.global",
			"role":  database.RoleSuperAdmin,
		},
	})
}
