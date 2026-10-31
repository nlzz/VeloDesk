package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/audit"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/database"
)

type SessionHandler struct {
	store    database.Store
	auditMgr *audit.Manager
}

func NewSessionHandler(store database.Store, auditMgr *audit.Manager) *SessionHandler {
	return &SessionHandler{
		store:    store,
		auditMgr: auditMgr,
	}
}

// HandleSessions gerencia listagem e início de sessões de controle remoto
func (h *SessionHandler) HandleSessions(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	claimsVal := r.Context().Value(ContextKeyClaims)
	var claims *auth.JWTClaims
	if claimsVal != nil {
		claims = claimsVal.(*auth.JWTClaims)
	}

	switch r.Method {
	case http.MethodGet:
		sessions, err := h.store.ListSessions(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar sessões")
			return
		}
		if sessions == nil {
			sessions = []database.SessionLog{}
		}
		JSONResponse(w, http.StatusOK, sessions)

	case http.MethodPost:
		var req struct {
			SessionID string `json:"session_id"`
			AgentID   string `json:"agent_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		var techUserID *uuid.UUID
		var techName string
		if claims != nil {
			techUserID = &claims.UserID
			techName = claims.Name
		}

		session := &database.SessionLog{
			ID:         uuid.New(),
			TenantID:   tenantID,
			SessionID:  req.SessionID,
			AgentID:    req.AgentID,
			TechUserID: techUserID,
			TechName:   techName,
			Status:     "ACTIVE",
			StartedAt:  time.Now().UTC(),
		}

		if err := h.store.CreateSession(r.Context(), session); err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Falha ao registrar sessão")
			return
		}

		// Registra evento de auditoria
		lastEvt, _ := h.store.GetLastAuditEvent(r.Context(), tenantID)
		techIDStr := ""
		if techUserID != nil {
			techIDStr = techUserID.String()
		}
		auditEvt, err := h.auditMgr.CreateAuditEvent(tenantID, lastEvt, "SESSION_STARTED", map[string]interface{}{
			"session_id": req.SessionID,
			"agent_id":   req.AgentID,
			"tech_id":    techIDStr,
			"tech_name":  techName,
		}, time.Now().UTC())
		if err == nil {
			_ = h.store.AppendAuditEvent(r.Context(), auditEvt)
		}

		JSONResponse(w, http.StatusCreated, session)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleSessionOperations lida com /api/v1/sessions/:id/*
func (h *SessionHandler) HandleSessionOperations(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusBadRequest, "Tenant não identificado")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/sessions/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		ErrorResponse(w, http.StatusBadRequest, "SessionID ausente")
		return
	}
	sessionID := parts[0]

	// /api/v1/sessions/:id/close
	if len(parts) >= 2 && parts[1] == "close" {
		if r.Method != http.MethodPost {
			ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
			return
		}

		var req struct {
			Status          string `json:"status"` // CLOSED, TERMINATED_BY_USER
			DurationSeconds int    `json:"duration_seconds"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Status == "" {
			req.Status = "CLOSED"
		}

		if err := h.store.CloseSession(r.Context(), tenantID, sessionID, req.Status, req.DurationSeconds); err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Falha ao encerrar sessão")
			return
		}

		// Registra auditoria
		lastEvt, _ := h.store.GetLastAuditEvent(r.Context(), tenantID)
		auditEvt, err := h.auditMgr.CreateAuditEvent(tenantID, lastEvt, "SESSION_ENDED", map[string]interface{}{
			"session_id":       sessionID,
			"status":           req.Status,
			"duration_seconds": req.DurationSeconds,
		}, time.Now().UTC())
		if err == nil {
			_ = h.store.AppendAuditEvent(r.Context(), auditEvt)
		}

		JSONResponse(w, http.StatusOK, map[string]bool{"closed": true})
		return
	}

	// /api/v1/sessions/:id/transfers
	if len(parts) >= 2 && parts[1] == "transfers" {
		switch r.Method {
		case http.MethodGet:
			transfers, err := h.store.ListFileTransfers(r.Context(), tenantID, sessionID)
			if err != nil {
				ErrorResponse(w, http.StatusInternalServerError, "Erro ao buscar transferências")
				return
			}
			if transfers == nil {
				transfers = []database.FileTransfer{}
			}
			JSONResponse(w, http.StatusOK, transfers)

		case http.MethodPost:
			var req struct {
				Filename   string `json:"filename"`
				FileSize   int64  `json:"file_size"`
				SHA256Hash string `json:"sha256_hash"`
				Direction  string `json:"direction"`
				Status     string `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
				return
			}

			ft := &database.FileTransfer{
				ID:         uuid.New(),
				TenantID:   tenantID,
				SessionID:  sessionID,
				Filename:   req.Filename,
				FileSize:   req.FileSize,
				SHA256Hash: req.SHA256Hash,
				Direction:  req.Direction,
				Status:     req.Status,
			}

			if err := h.store.CreateFileTransfer(r.Context(), ft); err != nil {
				ErrorResponse(w, http.StatusInternalServerError, "Erro ao registrar transferência")
				return
			}

			// Auditoria Forense do Arquivo
			lastEvt, _ := h.store.GetLastAuditEvent(r.Context(), tenantID)
			auditEvt, err := h.auditMgr.CreateAuditEvent(tenantID, lastEvt, "FILE_TRANSFER", map[string]interface{}{
				"session_id":  sessionID,
				"filename":    req.Filename,
				"file_size":   req.FileSize,
				"sha256_hash": req.SHA256Hash,
				"direction":   req.Direction,
				"status":      req.Status,
			}, time.Now().UTC())
			if err == nil {
				_ = h.store.AppendAuditEvent(r.Context(), auditEvt)
			}

			JSONResponse(w, http.StatusCreated, ft)

		default:
			ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		}
		return
	}

	ErrorResponse(w, http.StatusNotFound, "Rota de sessão não encontrada")
}
