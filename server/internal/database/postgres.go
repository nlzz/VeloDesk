package database

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

// PostgresStore gerencia operações no banco PostgreSQL com RLS forçado.
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore conecta ao banco de dados PostgreSQL.
func NewPostgresStore(dsn string) (*PostgresStore, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("falha ao abrir conexão postgres: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("falha ao conectar no postgres: %w", err)
	}

	return &PostgresStore{db: db}, nil
}

// Close fecha o pool de conexões.
func (p *PostgresStore) Close() error {
	return p.db.Close()
}

// Migrate executa a migração do schema inicial e configuração de RLS.
func (p *PostgresStore) Migrate(ctx context.Context, schemaSQL string) error {
	_, err := p.db.ExecContext(ctx, schemaSQL)
	if err != nil {
		return fmt.Errorf("falha ao aplicar migrações: %w", err)
	}
	return nil
}

// WithTenantTx executa uma função atômica com `SET LOCAL app.current_tenant_id = ?`.
func (p *PostgresStore) WithTenantTx(ctx context.Context, tenantID uuid.UUID, fn func(tx *sql.Tx) error) error {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("falha ao iniciar transação: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if tenantID != uuid.Nil {
		_, err = tx.ExecContext(ctx, "SET LOCAL app.current_tenant_id = $1", tenantID.String())
		if err != nil {
			return fmt.Errorf("falha ao injetar tenant_id no RLS: %w", err)
		}
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit()
}

// Tenants
func (p *PostgresStore) CreateTenant(ctx context.Context, tenant *Tenant) error {
	if tenant.ID == uuid.Nil {
		tenant.ID = uuid.New()
	}
	if tenant.Status == "" {
		tenant.Status = TenantStatusActive
	}
	now := time.Now().UTC()
	tenant.CreatedAt = now
	tenant.UpdatedAt = now

	query := `
		INSERT INTO tenants (id, name, slug, logo_url, primary_color, max_devices, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	_, err := p.db.ExecContext(ctx, query,
		tenant.ID, tenant.Name, tenant.Slug, tenant.LogoURL, tenant.PrimaryColor, tenant.MaxDevices, tenant.Status, tenant.CreatedAt, tenant.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("falha ao criar tenant: %w", err)
	}
	return nil
}

func (p *PostgresStore) GetTenantByID(ctx context.Context, id uuid.UUID) (*Tenant, error) {
	query := `SELECT id, name, slug, logo_url, primary_color, max_devices, COALESCE(status, 'ACTIVE'), created_at, updated_at FROM tenants WHERE id = $1`
	var t Tenant
	err := p.db.QueryRowContext(ctx, query, id).Scan(
		&t.ID, &t.Name, &t.Slug, &t.LogoURL, &t.PrimaryColor, &t.MaxDevices, &t.Status, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (p *PostgresStore) GetTenantBySlug(ctx context.Context, slug string) (*Tenant, error) {
	query := `SELECT id, name, slug, logo_url, primary_color, max_devices, COALESCE(status, 'ACTIVE'), created_at, updated_at FROM tenants WHERE slug = $1`
	var t Tenant
	err := p.db.QueryRowContext(ctx, query, slug).Scan(
		&t.ID, &t.Name, &t.Slug, &t.LogoURL, &t.PrimaryColor, &t.MaxDevices, &t.Status, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (p *PostgresStore) UpdateTenant(ctx context.Context, tenant *Tenant) error {
	now := time.Now().UTC()
	tenant.UpdatedAt = now
	query := `
		UPDATE tenants
		SET name = $2, slug = $3, logo_url = $4, primary_color = $5, max_devices = $6, status = $7, updated_at = $8
		WHERE id = $1
	`
	res, err := p.db.ExecContext(ctx, query,
		tenant.ID, tenant.Name, tenant.Slug, tenant.LogoURL, tenant.PrimaryColor, tenant.MaxDevices, tenant.Status, tenant.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("falha ao atualizar tenant: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil || rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *PostgresStore) ListTenants(ctx context.Context) ([]Tenant, error) {
	query := `SELECT id, name, slug, logo_url, primary_color, max_devices, COALESCE(status, 'ACTIVE'), created_at, updated_at FROM tenants ORDER BY created_at DESC`
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tenants []Tenant
	for rows.Next() {
		var t Tenant
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.LogoURL, &t.PrimaryColor, &t.MaxDevices, &t.Status, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		tenants = append(tenants, t)
	}
	return tenants, rows.Err()
}

func (p *PostgresStore) CountDevicesByTenant(ctx context.Context, tenantID uuid.UUID) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM devices WHERE tenant_id = $1`
	err := p.db.QueryRowContext(ctx, query, tenantID).Scan(&count)
	return count, err
}

// Users
func (p *PostgresStore) CreateUser(ctx context.Context, user *User) error {
	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}
	if user.Status == "" {
		user.Status = UserStatusActive
	}
	now := time.Now().UTC()
	user.CreatedAt = now
	user.UpdatedAt = now

	if user.TenantID == uuid.Nil {
		query := `
			INSERT INTO users (id, tenant_id, name, email, password_hash, role, status, mfa_secret, created_at, updated_at)
			VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
		`
		_, err := p.db.ExecContext(ctx, query,
			user.ID, user.Name, user.Email, user.PasswordHash, user.Role, user.Status, user.MFASecret, user.CreatedAt, user.UpdatedAt,
		)
		return err
	}

	return p.WithTenantTx(ctx, user.TenantID, func(tx *sql.Tx) error {
		query := `
			INSERT INTO users (id, tenant_id, name, email, password_hash, role, status, mfa_secret, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		`
		_, err := tx.ExecContext(ctx, query,
			user.ID, user.TenantID, user.Name, user.Email, user.PasswordHash, user.Role, user.Status, user.MFASecret, user.CreatedAt, user.UpdatedAt,
		)
		return err
	})
}

