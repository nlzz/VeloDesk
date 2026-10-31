package api

import (
	"net/http"

	"velodesk-server/internal/audit"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/database"
)

type AuditHandler struct {
	store    database.Store
	auditMgr *audit.Manager
}

func NewAuditHandler(store database.Store, auditMgr *audit.Manager) *AuditHandler {
	return &AuditHandler{
		store:    store,
		auditMgr: auditMgr,
	}
}

// HandleAuditEvents lista os eventos forenses registrados
func (h *AuditHandler) HandleAuditEvents(w http.ResponseWriter, r *http.Request) {
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

	events, err := h.store.ListAuditEvents(r.Context(), claims.TenantID)
	if err != nil {
		ErrorResponse(w, http.StatusInternalServerError, "Erro ao buscar trilha de auditoria")
		return
	}
	if events == nil {
		events = []database.AuditEvent{}
	}

	JSONResponse(w, http.StatusOK, events)
}

// HandleAuditVerify verifica matematicamente toda a cadeia Tamper-Evident do tenant
func (h *AuditHandler) HandleAuditVerify(w http.ResponseWriter, r *http.Request) {
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

	events, err := h.store.ListAuditEvents(r.Context(), claims.TenantID)
	if err != nil {
		ErrorResponse(w, http.StatusInternalServerError, "Erro ao buscar eventos")
		return
	}

	valid, verifyErr := h.auditMgr.VerifyChain(events)
	if !valid || verifyErr != nil {
		JSONResponse(w, http.StatusOK, map[string]interface{}{
			"verified":     false,
			"total_events": len(events),
			"error":        verifyErr.Error(),
			"message":      "ALERTA FORENSE: Adulteração ou quebra de elos detectada na cadeia de auditoria!",
		})
		return
	}

	JSONResponse(w, http.StatusOK, map[string]interface{}{
		"verified":     true,
		"total_events": len(events),
		"message":      "Cadeia criptográfica íntegra e sem adulterações (Tamper-Evident Verified).",
	})
}
