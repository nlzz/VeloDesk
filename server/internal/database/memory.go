package database

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// MemoryStore implementa Store com isolamento RLS em memória para testes e dev.
type MemoryStore struct {
	mu             sync.RWMutex
	tenants        map[uuid.UUID]Tenant
	users          map[uuid.UUID]User
	deviceGroups   map[uuid.UUID]DeviceGroup
	tags           map[uuid.UUID]Tag
	devices        map[uuid.UUID]Device
	deviceTags     map[uuid.UUID]map[uuid.UUID]bool // deviceID -> tagID -> bool
	tickets        map[uuid.UUID]Ticket
	ticketMessages map[uuid.UUID][]TicketMessage
	sessions       map[string]SessionLog
	fileTransfers  map[uuid.UUID]FileTransfer
	auditEvents    map[uuid.UUID][]AuditEvent
}

// NewMemoryStore inicializa a store em memória.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		tenants:        make(map[uuid.UUID]Tenant),
		users:          make(map[uuid.UUID]User),
		deviceGroups:   make(map[uuid.UUID]DeviceGroup),
		tags:           make(map[uuid.UUID]Tag),
		devices:        make(map[uuid.UUID]Device),
		deviceTags:     make(map[uuid.UUID]map[uuid.UUID]bool),
		tickets:        make(map[uuid.UUID]Ticket),
		ticketMessages: make(map[uuid.UUID][]TicketMessage),
		sessions:       make(map[string]SessionLog),
		fileTransfers:  make(map[uuid.UUID]FileTransfer),
		auditEvents:    make(map[uuid.UUID][]AuditEvent),
	}
}

// Tenants
func (s *MemoryStore) CreateTenant(ctx context.Context, tenant *Tenant) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, t := range s.tenants {
		if t.Slug == tenant.Slug {
			return ErrAlreadyExists
		}
	}

	if tenant.ID == uuid.Nil {
		tenant.ID = uuid.New()
	}
	if tenant.Status == "" {
		tenant.Status = TenantStatusActive
	}
	now := time.Now().UTC()
	tenant.CreatedAt = now
	tenant.UpdatedAt = now
	s.tenants[tenant.ID] = *tenant
	return nil
}

func (s *MemoryStore) GetTenantByID(ctx context.Context, id uuid.UUID) (*Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tenant, ok := s.tenants[id]
	if !ok {
		return nil, ErrNotFound
	}
	res := tenant
	return &res, nil
}

