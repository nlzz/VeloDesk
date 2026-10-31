package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/database"
)

// AdminHandler gerencia operações exclusivas de administração master (Super-Admin) e tenants
type AdminHandler struct {
	store database.Store
	cfg   *config.Config
}

// NewAdminHandler inicializa o handler de administração
func NewAdminHandler(store database.Store, cfg *config.Config) *AdminHandler {
	return &AdminHandler{
		store: store,
		cfg:   cfg,
	}
}

// HandleAdminTenants gerencia a listagem e criação de empresas pelo Super-Admin
func (h *AdminHandler) HandleAdminTenants(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenants, err := h.store.ListTenants(r.Context())
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar empresas")
			return
		}

		// Popula contador de computadores para cada tenant
		for i := range tenants {
			count, _ := h.store.CountDevicesByTenant(r.Context(), tenants[i].ID)
			tenants[i].DeviceCount = count
		}

		JSONResponse(w, http.StatusOK, tenants)

	case http.MethodPost:
		var req struct {
			Name         string `json:"name"`
			Slug         string `json:"slug"`
			PrimaryColor string `json:"primary_color"`
			LogoURL      string `json:"logo_url"`
			MaxDevices   int    `json:"max_devices"`
			Status       string `json:"status"`
			AdminEmail   string `json:"admin_email"`
			AdminName    string `json:"admin_name"`
			AdminPass    string `json:"admin_password"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		req.Name = strings.TrimSpace(req.Name)
		req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
		if req.Name == "" || req.Slug == "" {
			ErrorResponse(w, http.StatusBadRequest, "Nome e slug da empresa são obrigatórios")
			return
		}

		if req.PrimaryColor == "" {
			req.PrimaryColor = "#2563EB"
		}
		if req.MaxDevices <= 0 {
			req.MaxDevices = 50
		}
		if req.Status == "" {
			req.Status = database.TenantStatusActive
		}

		tenant := &database.Tenant{
			ID:           uuid.New(),
			Name:         req.Name,
			Slug:         req.Slug,
			PrimaryColor: req.PrimaryColor,
			LogoURL:      req.LogoURL,
			MaxDevices:   req.MaxDevices,
			Status:       req.Status,
		}

		if err := h.store.CreateTenant(r.Context(), tenant); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Slug já existente ou falha ao salvar empresa")
			return
		}

		// Criação de Administrador Inicial se fornecido
		if req.AdminEmail != "" && req.AdminPass != "" {
			passHash, err := auth.HashPassword(req.AdminPass, auth.DefaultArgon2Params)
			if err == nil {
				adminName := req.AdminName
				if adminName == "" {
					adminName = "Administrador " + tenant.Name
				}
				adminUser := &database.User{
					ID:           uuid.New(),
					TenantID:     tenant.ID,
					Name:         adminName,
					Email:        req.AdminEmail,
					PasswordHash: passHash,
					Role:         database.RoleAdmin,
					Status:       database.UserStatusActive,
				}
				_ = h.store.CreateUser(r.Context(), adminUser)
			}
		}

		JSONResponse(w, http.StatusCreated, tenant)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleAdminTenantByID edita ou consulta uma empresa específica pelo ID
func (h *AdminHandler) HandleAdminTenantByID(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/tenants/")
	idStr = strings.Trim(idStr, "/")

	tenantID, err := uuid.Parse(idStr)
	if err != nil {
		ErrorResponse(w, http.StatusBadRequest, "ID de empresa inválido")
		return
	}

	switch r.Method {
	case http.MethodGet:
		tenant, err := h.store.GetTenantByID(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusNotFound, "Empresa não encontrada")
			return
		}
		count, _ := h.store.CountDevicesByTenant(r.Context(), tenant.ID)
		tenant.DeviceCount = count
		JSONResponse(w, http.StatusOK, tenant)

	case http.MethodPut:
		var req struct {
			Name         string `json:"name"`
			Slug         string `json:"slug"`
			PrimaryColor string `json:"primary_color"`
			LogoURL      string `json:"logo_url"`
			MaxDevices   int    `json:"max_devices"`
			Status       string `json:"status"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		tenant, err := h.store.GetTenantByID(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusNotFound, "Empresa não encontrada")
			return
		}

		if req.Name != "" {
			tenant.Name = strings.TrimSpace(req.Name)
		}
		if req.Slug != "" {
			tenant.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
		}
		if req.PrimaryColor != "" {
			tenant.PrimaryColor = req.PrimaryColor
		}
		if req.LogoURL != "" {
			tenant.LogoURL = req.LogoURL
		}
		if req.MaxDevices > 0 {
			tenant.MaxDevices = req.MaxDevices
		}
		if req.Status != "" {
			tenant.Status = strings.ToUpper(req.Status)
		}

		if err := h.store.UpdateTenant(r.Context(), tenant); err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao atualizar empresa")
			return
		}

		count, _ := h.store.CountDevicesByTenant(r.Context(), tenant.ID)
		tenant.DeviceCount = count
		JSONResponse(w, http.StatusOK, tenant)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleAdminUsers gerencia a listagem e criação de usuários (SUPERADMIN, ADMIN, TECHNICIAN)
