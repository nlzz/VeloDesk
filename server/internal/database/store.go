package database

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrNotFound       = errors.New("recurso não encontrado")
	ErrAlreadyExists  = errors.New("recurso já cadastrado")
	ErrTenantMismatch = errors.New("acesso negado: violação de isolamento por tenant")
)

// Store define o contrato de persistência de dados do VeloDesk v2.0.
type Store interface {
	// Tenants
	CreateTenant(ctx context.Context, tenant *Tenant) error
	GetTenantByID(ctx context.Context, id uuid.UUID) (*Tenant, error)
	GetTenantBySlug(ctx context.Context, slug string) (*Tenant, error)
	UpdateTenant(ctx context.Context, tenant *Tenant) error
	ListTenants(ctx context.Context) ([]Tenant, error)
	CountDevicesByTenant(ctx context.Context, tenantID uuid.UUID) (int, error)

	// Users (isolados por tenant e super-admins globais)
	CreateUser(ctx context.Context, user *User) error
	GetUserByEmail(ctx context.Context, tenantID uuid.UUID, email string) (*User, error)
	GetUserByEmailGlobal(ctx context.Context, email string) (*User, error)
	GetUserByID(ctx context.Context, tenantID, userID uuid.UUID) (*User, error)
	GetUserByIDGlobal(ctx context.Context, userID uuid.UUID) (*User, error)
	ListUsers(ctx context.Context, tenantID uuid.UUID) ([]User, error)
	ListAllUsers(ctx context.Context) ([]User, error)
	CountUsers(ctx context.Context) (int, error)

	// Device Groups & Tags
	CreateDeviceGroup(ctx context.Context, group *DeviceGroup) error
	ListDeviceGroups(ctx context.Context, tenantID uuid.UUID) ([]DeviceGroup, error)
	CreateTag(ctx context.Context, tag *Tag) error
	ListTags(ctx context.Context, tenantID uuid.UUID) ([]Tag, error)

	// Devices
	UpsertDevice(ctx context.Context, device *Device) error
	GetDeviceByAgentID(ctx context.Context, tenantID uuid.UUID, agentID string) (*Device, error)
	ListDevices(ctx context.Context, tenantID uuid.UUID) ([]Device, error)
	AssignDeviceTag(ctx context.Context, tenantID, deviceID, tagID uuid.UUID) error

	// Tickets & Chat Helpdesk
	CreateTicket(ctx context.Context, ticket *Ticket) error
	GetTicketByID(ctx context.Context, tenantID, ticketID uuid.UUID) (*Ticket, error)
	UpdateTicketStatus(ctx context.Context, tenantID, ticketID uuid.UUID, status string) error
	ListTickets(ctx context.Context, tenantID uuid.UUID) ([]Ticket, error)
	AddTicketMessage(ctx context.Context, msg *TicketMessage) error
	ListTicketMessages(ctx context.Context, tenantID, ticketID uuid.UUID) ([]TicketMessage, error)

	// Sessions & File Transfers
	CreateSession(ctx context.Context, session *SessionLog) error
	CloseSession(ctx context.Context, tenantID uuid.UUID, sessionID string, status string, durationSeconds int) error
	ListSessions(ctx context.Context, tenantID uuid.UUID) ([]SessionLog, error)
	CreateFileTransfer(ctx context.Context, ft *FileTransfer) error
	ListFileTransfers(ctx context.Context, tenantID uuid.UUID, sessionID string) ([]FileTransfer, error)

	// Audit Trail Tamper-Evident
	AppendAuditEvent(ctx context.Context, event *AuditEvent) error
	ListAuditEvents(ctx context.Context, tenantID uuid.UUID) ([]AuditEvent, error)
	GetLastAuditEvent(ctx context.Context, tenantID uuid.UUID) (*AuditEvent, error)
}