func (p *PostgresStore) GetUserByEmail(ctx context.Context, tenantID uuid.UUID, email string) (*User, error) {
	var u User
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name, email, password_hash, role, COALESCE(status, 'ACTIVE'), mfa_secret, created_at, updated_at FROM users WHERE email = $1`
		row := tx.QueryRowContext(ctx, query, email)
		return row.Scan(&u.ID, &u.TenantID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.Status, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt)
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (p *PostgresStore) GetUserByEmailGlobal(ctx context.Context, email string) (*User, error) {
	query := `SELECT id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name, email, password_hash, role, COALESCE(status, 'ACTIVE'), mfa_secret, created_at, updated_at FROM users WHERE LOWER(email) = LOWER($1)`
	var u User
	err := p.db.QueryRowContext(ctx, query, email).Scan(
		&u.ID, &u.TenantID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.Status, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (p *PostgresStore) GetUserByID(ctx context.Context, tenantID, userID uuid.UUID) (*User, error) {
	var u User
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name, email, password_hash, role, COALESCE(status, 'ACTIVE'), mfa_secret, created_at, updated_at FROM users WHERE id = $1`
		row := tx.QueryRowContext(ctx, query, userID)
		return row.Scan(&u.ID, &u.TenantID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.Status, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt)
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (p *PostgresStore) GetUserByIDGlobal(ctx context.Context, userID uuid.UUID) (*User, error) {
	query := `SELECT id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name, email, password_hash, role, COALESCE(status, 'ACTIVE'), mfa_secret, created_at, updated_at FROM users WHERE id = $1`
	var u User
	err := p.db.QueryRowContext(ctx, query, userID).Scan(
		&u.ID, &u.TenantID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.Status, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (p *PostgresStore) ListUsers(ctx context.Context, tenantID uuid.UUID) ([]User, error) {
	var users []User
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name, email, password_hash, role, COALESCE(status, 'ACTIVE'), mfa_secret, created_at, updated_at FROM users ORDER BY created_at DESC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var u User
			if err := rows.Scan(&u.ID, &u.TenantID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.Status, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt); err != nil {
				return err
			}
			users = append(users, u)
		}
		return rows.Err()
	})
	return users, err
}

