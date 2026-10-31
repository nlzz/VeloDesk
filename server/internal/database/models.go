package database

import (
	"time"

	"github.com/google/uuid"
)

// Role constants for RBAC
const (
	RoleSuperAdmin = "SUPERADMIN"
	RoleAdmin      = "ADMIN"
	RoleTechnician = "TECHNICIAN"

	// Legacy aliases
	RoleLegacySuperAdmin     = "SUPER_ADMIN"
	RoleTechUnattended       = "TECH_UNATTENDED"
	RoleTechAttended         = "TECH_ATTENDED"
	RoleAuditor              = "AUDITOR"
	RoleLegacyTechUnattended = "TECH_UNATTENDED"
	RoleLegacyTechAttended   = "TECH_ATTENDED"
	RoleLegacyAuditor        = "AUDITOR"
)

// Tenant and User status constants
const (
	TenantStatusActive  = "ACTIVE"
	TenantStatusBlocked = "BLOCKED"

	UserStatusActive  = "ACTIVE"
	UserStatusBlocked = "BLOCKED"
)

// Ticket status constants
const (
	TicketPending    = "PENDING"
	TicketInProgress = "IN_PROGRESS"
	TicketResolved   = "RESOLVED"
)

// File transfer direction constants
const (
	TransferAgentToViewer = "AGENT_TO_VIEWER"
	TransferViewerToAgent = "VIEWER_TO_AGENT"
)

// Tenant representa a entidade isolada do cliente SaaS.
type Tenant struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Slug         string    `json:"slug"`
	LogoURL      string    `json:"logo_url"`
	PrimaryColor string    `json:"primary_color"`
	MaxDevices   int       `json:"max_devices"`
	Status       string    `json:"status"` // ACTIVE, BLOCKED
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	DeviceCount  int       `json:"device_count,omitempty"`
}

// User representa um operador, técnico ou administrador vinculado a um Tenant.
type User struct {
	ID           uuid.UUID `json:"id"`
	TenantID     uuid.UUID `json:"tenant_id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	Status       string    `json:"status,omitempty"` // ACTIVE, BLOCKED
	MFASecret    string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// DeviceGroup organiza hierarquicamente as máquinas.
type DeviceGroup struct {
	ID        uuid.UUID  `json:"id"`
	TenantID  uuid.UUID  `json:"tenant_id"`
	Name      string     `json:"name"`
	ParentID  *uuid.UUID `json:"parent_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// Tag permite etiquetar dispositivos com código de cor hexadecimal (#EF4444, #10B981).
type Tag struct {
	ID        uuid.UUID `json:"id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	Name      string    `json:"name"`
	ColorHex  string    `json:"color_hex"`
	CreatedAt time.Time `json:"created_at"`
}

// Device representa uma máquina remota registrada no Tenant.
type Device struct {
	ID        uuid.UUID  `json:"id"`
	TenantID  uuid.UUID  `json:"tenant_id"`
	GroupID   *uuid.UUID `json:"group_id,omitempty"`
	AgentID   string     `json:"agent_id"`
	Hostname  string     `json:"hostname"`
	OSInfo    string     `json:"os_info"`
	Status    string     `json:"status"` // ONLINE, OFFLINE, BUSY
	LastSeen  time.Time  `json:"last_seen"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	Tags      []Tag      `json:"tags,omitempty"`
}

// Ticket representa um chamado de suporte aberto pelo cliente na ponta.
type Ticket struct {
	ID             uuid.UUID  `json:"id"`
	TenantID       uuid.UUID  `json:"tenant_id"`
	DeviceID       *uuid.UUID `json:"device_id,omitempty"`
	AgentID        string     `json:"agent_id,omitempty"`
	RequesterName  string     `json:"requester_name"`
	Subject        string     `json:"subject"`
	Status         string     `json:"status"` // PENDING, IN_PROGRESS, RESOLVED
	ScreenshotData string     `json:"screenshot_data,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// TicketMessage é uma mensagem trocada no chat do chamado.
type TicketMessage struct {
	ID         uuid.UUID `json:"id"`
	TenantID   uuid.UUID `json:"tenant_id"`
	TicketID   uuid.UUID `json:"ticket_id"`
	SenderType string    `json:"sender_type"` // USER, TECH
	SenderName string    `json:"sender_name"`
	Message    string    `json:"message"`
	CreatedAt  time.Time `json:"created_at"`
}

// SessionLog registra auditoria forense de sessões de acesso remoto.
type SessionLog struct {
	ID              uuid.UUID  `json:"id"`
	TenantID        uuid.UUID  `json:"tenant_id"`
	SessionID       string     `json:"session_id"`
	AgentID         string     `json:"agent_id"`
	TechUserID      *uuid.UUID `json:"tech_user_id,omitempty"`
	TechName        string     `json:"tech_name,omitempty"`
	Status          string     `json:"status"` // ACTIVE, CLOSED, TERMINATED_BY_USER
	StartedAt       time.Time  `json:"started_at"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	DurationSeconds int        `json:"duration_seconds"`
}

// FileTransfer registra transferências de arquivos com hash forense.
type FileTransfer struct {
	ID         uuid.UUID `json:"id"`
	TenantID   uuid.UUID `json:"tenant_id"`
	SessionID  string    `json:"session_id"`
	Filename   string    `json:"filename"`
	FileSize   int64     `json:"file_size"`
	SHA256Hash string    `json:"sha256_hash"`
	Direction  string    `json:"direction"` // AGENT_TO_VIEWER, VIEWER_TO_AGENT
	Status     string    `json:"status"`    // PENDING, QUARANTINED, COMPLETED, BLOCKED_AMSI
	CreatedAt  time.Time `json:"created_at"`
}

// AuditEvent compõe a cadeia criptográfica Tamper-Evident.
type AuditEvent struct {
	ID                uuid.UUID              `json:"id"`
	TenantID          uuid.UUID              `json:"tenant_id"`
	SequenceNumber    int64                  `json:"sequence_number"`
	PreviousEventHash string                 `json:"previous_event_hash"`
	PayloadHash       string                 `json:"payload_hash"`
	HMACSHA256        string                 `json:"hmac_sha256"`
	EventType         string                 `json:"event_type"`
	Details           map[string]interface{} `json:"details"`
	CreatedAt         time.Time              `json:"created_at"`
}