func (h *AdminHandler) HandleAdminUsers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tenantIDStr := r.URL.Query().Get("tenant_id")
		var users []database.User
		var err error

		if tenantIDStr != "" {
			if tid, parseErr := uuid.Parse(tenantIDStr); parseErr == nil {
				users, err = h.store.ListUsers(r.Context(), tid)
			} else {
				ErrorResponse(w, http.StatusBadRequest, "tenant_id inválido")
				return
			}
		} else {
			users, err = h.store.ListAllUsers(r.Context())
		}

		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar usuários")
			return
		}

		// Sanitização: não retorna hashes de senha
		type UserResponse struct {
			ID        uuid.UUID `json:"id"`
			TenantID  uuid.UUID `json:"tenant_id"`
			Name      string    `json:"name"`
			Email     string    `json:"email"`
			Role      string    `json:"role"`
			Status    string    `json:"status"`
			CreatedAt string    `json:"created_at"`
		}
		respList := make([]UserResponse, 0, len(users))
		for _, u := range users {
			respList = append(respList, UserResponse{
				ID:        u.ID,
				TenantID:  u.TenantID,
				Name:      u.Name,
				Email:     u.Email,
				Role:      u.Role,
				Status:    u.Status,
				CreatedAt: u.CreatedAt.Format("2006-01-02 15:04:05"),
			})
		}

		JSONResponse(w, http.StatusOK, respList)

	case http.MethodPost:
		var req struct {
			TenantID uuid.UUID `json:"tenant_id"`
			Name     string    `json:"name"`
			Email    string    `json:"email"`
			Password string    `json:"password"`
			Role     string    `json:"role"`
			Status   string    `json:"status"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		req.Name = strings.TrimSpace(req.Name)
		req.Email = strings.TrimSpace(req.Email)
		req.Role = strings.ToUpper(strings.TrimSpace(req.Role))

		if req.Name == "" || req.Email == "" || req.Password == "" || req.Role == "" {
			ErrorResponse(w, http.StatusBadRequest, "Nome, e-mail, senha e papel (role) são obrigatórios")
			return
		}

		// Validação e normalização de roles
		switch req.Role {
		case database.RoleSuperAdmin, database.RoleLegacySuperAdmin:
			req.Role = database.RoleSuperAdmin
			req.TenantID = uuid.Nil
		case database.RoleAdmin:
			req.Role = database.RoleAdmin
		case database.RoleTechnician, database.RoleLegacyTechAttended, database.RoleLegacyTechUnattended:
			req.Role = database.RoleTechnician
		default:
			req.Role = database.RoleTechnician
		}

		if req.Status == "" {
			req.Status = database.UserStatusActive
		}

		passHash, err := auth.HashPassword(req.Password, auth.DefaultArgon2Params)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Falha ao gerar hash da senha")
			return
		}

		user := &database.User{
			ID:           uuid.New(),
			TenantID:     req.TenantID,
			Name:         req.Name,
			Email:        req.Email,
			PasswordHash: passHash,
			Role:         req.Role,
			Status:       req.Status,
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
			"status":    user.Status,
		})

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}