func (p *PostgresStore) ListAllUsers(ctx context.Context) ([]User, error) {
	query := `SELECT id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name, email, password_hash, role, COALESCE(status, 'ACTIVE'), mfa_secret, created_at, updated_at FROM users ORDER BY created_at DESC`
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.TenantID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.Status, &u.MFASecret, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (p *PostgresStore) CountUsers(ctx context.Context) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM users`
	err := p.db.QueryRowContext(ctx, query).Scan(&count)
	return count, err
}

// Groups & Tags
func (p *PostgresStore) CreateDeviceGroup(ctx context.Context, group *DeviceGroup) error {
	if group.ID == uuid.Nil {
		group.ID = uuid.New()
	}
	group.CreatedAt = time.Now().UTC()

	return p.WithTenantTx(ctx, group.TenantID, func(tx *sql.Tx) error {
		query := `INSERT INTO device_groups (id, tenant_id, name, parent_id, created_at) VALUES ($1, $2, $3, $4, $5)`
		_, err := tx.ExecContext(ctx, query, group.ID, group.TenantID, group.Name, group.ParentID, group.CreatedAt)
		return err
	})
}

func (p *PostgresStore) ListDeviceGroups(ctx context.Context, tenantID uuid.UUID) ([]DeviceGroup, error) {
	var groups []DeviceGroup
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, name, parent_id, created_at FROM device_groups ORDER BY name ASC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var g DeviceGroup
			if err := rows.Scan(&g.ID, &g.TenantID, &g.Name, &g.ParentID, &g.CreatedAt); err != nil {
				return err
			}
			groups = append(groups, g)
		}
		return rows.Err()
	})
	return groups, err
}

func (p *PostgresStore) CreateTag(ctx context.Context, tag *Tag) error {
	if tag.ID == uuid.Nil {
		tag.ID = uuid.New()
	}
	tag.CreatedAt = time.Now().UTC()

	return p.WithTenantTx(ctx, tag.TenantID, func(tx *sql.Tx) error {
		query := `INSERT INTO tags (id, tenant_id, name, color_hex, created_at) VALUES ($1, $2, $3, $4, $5)`
		_, err := tx.ExecContext(ctx, query, tag.ID, tag.TenantID, tag.Name, tag.ColorHex, tag.CreatedAt)
		return err
	})
}

func (p *PostgresStore) ListTags(ctx context.Context, tenantID uuid.UUID) ([]Tag, error) {
	var tags []Tag
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, name, color_hex, created_at FROM tags ORDER BY name ASC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var t Tag
			if err := rows.Scan(&t.ID, &t.TenantID, &t.Name, &t.ColorHex, &t.CreatedAt); err != nil {
				return err
			}
			tags = append(tags, t)
		}
		return rows.Err()
	})
	return tags, err
}

// Devices
func (p *PostgresStore) UpsertDevice(ctx context.Context, device *Device) error {
	if device.ID == uuid.Nil {
		device.ID = uuid.New()
	}
	now := time.Now().UTC()
	device.CreatedAt = now
	device.UpdatedAt = now
	device.LastSeen = now

	return p.WithTenantTx(ctx, device.TenantID, func(tx *sql.Tx) error {
		query := `
			INSERT INTO devices (id, tenant_id, group_id, agent_id, hostname, os_info, status, last_seen, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (agent_id) DO UPDATE SET
				hostname = EXCLUDED.hostname,
				os_info = EXCLUDED.os_info,
				status = EXCLUDED.status,
				last_seen = EXCLUDED.last_seen,
				updated_at = EXCLUDED.updated_at
		`
		_, err := tx.ExecContext(ctx, query,
			device.ID, device.TenantID, device.GroupID, device.AgentID, device.Hostname, device.OSInfo, device.Status, device.LastSeen, device.CreatedAt, device.UpdatedAt,
		)
		return err
	})
}

func (p *PostgresStore) GetDeviceByAgentID(ctx context.Context, tenantID uuid.UUID, agentID string) (*Device, error) {
	var d Device
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, group_id, agent_id, hostname, os_info, status, last_seen, created_at, updated_at FROM devices WHERE agent_id = $1`
		row := tx.QueryRowContext(ctx, query, agentID)
		return row.Scan(&d.ID, &d.TenantID, &d.GroupID, &d.AgentID, &d.Hostname, &d.OSInfo, &d.Status, &d.LastSeen, &d.CreatedAt, &d.UpdatedAt)
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &d, nil
}

func (p *PostgresStore) ListDevices(ctx context.Context, tenantID uuid.UUID) ([]Device, error) {
	var devices []Device
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, group_id, agent_id, hostname, os_info, status, last_seen, created_at, updated_at FROM devices ORDER BY last_seen DESC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var d Device
			if err := rows.Scan(&d.ID, &d.TenantID, &d.GroupID, &d.AgentID, &d.Hostname, &d.OSInfo, &d.Status, &d.LastSeen, &d.CreatedAt, &d.UpdatedAt); err != nil {
				return err
			}
			devices = append(devices, d)
		}
		return rows.Err()
	})
	return devices, err
}