func (s *MemoryStore) GetTenantBySlug(ctx context.Context, slug string) (*Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, t := range s.tenants {
		if t.Slug == slug {
			res := t
			return &res, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) UpdateTenant(ctx context.Context, tenant *Tenant) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing, ok := s.tenants[tenant.ID]
	if !ok {
		return ErrNotFound
	}

	if tenant.Name != "" {
		existing.Name = tenant.Name
	}
	if tenant.Slug != "" {
		existing.Slug = tenant.Slug
	}
	if tenant.PrimaryColor != "" {
		existing.PrimaryColor = tenant.PrimaryColor
	}
	if tenant.LogoURL != "" {
		existing.LogoURL = tenant.LogoURL
	}
	if tenant.MaxDevices > 0 {
		existing.MaxDevices = tenant.MaxDevices
	}
	if tenant.Status != "" {
		existing.Status = tenant.Status
	}
	existing.UpdatedAt = time.Now().UTC()
	s.tenants[tenant.ID] = existing
	*tenant = existing
	return nil
}

func (s *MemoryStore) ListTenants(ctx context.Context) ([]Tenant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make([]Tenant, 0, len(s.tenants))
	for _, t := range s.tenants {
		res = append(res, t)
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

func (s *MemoryStore) CountDevicesByTenant(ctx context.Context, tenantID uuid.UUID) (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	count := 0
	for _, d := range s.devices {
		if d.TenantID == tenantID {
			count++
		}
	}
	return count, nil
}

// Users
func (s *MemoryStore) CreateUser(ctx context.Context, user *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, u := range s.users {
		if (u.TenantID == user.TenantID || u.TenantID == uuid.Nil || user.TenantID == uuid.Nil) && u.Email == user.Email {
			return ErrAlreadyExists
		}
	}

	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}
	if user.Status == "" {
		user.Status = UserStatusActive
	}
	now := time.Now().UTC()
	user.CreatedAt = now
	user.UpdatedAt = now
	s.users[user.ID] = *user
	return nil
}

func (s *MemoryStore) GetUserByEmail(ctx context.Context, tenantID uuid.UUID, email string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, u := range s.users {
		if u.TenantID == tenantID && u.Email == email {
			res := u
			return &res, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) GetUserByEmailGlobal(ctx context.Context, email string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, u := range s.users {
		if u.Email == email {
			res := u
			return &res, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) GetUserByID(ctx context.Context, tenantID, userID uuid.UUID) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	u, ok := s.users[userID]
	if !ok || (tenantID != uuid.Nil && u.TenantID != tenantID) {
		return nil, ErrNotFound
	}
	res := u
	return &res, nil
}

func (s *MemoryStore) GetUserByIDGlobal(ctx context.Context, userID uuid.UUID) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	u, ok := s.users[userID]
	if !ok {
		return nil, ErrNotFound
	}
	res := u
	return &res, nil
}

func (s *MemoryStore) ListUsers(ctx context.Context, tenantID uuid.UUID) ([]User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []User
	for _, u := range s.users {
		if u.TenantID == tenantID {
			res = append(res, u)
		}
	}
	return res, nil
}

func (s *MemoryStore) ListAllUsers(ctx context.Context) ([]User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make([]User, 0, len(s.users))
	for _, u := range s.users {
		res = append(res, u)
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

func (s *MemoryStore) CountUsers(ctx context.Context) (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return len(s.users), nil
}

// Device Groups & Tags
func (s *MemoryStore) CreateDeviceGroup(ctx context.Context, group *DeviceGroup) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if group.ID == uuid.Nil {
		group.ID = uuid.New()
	}
	group.CreatedAt = time.Now().UTC()
	s.deviceGroups[group.ID] = *group
	return nil
}

func (s *MemoryStore) ListDeviceGroups(ctx context.Context, tenantID uuid.UUID) ([]DeviceGroup, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []DeviceGroup
	for _, g := range s.deviceGroups {
		if g.TenantID == tenantID {
			res = append(res, g)
		}
	}
	return res, nil
}

func (s *MemoryStore) CreateTag(ctx context.Context, tag *Tag) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, t := range s.tags {
		if t.TenantID == tag.TenantID && t.Name == tag.Name {
			return ErrAlreadyExists
		}
	}

	if tag.ID == uuid.Nil {
		tag.ID = uuid.New()
	}
	tag.CreatedAt = time.Now().UTC()
	s.tags[tag.ID] = *tag
	return nil
}

func (s *MemoryStore) ListTags(ctx context.Context, tenantID uuid.UUID) ([]Tag, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []Tag
	for _, t := range s.tags {
		if t.TenantID == tenantID {
			res = append(res, t)
		}
	}
	return res, nil
}

// Devices
func (s *MemoryStore) UpsertDevice(ctx context.Context, device *Device) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	var foundID uuid.UUID
	for id, d := range s.devices {
		if d.AgentID == device.AgentID {
			foundID = id
			break
		}
	}

	if foundID != uuid.Nil {
		existing := s.devices[foundID]
		if existing.TenantID != device.TenantID {
			return ErrTenantMismatch
		}
		existing.Hostname = device.Hostname
		existing.OSInfo = device.OSInfo
		existing.Status = device.Status
		existing.LastSeen = now
		existing.UpdatedAt = now
		if device.GroupID != nil {
			existing.GroupID = device.GroupID
		}
		s.devices[foundID] = existing
		device.ID = foundID
		return nil
	}

	if device.ID == uuid.Nil {
		device.ID = uuid.New()
	}
	device.CreatedAt = now
	device.UpdatedAt = now
	device.LastSeen = now
	s.devices[device.ID] = *device
	return nil
}

func (s *MemoryStore) GetDeviceByAgentID(ctx context.Context, tenantID uuid.UUID, agentID string) (*Device, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, d := range s.devices {
		if d.TenantID == tenantID && d.AgentID == agentID {
			res := d
			res.Tags = s.getDeviceTagsLocked(d.ID)
			return &res, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) ListDevices(ctx context.Context, tenantID uuid.UUID) ([]Device, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []Device
	for _, d := range s.devices {
		if d.TenantID == tenantID {
			dev := d
			dev.Tags = s.getDeviceTagsLocked(d.ID)
			res = append(res, dev)
		}
	}
	return res, nil
}

func (s *MemoryStore) AssignDeviceTag(ctx context.Context, tenantID, deviceID, tagID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dev, ok := s.devices[deviceID]
	if !ok || dev.TenantID != tenantID {
		return ErrNotFound
	}
	tag, ok := s.tags[tagID]
	if !ok || tag.TenantID != tenantID {
		return ErrNotFound
	}

	if s.deviceTags[deviceID] == nil {
		s.deviceTags[deviceID] = make(map[uuid.UUID]bool)
	}
	s.deviceTags[deviceID][tagID] = true
	return nil
}

func (s *MemoryStore) getDeviceTagsLocked(deviceID uuid.UUID) []Tag {
	tagMap := s.deviceTags[deviceID]
	var res []Tag
	for tagID := range tagMap {
		if t, ok := s.tags[tagID]; ok {
			res = append(res, t)
		}
	}
	return res
}

// Tickets & Helpdesk Chat
func (s *MemoryStore) CreateTicket(ctx context.Context, ticket *Ticket) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if ticket.ID == uuid.Nil {
		ticket.ID = uuid.New()
	}
	now := time.Now().UTC()
	ticket.CreatedAt = now
	ticket.UpdatedAt = now
	if ticket.Status == "" {
		ticket.Status = TicketPending
	}
	s.tickets[ticket.ID] = *ticket
	return nil
}

func (s *MemoryStore) GetTicketByID(ctx context.Context, tenantID, ticketID uuid.UUID) (*Ticket, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	t, ok := s.tickets[ticketID]
	if !ok || t.TenantID != tenantID {
		return nil, ErrNotFound
	}
	res := t
	return &res, nil
}

func (s *MemoryStore) UpdateTicketStatus(ctx context.Context, tenantID, ticketID uuid.UUID, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	t, ok := s.tickets[ticketID]
	if !ok || t.TenantID != tenantID {
		return ErrNotFound
	}
	t.Status = status
	t.UpdatedAt = time.Now().UTC()
	s.tickets[ticketID] = t
	return nil
}

func (s *MemoryStore) ListTickets(ctx context.Context, tenantID uuid.UUID) ([]Ticket, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []Ticket
	for _, t := range s.tickets {
		if t.TenantID == tenantID {
			res = append(res, t)
		}
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

func (s *MemoryStore) AddTicketMessage(ctx context.Context, msg *TicketMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	t, ok := s.tickets[msg.TicketID]
	if !ok || t.TenantID != msg.TenantID {
		return ErrNotFound
	}

	if msg.ID == uuid.Nil {
		msg.ID = uuid.New()
	}
	msg.CreatedAt = time.Now().UTC()
	s.ticketMessages[msg.TicketID] = append(s.ticketMessages[msg.TicketID], *msg)
	return nil
}

func (s *MemoryStore) ListTicketMessages(ctx context.Context, tenantID, ticketID uuid.UUID) ([]TicketMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	t, ok := s.tickets[ticketID]
	if !ok || t.TenantID != tenantID {
		return nil, ErrNotFound
	}

	msgs := s.ticketMessages[ticketID]
	res := make([]TicketMessage, len(msgs))
	copy(res, msgs)
	return res, nil
}

// Sessions & File Transfers
func (s *MemoryStore) CreateSession(ctx context.Context, session *SessionLog) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if session.ID == uuid.Nil {
		session.ID = uuid.New()
	}
	if session.StartedAt.IsZero() {
		session.StartedAt = time.Now().UTC()
	}
	s.sessions[session.SessionID] = *session
	return nil
}

func (s *MemoryStore) CloseSession(ctx context.Context, tenantID uuid.UUID, sessionID string, status string, durationSeconds int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sess, ok := s.sessions[sessionID]
	if !ok || sess.TenantID != tenantID {
		return ErrNotFound
	}

	now := time.Now().UTC()
	sess.EndedAt = &now
	sess.Status = status
	sess.DurationSeconds = durationSeconds
	s.sessions[sessionID] = sess
	return nil
}

func (s *MemoryStore) ListSessions(ctx context.Context, tenantID uuid.UUID) ([]SessionLog, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []SessionLog
	for _, sess := range s.sessions {
		if sess.TenantID == tenantID {
			res = append(res, sess)
		}
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].StartedAt.After(res[j].StartedAt)
	})
	return res, nil
}

func (s *MemoryStore) CreateFileTransfer(ctx context.Context, ft *FileTransfer) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if ft.ID == uuid.Nil {
		ft.ID = uuid.New()
	}
	ft.CreatedAt = time.Now().UTC()
	s.fileTransfers[ft.ID] = *ft
	return nil
}

func (s *MemoryStore) ListFileTransfers(ctx context.Context, tenantID uuid.UUID, sessionID string) ([]FileTransfer, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var res []FileTransfer
	for _, ft := range s.fileTransfers {
		if ft.TenantID == tenantID {
			if sessionID == "" || ft.SessionID == sessionID {
				res = append(res, ft)
			}
		}
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

// Audit Trail Tamper-Evident
func (s *MemoryStore) AppendAuditEvent(ctx context.Context, event *AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	evts := s.auditEvents[event.TenantID]
	for _, e := range evts {
		if e.SequenceNumber == event.SequenceNumber {
			return ErrAlreadyExists
		}
	}

	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	s.auditEvents[event.TenantID] = append(s.auditEvents[event.TenantID], *event)
	return nil
}

func (s *MemoryStore) ListAuditEvents(ctx context.Context, tenantID uuid.UUID) ([]AuditEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	evts := s.auditEvents[tenantID]
	res := make([]AuditEvent, len(evts))
	copy(res, evts)
	sort.Slice(res, func(i, j int) bool {
		return res[i].SequenceNumber < res[j].SequenceNumber
	})
	return res, nil
}

func (s *MemoryStore) GetLastAuditEvent(ctx context.Context, tenantID uuid.UUID) (*AuditEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	evts := s.auditEvents[tenantID]
	if len(evts) == 0 {
		return nil, nil
	}
	last := evts[len(evts)-1]
	res := last
	return &res, nil
}
