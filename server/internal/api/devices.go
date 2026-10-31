package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"velodesk-server/internal/database"
)

type DeviceHandler struct {
	store database.Store
}

func NewDeviceHandler(store database.Store) *DeviceHandler {
	return &DeviceHandler{store: store}
}

// HandleDevices lida com a listagem e registro de dispositivos
func (h *DeviceHandler) HandleDevices(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		devices, err := h.store.ListDevices(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar dispositivos")
			return
		}
		if devices == nil {
			devices = []database.Device{}
		}
		JSONResponse(w, http.StatusOK, devices)

	case http.MethodPost:
		var req struct {
			AgentID  string     `json:"agent_id"`
			Hostname string     `json:"hostname"`
			OSInfo   string     `json:"os_info"`
			Status   string     `json:"status"`
			GroupID  *uuid.UUID `json:"group_id,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		if req.AgentID == "" || req.Hostname == "" {
			ErrorResponse(w, http.StatusBadRequest, "AgentID e Hostname são obrigatórios")
			return
		}

		device := &database.Device{
			TenantID: tenantID,
			AgentID:  req.AgentID,
			Hostname: req.Hostname,
			OSInfo:   req.OSInfo,
			Status:   req.Status,
			GroupID:  req.GroupID,
		}

		if err := h.store.UpsertDevice(r.Context(), device); err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Falha ao registrar dispositivo")
			return
		}

		JSONResponse(w, http.StatusOK, device)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleGroups gerencia os grupos hierárquicos do tenant
func (h *DeviceHandler) HandleGroups(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		groups, err := h.store.ListDeviceGroups(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao buscar grupos")
			return
		}
		if groups == nil {
			groups = []database.DeviceGroup{}
		}
		JSONResponse(w, http.StatusOK, groups)

	case http.MethodPost:
		var req struct {
			Name     string     `json:"name"`
			ParentID *uuid.UUID `json:"parent_id,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}
		if req.Name == "" {
			ErrorResponse(w, http.StatusBadRequest, "Nome do grupo é obrigatório")
			return
		}

		group := &database.DeviceGroup{
			TenantID: tenantID,
			Name:     req.Name,
			ParentID: req.ParentID,
		}

		if err := h.store.CreateDeviceGroup(r.Context(), group); err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao salvar grupo")
			return
		}
		JSONResponse(w, http.StatusCreated, group)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleTags gerencia etiquetas coloridas (#EF4444, #10B981)
func (h *DeviceHandler) HandleTags(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		tags, err := h.store.ListTags(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar tags")
			return
		}
		if tags == nil {
			tags = []database.Tag{}
		}
		JSONResponse(w, http.StatusOK, tags)

	case http.MethodPost:
		var req struct {
			Name     string `json:"name"`
			ColorHex string `json:"color_hex"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}
		if req.Name == "" {
			ErrorResponse(w, http.StatusBadRequest, "Nome da tag é obrigatório")
			return
		}
		if req.ColorHex == "" {
			req.ColorHex = "#3B82F6"
		}

		tag := &database.Tag{
			TenantID: tenantID,
			Name:     req.Name,
			ColorHex: req.ColorHex,
		}

		if err := h.store.CreateTag(r.Context(), tag); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Tag já existe ou erro ao criar")
			return
		}
		JSONResponse(w, http.StatusCreated, tag)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleDeviceTagAssign vincula uma tag a um dispositivo
func (h *DeviceHandler) HandleDeviceTagAssign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		return
	}

	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/devices/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[1] != "tags" {
		ErrorResponse(w, http.StatusBadRequest, "URL inválida")
		return
	}

	deviceID, err := uuid.Parse(parts[0])
	if err != nil {
		ErrorResponse(w, http.StatusBadRequest, "Device ID inválido")
		return
	}

	var req struct {
		TagID uuid.UUID `json:"tag_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
		return
	}

	if err := h.store.AssignDeviceTag(r.Context(), tenantID, deviceID, req.TagID); err != nil {
		ErrorResponse(w, http.StatusBadRequest, "Falha ao associar tag")
		return
	}

	JSONResponse(w, http.StatusOK, map[string]bool{"success": true})
}