func (p *PostgresStore) AssignDeviceTag(ctx context.Context, tenantID, deviceID, tagID uuid.UUID) error {
	return p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `INSERT INTO device_tags (device_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
		_, err := tx.ExecContext(ctx, query, deviceID, tagID)
		return err
	})
}

// Tickets & Helpdesk Chat
func (p *PostgresStore) CreateTicket(ctx context.Context, ticket *Ticket) error {
	if ticket.ID == uuid.Nil {
		ticket.ID = uuid.New()
	}
	now := time.Now().UTC()
	ticket.CreatedAt = now
	ticket.UpdatedAt = now

	return p.WithTenantTx(ctx, ticket.TenantID, func(tx *sql.Tx) error {
		query := `
			INSERT INTO tickets (id, tenant_id, device_id, requester_name, subject, status, screenshot_data, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`
		_, err := tx.ExecContext(ctx, query,
			ticket.ID, ticket.TenantID, ticket.DeviceID, ticket.RequesterName, ticket.Subject, ticket.Status, ticket.ScreenshotData, ticket.CreatedAt, ticket.UpdatedAt,
		)
		return err
	})
}

func (p *PostgresStore) GetTicketByID(ctx context.Context, tenantID, ticketID uuid.UUID) (*Ticket, error) {
	var t Ticket
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, device_id, requester_name, subject, status, screenshot_data, created_at, updated_at FROM tickets WHERE id = $1`
		row := tx.QueryRowContext(ctx, query, ticketID)
		return row.Scan(&t.ID, &t.TenantID, &t.DeviceID, &t.RequesterName, &t.Subject, &t.Status, &t.ScreenshotData, &t.CreatedAt, &t.UpdatedAt)
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (p *PostgresStore) UpdateTicketStatus(ctx context.Context, tenantID, ticketID uuid.UUID, status string) error {
	return p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `UPDATE tickets SET status = $1, updated_at = NOW() WHERE id = $2`
		res, err := tx.ExecContext(ctx, query, status, ticketID)
		if err != nil {
			return err
		}
		rows, _ := res.RowsAffected()
		if rows == 0 {
			return ErrNotFound
		}
		return nil
	})
}

func (p *PostgresStore) ListTickets(ctx context.Context, tenantID uuid.UUID) ([]Ticket, error) {
	var tickets []Ticket
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, device_id, requester_name, subject, status, screenshot_data, created_at, updated_at FROM tickets ORDER BY created_at DESC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var t Ticket
			if err := rows.Scan(&t.ID, &t.TenantID, &t.DeviceID, &t.RequesterName, &t.Subject, &t.Status, &t.ScreenshotData, &t.CreatedAt, &t.UpdatedAt); err != nil {
				return err
			}
			tickets = append(tickets, t)
		}
		return rows.Err()
	})
	return tickets, err
}

