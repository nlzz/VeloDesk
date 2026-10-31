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

	if req.Slug == "" || req.Email == "" || req.Password == "" {
		ErrorResponse(w, http.StatusBadRequest, "Slug, e-mail e senha são obrigatórios")
		return
	}

	tenant, err := h.store.GetTenantBySlug(r.Context(), req.Slug)
	if err != nil {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant ou credenciais inválidas")
		return
	}

	user, err := h.store.GetUserByEmail(r.Context(), tenant.ID, req.Email)
	if err != nil {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant ou credenciais inválidas")
		return
	}

	valid, err := auth.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !valid {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant ou credenciais inválidas")
		return
	}

	token, err := auth.GenerateToken(h.cfg.JWTSecret, tenant.ID, user.ID, user.Name, user.Email, user.Role, 24*time.Hour)
	if err != nil {
		ErrorResponse(w, http.StatusInternalServerError, "Falha ao gerar sessão")
		return
	}

	// Registra evento de login na auditoria
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

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.Email,
			"role":  user.Role,
		},
		"tenant": map[string]interface{}{
			"id":            tenant.ID,
			"name":          tenant.Name,
			"slug":          tenant.Slug,
			"logo_url":      tenant.LogoURL,
			"primary_color": tenant.PrimaryColor,
		},
	})
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
