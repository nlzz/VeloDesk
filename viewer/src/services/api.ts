// API Client para o VeloDesk Enterprise Hub

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
  primary_color: string;
  max_devices: number;
}

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface DeviceTag {
  id: string;
  tenant_id: string;
  name: string;
  color_hex: string;
}

export interface DeviceGroup {
  id: string;
  tenant_id: string;
  name: string;
  parent_id?: string;
}

export interface RemoteDevice {
  id: string;
  tenant_id: string;
  group_id?: string;
  agent_id: string;
  hostname: string;
  os_info: string;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
  last_seen: string;
  tags?: DeviceTag[];
}

export interface HelpdeskTicket {
  id: string;
  tenant_id: string;
  device_id?: string;
  agent_id?: string;
  requester_name: string;
  subject: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';
  screenshot_data?: string;
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  id: string;
  tenant_id: string;
  ticket_id: string;
  sender_type: 'USER' | 'TECH';
  sender_name: string;
  message: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  tenant_id: string;
  sequence_number: number;
  previous_event_hash: string;
  payload_hash: string;
  hmac_sha256: string;
  event_type: string;
  details: Record<string, any>;
  created_at: string;
}

export interface AuditVerificationResult {
  verified: boolean;
  total_events: number;
  message: string;
  error?: string;
}

export interface SessionRecord {
  id: string;
  tenant_id: string;
  session_id: string;
  agent_id: string;
  tech_user_id?: string;
  tech_name?: string;
  status: string;
  started_at: string;
  ended_at?: string;
  duration_seconds: number;
}

export interface FileTransferRecord {
  id: string;
  tenant_id: string;
  session_id: string;
  filename: string;
  file_size: number;
  sha256_hash: string;
  direction: 'AGENT_TO_VIEWER' | 'VIEWER_TO_AGENT';
  status: string;
  created_at: string;
}

class ApiService {
  private baseUrl: string = '';
  private token: string | null = null;
  private currentTenant: TenantInfo | null = null;

  constructor() {
    this.token = localStorage.getItem('velodesk_token');
    const savedTenant = localStorage.getItem('velodesk_tenant');
    if (savedTenant) {
      try {
        this.currentTenant = JSON.parse(savedTenant);
      } catch {
        // ignore
      }
    }
  }

  public setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('velodesk_token', token);
    } else {
      localStorage.removeItem('velodesk_token');
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public setTenant(tenant: TenantInfo | null) {
    this.currentTenant = tenant;
    if (tenant) {
      localStorage.setItem('velodesk_tenant', JSON.stringify(tenant));
      this.applyTheme(tenant);
    } else {
      localStorage.removeItem('velodesk_tenant');
    }
  }

  public getTenant(): TenantInfo | null {
    return this.currentTenant;
  }

  public applyTheme(tenant: TenantInfo) {
    if (tenant.primary_color) {
      document.documentElement.style.setProperty('--tenant-primary', tenant.primary_color);
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.currentTenant?.slug) {
      headers['X-Tenant-Slug'] = this.currentTenant.slug;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errMsg = `Erro HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data.message) errMsg = data.message;
      } catch {
        // ignore
      }
      throw new Error(errMsg);
    }

    return response.json();
  }

  // Public Branding
  public async getTenantBySlug(slug: string): Promise<TenantInfo> {
    return this.request<TenantInfo>(`/api/v1/tenants/${slug}`);
  }

  // Auth
  public async login(slug: string, email: string, password: string): Promise<{ token: string; user: UserInfo; tenant: TenantInfo }> {
    const res = await this.request<{ token: string; user: UserInfo; tenant: TenantInfo }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ slug, email, password }),
    });
    this.setToken(res.token);
    this.setTenant(res.tenant);
    return res;
  }

  public logout() {
    this.setToken(null);
    this.setTenant(null);
  }

  // Devices & Groups
  public async listDevices(): Promise<RemoteDevice[]> {
    return this.request<RemoteDevice[]>('/api/v1/devices');
  }

  public async listGroups(): Promise<DeviceGroup[]> {
    return this.request<DeviceGroup[]>('/api/v1/groups');
  }

  public async listTags(): Promise<DeviceTag[]> {
    return this.request<DeviceTag[]>('/api/v1/tags');
  }

  // Helpdesk Tickets
  public async listTickets(): Promise<HelpdeskTicket[]> {
    return this.request<HelpdeskTicket[]>('/api/v1/tickets');
  }

  public async updateTicketStatus(ticketId: string, status: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/v1/tickets/${ticketId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  public async listTicketMessages(ticketId: string): Promise<TicketMessage[]> {
    return this.request<TicketMessage[]>(`/api/v1/tickets/${ticketId}/messages`);
  }

  public async sendTicketMessage(ticketId: string, message: string, senderName: string, senderType: 'USER' | 'TECH' = 'TECH'): Promise<TicketMessage> {
    return this.request<TicketMessage>(`/api/v1/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        sender_name: senderName,
        sender_type: senderType,
      }),
    });
  }

  // Audit Trail & Forensic Verification
  public async listAuditEvents(): Promise<AuditEvent[]> {
    return this.request<AuditEvent[]>('/api/v1/audit/events');
  }

  public async verifyAuditChain(): Promise<AuditVerificationResult> {
    return this.request<AuditVerificationResult>('/api/v1/audit/verify');
  }

  // Sessions & Transfers
  public async listSessions(): Promise<SessionRecord[]> {
    return this.request<SessionRecord[]>('/api/v1/sessions');
  }

  public async logFileTransfer(sessionId: string, transfer: {
    filename: string;
    file_size: number;
    sha256_hash: string;
    direction: 'AGENT_TO_VIEWER' | 'VIEWER_TO_AGENT';
    status: string;
  }): Promise<FileTransferRecord> {
    return this.request<FileTransferRecord>(`/api/v1/sessions/${sessionId}/transfers`, {
      method: 'POST',
      body: JSON.stringify(transfer),
    });
  }
}

export const api = new ApiService();