func (p *PostgresStore) AddTicketMessage(ctx context.Context, msg *TicketMessage) error {
	if msg.ID == uuid.Nil {
		msg.ID = uuid.New()
	}
	msg.CreatedAt = time.Now().UTC()

	return p.WithTenantTx(ctx, msg.TenantID, func(tx *sql.Tx) error {
		query := `INSERT INTO ticket_messages (id, tenant_id, ticket_id, sender_type, sender_name, message, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`
		_, err := tx.ExecContext(ctx, query, msg.ID, msg.TenantID, msg.TicketID, msg.SenderType, msg.SenderName, msg.Message, msg.CreatedAt)
		return err
	})
}

func (p *PostgresStore) ListTicketMessages(ctx context.Context, tenantID, ticketID uuid.UUID) ([]TicketMessage, error) {
	var msgs []TicketMessage
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, ticket_id, sender_type, sender_name, message, created_at FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`
		rows, err := tx.QueryContext(ctx, query, ticketID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var m TicketMessage
			if err := rows.Scan(&m.ID, &m.TenantID, &m.TicketID, &m.SenderType, &m.SenderName, &m.Message, &m.CreatedAt); err != nil {
				return err
			}
			msgs = append(msgs, m)
		}
		return rows.Err()
	})
	return msgs, err
}

// Sessions & File Transfers
func (p *PostgresStore) CreateSession(ctx context.Context, session *SessionLog) error {
	if session.ID == uuid.Nil {
		session.ID = uuid.New()
	}
	if session.StartedAt.IsZero() {
		session.StartedAt = time.Now().UTC()
	}

	return p.WithTenantTx(ctx, session.TenantID, func(tx *sql.Tx) error {
		query := `INSERT INTO sessions (id, tenant_id, session_id, agent_id, tech_user_id, status, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`
		_, err := tx.ExecContext(ctx, query, session.ID, session.TenantID, session.SessionID, session.AgentID, session.TechUserID, session.Status, session.StartedAt)
		return err
	})
}

func (p *PostgresStore) CloseSession(ctx context.Context, tenantID uuid.UUID, sessionID string, status string, durationSeconds int) error {
	return p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `UPDATE sessions SET status = $1, ended_at = NOW(), duration_seconds = $2 WHERE session_id = $3`
		res, err := tx.ExecContext(ctx, query, status, durationSeconds, sessionID)
		if err != nil {
			return err
		}
		rows, _ := res.RowsAffected()
		if rows == 0 {
			return ErrNotFound
		}
		return nil
	})
}

func (p *PostgresStore) ListSessions(ctx context.Context, tenantID uuid.UUID) ([]SessionLog, error) {
	var sessions []SessionLog
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, session_id, agent_id, tech_user_id, status, started_at, ended_at, duration_seconds FROM sessions ORDER BY started_at DESC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var s SessionLog
			if err := rows.Scan(&s.ID, &s.TenantID, &s.SessionID, &s.AgentID, &s.TechUserID, &s.Status, &s.StartedAt, &s.EndedAt, &s.DurationSeconds); err != nil {
				return err
			}
			sessions = append(sessions, s)
		}
		return rows.Err()
	})
	return sessions, err
}

func (p *PostgresStore) CreateFileTransfer(ctx context.Context, ft *FileTransfer) error {
	if ft.ID == uuid.Nil {
		ft.ID = uuid.New()
	}
	ft.CreatedAt = time.Now().UTC()

	return p.WithTenantTx(ctx, ft.TenantID, func(tx *sql.Tx) error {
		query := `INSERT INTO file_transfers (id, tenant_id, session_id, filename, file_size, sha256_hash, direction, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
		_, err := tx.ExecContext(ctx, query, ft.ID, ft.TenantID, ft.SessionID, ft.Filename, ft.FileSize, ft.SHA256Hash, ft.Direction, ft.Status, ft.CreatedAt)
		return err
	})
}

