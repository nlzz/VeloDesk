package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/audit"
	"velodesk-server/internal/database"
	"velodesk-server/internal/hub"
)

type TicketHandler struct {
	store       database.Store
	realtimeHub *hub.RealtimeHub
	auditMgr    *audit.Manager
}

func NewTicketHandler(store database.Store, realtimeHub *hub.RealtimeHub, auditMgr *audit.Manager) *TicketHandler {
	return &TicketHandler{
		store:       store,
		realtimeHub: realtimeHub,
		auditMgr:    auditMgr,
	}
}

// HandleTickets lida com a listagem e criação de novos chamados
func (h *TicketHandler) HandleTickets(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant não identificado")
		return
	}

	switch r.Method {
	case http.MethodGet:
		tickets, err := h.store.ListTickets(r.Context(), tenantID)
		if err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao listar chamados")
			return
		}
		if tickets == nil {
			tickets = []database.Ticket{}
		}
		JSONResponse(w, http.StatusOK, tickets)

	case http.MethodPost:
		var req struct {
			Subject        string     `json:"subject"`
			RequesterName  string     `json:"requester_name"`
			DeviceID       *uuid.UUID `json:"device_id,omitempty"`
			AgentID        string     `json:"agent_id,omitempty"`
			ScreenshotData string     `json:"screenshot_data,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			ErrorResponse(w, http.StatusBadRequest, "Payload inválido")
			return
		}

		if req.Subject == "" || req.RequesterName == "" {
			ErrorResponse(w, http.StatusBadRequest, "Assunto e solicitante são obrigatórios")
			return
		}

		ticket := &database.Ticket{
			ID:             uuid.New(),
			TenantID:       tenantID,
			DeviceID:       req.DeviceID,
			AgentID:        req.AgentID,
			RequesterName:  req.RequesterName,
			Subject:        req.Subject,
			Status:         database.TicketPending,
			ScreenshotData: req.ScreenshotData,
		}

		if err := h.store.CreateTicket(r.Context(), ticket); err != nil {
			ErrorResponse(w, http.StatusInternalServerError, "Erro ao salvar chamado")
			return
		}

		// Broadcast em tempo real para os técnicos do Tenant
		h.realtimeHub.BroadcastToTenant(tenantID, hub.HubMessage{
			Type:     hub.TypeNewTicket,
			TenantID: tenantID.String(),
			TicketID: ticket.ID.String(),
			Payload: map[string]interface{}{
				"id":             ticket.ID,
				"subject":        ticket.Subject,
				"requester_name": ticket.RequesterName,
				"agent_id":       ticket.AgentID,
				"created_at":     ticket.CreatedAt,
			},
		})

		// Registra na cadeia de auditoria
		lastEvt, _ := h.store.GetLastAuditEvent(r.Context(), tenantID)
		auditEvt, err := h.auditMgr.CreateAuditEvent(tenantID, lastEvt, "TICKET_CREATED", map[string]interface{}{
			"ticket_id": ticket.ID.String(),
			"subject":   ticket.Subject,
			"requester": ticket.RequesterName,
			"agent_id":  ticket.AgentID,
		}, time.Now().UTC())
		if err == nil {
			_ = h.store.AppendAuditEvent(r.Context(), auditEvt)
		}

		JSONResponse(w, http.StatusCreated, ticket)

	default:
		ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
	}
}

// HandleTicketOperations lida com rotas aninhadas (/api/v1/tickets/:id/*)
func (h *TicketHandler) HandleTicketOperations(w http.ResponseWriter, r *http.Request) {
	tenantID := GetEffectiveTenantID(r)
	if tenantID == uuid.Nil {
		ErrorResponse(w, http.StatusUnauthorized, "Tenant não identificado")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/tickets/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		ErrorResponse(w, http.StatusBadRequest, "ID do chamado ausente")
		return
	}

	ticketID, err := uuid.Parse(parts[0])
	if err != nil {
		ErrorResponse(w, http.StatusBadRequest, "ID do chamado inválido")
		return
	}

	// Operações em /api/v1/tickets/:id
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			ticket, err := h.store.GetTicketByID(r.Context(), tenantID, ticketID)
			if err != nil {
				ErrorResponse(w, http.StatusNotFound, "Chamado não encontrado")
				return
			}
			JSONResponse(w, http.StatusOK, ticket)

		case http.MethodPut:
			// Atualização de Status
			var req struct {
				Status string `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				ErrorResponse(w, http.StatusBadRequest, "JSON inválido")
				return
			}

			if err := h.store.UpdateTicketStatus(r.Context(), tenantID, ticketID, req.Status); err != nil {
				ErrorResponse(w, http.StatusBadRequest, "Falha ao atualizar status do chamado")
				return
			}

			h.realtimeHub.BroadcastToTenant(tenantID, hub.HubMessage{
				Type:     hub.TypeTicketUpdate,
				TenantID: tenantID.String(),
				TicketID: ticketID.String(),
				Payload:  map[string]string{"status": req.Status},
			})

			JSONResponse(w, http.StatusOK, map[string]string{"status": req.Status})

		default:
			ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		}
		return
	}

	// Operações em /api/v1/tickets/:id/messages
	if parts[1] == "messages" {
		switch r.Method {
		case http.MethodGet:
			msgs, err := h.store.ListTicketMessages(r.Context(), tenantID, ticketID)
			if err != nil {
				ErrorResponse(w, http.StatusInternalServerError, "Erro ao buscar mensagens")
				return
			}
			if msgs == nil {
				msgs = []database.TicketMessage{}
			}
			JSONResponse(w, http.StatusOK, msgs)

		case http.MethodPost:
			var req struct {
				SenderType string `json:"sender_type"` // USER, TECH
				SenderName string `json:"sender_name"`
				Message    string `json:"message"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				ErrorResponse(w, http.StatusBadRequest, "JSON inválido")
				return
			}

			if req.Message == "" || req.SenderName == "" {
				ErrorResponse(w, http.StatusBadRequest, "Mensagem e remetente são obrigatórios")
				return
			}

			msg := &database.TicketMessage{
				ID:         uuid.New(),
				TenantID:   tenantID,
				TicketID:   ticketID,
				SenderType: req.SenderType,
				SenderName: req.SenderName,
				Message:    req.Message,
			}

			if err := h.store.AddTicketMessage(r.Context(), msg); err != nil {
				ErrorResponse(w, http.StatusInternalServerError, "Erro ao salvar mensagem")
				return
			}

			// Notifica em tempo real
			h.realtimeHub.BroadcastToTicket(ticketID, hub.HubMessage{
				Type:     hub.TypeTicketMessage,
				TenantID: tenantID.String(),
				TicketID: ticketID.String(),
				Payload:  msg,
			})

			JSONResponse(w, http.StatusCreated, msg)

		default:
			ErrorResponse(w, http.StatusMethodNotAllowed, "Método não permitido")
		}
		return
	}

	ErrorResponse(w, http.StatusNotFound, "Rota não encontrada")
}
