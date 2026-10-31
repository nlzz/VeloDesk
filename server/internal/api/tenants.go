package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/database"
)

type TenantHandler struct {
	store database.Store
}

func NewTenantHandler(store database.Store) *TenantHandler {
	return &TenantHandler{store: store}
}

// HandleGetPublicTenant retorna informações visuais do tenant para login e branding
func (h *TenantHandler) HandleGetPublicTenant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/tenants/")
	slug := strings.Trim(path, "/")
	if slug == "" {
		ErrorResponse(w, http.StatusBadRequest, "Slug do tenant não informado")
		return
	}

	tenant, err := h.store.GetTenantBySlug(r.Context(), slug)
	if err != nil {
		ErrorResponse(w, http.StatusNotFound, "Tenant não encontrado")
		return
	}

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"id":            tenant.ID,
		"name":          tenant.Name,
		"slug":          tenant.Slug,
		"logo_url":      tenant.LogoURL,
		"primary_color": tenant.PrimaryColor,
		"max_devices":   tenant.MaxDevices,
	})
}

// HandleSuperAdminTenants gerencia lista e cadastro de novos tenants
func (h *TenantHandler) HandleSuperAdminTenants(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenants, err := h.store.ListTenants(r.Context())
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar tenants")
			return
		}
		JSONResponse(w, http.StatusOK, tenants)

	case http.MethodPost:
		var req struct {
			Name         string `json:"name"`
			Slug         string `json:"slug"`
			LogoURL      string `json:"logo_url"`
			PrimaryColor string `json:"primary_color"`
			MaxDevices   int    `json:"max_devices"`
			AdminEmail   string `json:"admin_email"`
			AdminName    string `json:"admin_name"`
			AdminPass    string `json:"admin_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "JSON inválido")
			return
		}

		if req.Name == "" || req.Slug == "" {
			ErrorResponse(w, http.StatusBadRequest, "Nome e slug são obrigatórios")
			return
		}
		if req.PrimaryColor == "" {
			req.PrimaryColor = "#2563EB"
		}
		if req.MaxDevices <= 0 {
			req.MaxDevices = 50
		}

		tenant := &database.Tenant{
			ID:           uuid.New(),
			Name:         req.Name,
			Slug:         req.Slug,
			LogoURL:      req.LogoURL,
			PrimaryColor: req.PrimaryColor,
			MaxDevices:   req.MaxDevices,
		}

		if err := h.store.CreateTenant(r.Context(), tenant); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Slug já existente ou erro ao criar tenant")
			return
		}

		// Se fornecido admin inicial, cria usuário
		if req.AdminEmail != "" && req.AdminPass != "" {
			passHash, err := auth.HashPassword(req.AdminPass, auth.DefaultArgon2Params)
			if err == nil {
				adminUser := &database.User{
					ID:           uuid.New(),
					TenantID:     tenant.ID,
					Name:         req.AdminName,
					Email:        req.AdminEmail,
					PasswordHash: passHash,
					Role:         database.RoleAdmin,
				}
				_ = h.store.CreateUser(r.Context(), adminUser)
			}
		}

		JSONResponse(w, http.StatusCreated, tenant)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleTenantUsers gerencia usuários dentro de um Tenant
func (h *TenantHandler) HandleTenantUsers(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		users, err := h.store.ListUsers(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar usuários")
			return
		}
		JSONResponse(w, http.StatusOK, users)

	case http.MethodPost:
		var req struct {
			Name     string `json:"name"`
			Email    string `json:"email"`
			Password string `json:"password"`
			Role     string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		if req.Name == "" || req.Email == "" || req.Password == "" || req.Role == "" {
			ErrorResponse(w, http.StatusBadRequest, "Todos os campos são obrigatórios")
			return
		}

		passHash, err := auth.HashPassword(req.Password, auth.DefaultArgon2Params)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Falha ao gerar hash da senha")
			return
		}

		user := &database.User{
			ID:           uuid.New(),
			TenantID:     tenantID,
			Name:         req.Name,
			Email:        req.Email,
			PasswordHash: passHash,
			Role:         req.Role,
		}

		if err := h.store.CreateUser(r.Context(), user); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Usuário já existente ou erro ao salvar")
			return
		}

		JSONResponse(w, http.StatusCreated, map[string]interface{}{
			"id":        user.ID,
			"tenant_id": user.TenantID,
			"name":      user.Name,
			"email":     user.Email,
			"role":      user.Role,
		})

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}
