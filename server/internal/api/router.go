package api

import (
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"velodesk-server/internal/audit"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/database"
	"velodesk-server/internal/hub"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Permite Web / PWA Cross-Origin
	},
}

// SetupRouter monta e orquestra todas as rotas da API REST e WebSockets do Hub
func SetupRouter(
	mux *http.ServeMux,
	store database.Store,
	cfg *config.Config,
	realtimeHub *hub.RealtimeHub,
	auditMgr *audit.Manager,
) {
	authHandler := NewAuthHandler(store, cfg, auditMgr)
	tenantHandler := NewTenantHandler(store)
	deviceHandler := NewDeviceHandler(store)
	ticketHandler := NewTicketHandler(store, realtimeHub, auditMgr)
	sessionHandler := NewSessionHandler(store, auditMgr)
	auditHandler := NewAuditHandler(store, auditMgr)

	// Middlewares
	tenantMiddleware := TenantMiddleware(store)
	authMiddleware := AuthMiddleware(cfg.JWTSecret)
	optionalAuth := OptionalAuthMiddleware(cfg.JWTSecret)
	adminRole := RequireRoles(database.RoleAdmin, database.RoleSuperAdmin)
	techRoles := RequireRoles(database.RoleAdmin, database.RoleTechUnattended, database.RoleTechAttended, database.RoleAuditor, database.RoleSuperAdmin)

	// 1. Rotas Públicas de Autenticação e Branding
	mux.HandleFunc("/api/v1/auth/login", authHandler.HandleTenantLogin)
	mux.HandleFunc("/api/v1/super-admin/login", authHandler.HandleSuperAdminLogin)
	mux.HandleFunc("/api/v1/tenants/", tenantHandler.HandleGetPublicTenant)

	// 2. Rotas de Super Admin
	mux.Handle("/api/v1/super-admin/tenants", authMiddleware(RequireRoles(database.RoleSuperAdmin)(http.HandlerFunc(tenantHandler.HandleSuperAdminTenants))))

	// 3. Usuários do Tenant (Admin do Tenant ou Super Admin)
	mux.Handle("/api/v1/tenants/users", tenantMiddleware(authMiddleware(adminRole(http.HandlerFunc(tenantHandler.HandleTenantUsers)))))

	// 4. Dispositivos, Grupos e Tags
	mux.Handle("/api/v1/devices", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(deviceHandler.HandleDevices)))))
	mux.Handle("/api/v1/devices/", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(deviceHandler.HandleDeviceTagAssign)))))
	mux.Handle("/api/v1/groups", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(deviceHandler.HandleGroups)))))
	mux.Handle("/api/v1/tags", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(deviceHandler.HandleTags)))))

	// 5. Chamados e Chat Helpdesk (Técnico e abertura pelo cliente)
	mux.HandleFunc("/api/v1/tickets", func(w http.ResponseWriter, r *http.Request) {
		tenantMiddleware(optionalAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet {
				authMiddleware(techRoles(http.HandlerFunc(ticketHandler.HandleTickets))).ServeHTTP(w, r)
			} else {
				// POST pode ser chamado pelo cliente da ponta com tenant_id ou pelo técnico
				ticketHandler.HandleTickets(w, r)
			}
		}))).ServeHTTP(w, r)
	})

	mux.HandleFunc("/api/v1/tickets/", func(w http.ResponseWriter, r *http.Request) {
		tenantMiddleware(optionalAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ticketHandler.HandleTicketOperations(w, r)
		}))).ServeHTTP(w, r)
	})

	// 6. Sessões e Transferências de Arquivos
	mux.Handle("/api/v1/sessions", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(sessionHandler.HandleSessions)))))
	mux.Handle("/api/v1/sessions/", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(sessionHandler.HandleSessionOperations)))))

	// 7. Trilha de Auditoria Forense e Verificação Criptográfica
	mux.Handle("/api/v1/audit/events", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(auditHandler.HandleAuditEvents)))))
	mux.Handle("/api/v1/audit/verify", tenantMiddleware(authMiddleware(techRoles(http.HandlerFunc(auditHandler.HandleAuditVerify)))))

	// 8. WebSocket do Hub em Tempo Real (Chat fora da sessão, notificações push e alertas de tickets)
	mux.HandleFunc("/ws/hub", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[RealtimeHub] Erro de upgrade WebSocket: %v", err)
			return
		}

		tokenStr := r.URL.Query().Get("token")
		tenantSlug := r.URL.Query().Get("tenant")
		ticketIDStr := r.URL.Query().Get("ticket_id")

		var subTenantID uuid.UUID
		var subRole = "ANONYMOUS"

		if tokenStr != "" {
			claims, err := auth.ValidateToken(cfg.JWTSecret, tokenStr)
			if err == nil {
				subTenantID = claims.TenantID
				subRole = claims.Role
			}
		}

		if subTenantID == uuid.Nil && tenantSlug != "" {
			if t, err := store.GetTenantBySlug(r.Context(), tenantSlug); err == nil {
				subTenantID = t.ID
			}
		}

		subID := uuid.New().String()
		subscriber := hub.NewSubscriber(subID, subTenantID, subRole)
		realtimeHub.Register(subscriber)

		if ticketIDStr != "" {
			if tid, err := uuid.Parse(ticketIDStr); err == nil {
				realtimeHub.SubscribeTicket(subID, tid)
			}
		}

		defer func() {
			realtimeHub.Unregister(subscriber)
			_ = conn.Close()
		}()

		go hub.PumpSubscriber(conn, subscriber)

		// Loop de leitura de mensagens do cliente (ex: chat em tempo real)
		for {
			_, msgRaw, err := conn.ReadMessage()
			if err != nil {
				break
			}

			// Se o cliente enviar uma mensagem de chat ou ping
			var incoming struct {
				Type     string `json:"type"`
				TicketID string `json:"ticket_id,omitempty"`
				Message  string `json:"message,omitempty"`
				Sender   string `json:"sender,omitempty"`
			}
			if err := strings.TrimSpace(string(msgRaw)); len(err) > 0 {
				_ = strings.Clone(err)
			}
			_ = incoming
		}
	})
}