func (p *PostgresStore) ListFileTransfers(ctx context.Context, tenantID uuid.UUID, sessionID string) ([]FileTransfer, error) {
	var transfers []FileTransfer
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		var rows *sql.Rows
		var err error
		if sessionID != "" {
			query := `SELECT id, tenant_id, session_id, filename, file_size, sha256_hash, direction, status, created_at FROM file_transfers WHERE session_id = $1 ORDER BY created_at DESC`
			rows, err = tx.QueryContext(ctx, query, sessionID)
		} else {
			query := `SELECT id, tenant_id, session_id, filename, file_size, sha256_hash, direction, status, created_at FROM file_transfers ORDER BY created_at DESC`
			rows, err = tx.QueryContext(ctx, query)
		}
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var ft FileTransfer
			if err := rows.Scan(&ft.ID, &ft.TenantID, &ft.SessionID, &ft.Filename, &ft.FileSize, &ft.SHA256Hash, &ft.Direction, &ft.Status, &ft.CreatedAt); err != nil {
				return err
			}
			transfers = append(transfers, ft)
		}
		return rows.Err()
	})
	return transfers, err
}

// Audit Trail Tamper-Evident
func (p *PostgresStore) AppendAuditEvent(ctx context.Context, event *AuditEvent) error {
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	detailsJSON, err := json.Marshal(event.Details)
	if err != nil {
		return fmt.Errorf("falha ao serializar detalhes do evento: %w", err)
	}

	return p.WithTenantTx(ctx, event.TenantID, func(tx *sql.Tx) error {
		query := `
			INSERT INTO audit_events (id, tenant_id, sequence_number, previous_event_hash, payload_hash, hmac_sha256, event_type, details, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`
		_, err := tx.ExecContext(ctx, query,
			event.ID, event.TenantID, event.SequenceNumber, event.PreviousEventHash, event.PayloadHash, event.HMACSHA256, event.EventType, detailsJSON, event.CreatedAt,
		)
		return err
	})
}

func (p *PostgresStore) ListAuditEvents(ctx context.Context, tenantID uuid.UUID) ([]AuditEvent, error) {
	var events []AuditEvent
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, sequence_number, previous_event_hash, payload_hash, hmac_sha256, event_type, details, created_at FROM audit_events ORDER BY sequence_number ASC`
		rows, err := tx.QueryContext(ctx, query)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var e AuditEvent
			var detailsJSON []byte
			if err := rows.Scan(&e.ID, &e.TenantID, &e.SequenceNumber, &e.PreviousEventHash, &e.PayloadHash, &e.HMACSHA256, &e.EventType, &detailsJSON, &e.CreatedAt); err != nil {
				return err
			}
			if len(detailsJSON) > 0 {
				_ = json.Unmarshal(detailsJSON, &e.Details)
			}
			events = append(events, e)
		}
		return rows.Err()
	})
	return events, err
}

func (p *PostgresStore) GetLastAuditEvent(ctx context.Context, tenantID uuid.UUID) (*AuditEvent, error) {
	var e AuditEvent
	var detailsJSON []byte
	err := p.WithTenantTx(ctx, tenantID, func(tx *sql.Tx) error {
		query := `SELECT id, tenant_id, sequence_number, previous_event_hash, payload_hash, hmac_sha256, event_type, details, created_at FROM audit_events ORDER BY sequence_number DESC LIMIT 1`
		row := tx.QueryRowContext(ctx, query)
		return row.Scan(&e.ID, &e.TenantID, &e.SequenceNumber, &e.PreviousEventHash, &e.PayloadHash, &e.HMACSHA256, &e.EventType, &detailsJSON, &e.CreatedAt)
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if len(detailsJSON) > 0 {
		_ = json.Unmarshal(detailsJSON, &e.Details)
	}
	return &e, nil
}
