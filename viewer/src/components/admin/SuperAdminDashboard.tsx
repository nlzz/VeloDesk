import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  Plus,
  Search,
  Shield,
  LogOut,
  Edit2,
  CheckCircle2,
  XCircle,
  Monitor,
  Copy,
  Check,
  Palette,
} from 'lucide-react';
import { api, TenantInfo, UserInfo } from '../../services/api';

const PRESET_COLORS = ['#2563EB', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];

export const SuperAdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'tenants' | 'users'>('tenants');

  // Dados
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Modais de Empresa
  const [isNewTenantOpen, setIsNewTenantOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantInfo | null>(null);
  const [tenantForm, setTenantForm] = useState({
    name: '',
    slug: '',
    primary_color: '#2563EB',
    logo_url: '',
    max_devices: 50,
    admin_name: '',
    admin_email: '',
    admin_password: '',
  });

  // Modal de Usuário
  const [isNewUserOpen, setIsNewUserOpen] = useState(false);
  const [userForm, setUserForm] = useState({
    tenant_id: '',
    name: '',
    email: '',
    password: '',
    role: 'TECHNICIAN',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Carrega dados iniciais
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [tList, uList] = await Promise.all([
        api.listAdminTenants(),
        api.listAdminUsers(),
      ]);
      setTenants(tList);
      setUsers(uList);
    } catch (err: any) {
      console.error('[SuperAdmin] Erro ao carregar dados:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLogout = () => {
    api.logout();
    navigate('/login', { replace: true });
  };

  const handleCopySlug = (slug: string) => {
    navigator.clipboard.writeText(slug);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  // Auto-gera slug a partir do nome
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    setTenantForm((prev) => ({ ...prev, name, slug }));
  };

  // Salvar Nova Empresa
  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantForm.name || !tenantForm.slug) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      await api.createAdminTenant(tenantForm);
      setIsNewTenantOpen(false);
      setTenantForm({
        name: '',
        slug: '',
        primary_color: '#2563EB',
        logo_url: '',
        max_devices: 50,
        admin_name: '',
        admin_email: '',
        admin_password: '',
      });
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Falha ao criar empresa.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Salvar Edição da Empresa
  const handleUpdateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      await api.updateAdminTenant(editingTenant.id, editingTenant);
      setEditingTenant(null);
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Falha ao atualizar empresa.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Alternar Status da Empresa (Bloquear / Ativar)
  const handleToggleTenantStatus = async (t: TenantInfo) => {
    const newStatus = t.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    try {
      await api.updateAdminTenant(t.id, { status: newStatus });
      await loadData();
    } catch (err: any) {
      alert(`Falha ao alterar status da empresa: ${err.message}`);
    }
  };

  // Salvar Novo Usuário
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.name || !userForm.email || !userForm.password) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      await api.createAdminUser({
        tenant_id: userForm.tenant_id || undefined,
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        password: userForm.password,
        role: userForm.role,
      });
      setIsNewUserOpen(false);
      setUserForm({
        tenant_id: '',
        name: '',
        email: '',
        password: '',
        role: 'TECHNICIAN',
      });
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Falha ao criar usuário.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mapeamento de nome da empresa por ID
  const tenantMap = useMemo(() => {
    const map = new Map<string, string>();
    tenants.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [tenants]);

  // Filtros
  const filteredTenants = useMemo(() => {
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.slug.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [tenants, searchTerm]);

  const filteredUsers = useMemo(() => {
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.role.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col select-none">
      {/* Top Navbar Super-Admin */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-md shadow-amber-500/20">
              <Shield className="w-5 h-5 fill-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-100 text-base tracking-tight">VeloDesk</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  SUPER-ADMIN MASTER
                </span>
              </div>
              <span className="text-xs text-slate-400">Painel Central de Multi-Tenancy</span>
            </div>
          </div>

          {/* Abas e Ações */}
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setActiveTab('tenants');
                  setSearchTerm('');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'tenants'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Empresas ({tenants.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setActiveTab('users');
                  setSearchTerm('');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === 'users'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Usuários ({users.length})</span>
              </button>
            </nav>

            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition flex items-center gap-1.5 border border-slate-800"
              title="Abrir Dashboard do Escritório"
            >
              <Monitor className="w-3.5 h-3.5 text-blue-400" />
              <span>Dashboard Técnico</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="text-xs text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-500/10 transition flex items-center gap-1.5 border border-rose-500/20"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Barra de Ações: Busca & Botão de Criação */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={activeTab === 'tenants' ? 'Buscar empresa ou slug...' : 'Buscar nome, e-mail ou role...'}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="w-full sm:w-auto flex items-center gap-3">
            {activeTab === 'tenants' ? (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setIsNewTenantOpen(true);
                }}
                className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Nova Empresa</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setIsNewUserOpen(true);
                }}
                className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Novo Usuário</span>
              </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* ABA 1: EMPRESAS (TENANTS) */}
        {/* ========================================================================= */}
        {activeTab === 'tenants' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4">Empresa</th>
                    <th className="px-6 py-4">Slug (Identificador)</th>
                    <th className="px-6 py-4">Cadastro</th>
                    <th className="px-6 py-4">Computadores</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        {isLoading ? 'Carregando empresas...' : 'Nenhuma empresa cadastrada ou encontrada na busca.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map((t) => {
                      const isBlocked = t.status === 'BLOCKED';
                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {t.logo_url ? (
                                <img
                                  src={t.logo_url}
                                  alt={t.name}
                                  className="w-8 h-8 rounded-lg object-contain bg-white/5 border border-slate-700 p-0.5"
                                />
                              ) : (
                                <div
                                  className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-xs shadow-sm"
                                  style={{ backgroundColor: t.primary_color || '#2563EB' }}
                                >
                                  {t.name.substring(0, 2).toUpperCase()}
                                </div>
                              )}
                              <span className="font-semibold text-slate-200 text-sm">{t.name}</span>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                                {t.slug}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopySlug(t.slug)}
                                className="text-slate-500 hover:text-slate-300 transition"
                                title="Copiar Slug"
                              >
                                {copiedSlug === t.slug ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-slate-400">
                            {t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR') : '—'}
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5">
                              <Monitor className="w-3.5 h-3.5 text-slate-500" />
                              <span className="font-mono font-medium text-slate-300">
                                {t.device_count || 0} / {t.max_devices || 50}
                              </span>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            {isBlocked ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/30">
                                <XCircle className="w-3 h-3" />
                                Bloqueado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 className="w-3 h-3" />
                                Ativo
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  api.setTenant(t);
                                  navigate('/dashboard');
                                }}
                                className="px-2.5 py-1 text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition flex items-center gap-1.5 shadow-sm"
                                title={`Acessar Dashboard do Escritório ${t.name}`}
                              >
                                <Monitor className="w-3.5 h-3.5" />
                                <span>Acessar</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setFormError(null);
                                  setEditingTenant({ ...t });
                                }}
                                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition"
                                title="Editar Dados"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleTenantStatus(t)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition border ${
                                  isBlocked
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                                }`}
                              >
                                {isBlocked ? 'Ativar' : 'Bloquear'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ABA 2: USUÁRIOS GLOBAIS */}
        {/* ========================================================================= */}
        {activeTab === 'users' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4">Nome</th>
                    <th className="px-6 py-4">E-mail</th>
                    <th className="px-6 py-4">Papel (Role)</th>
                    <th className="px-6 py-4">Empresa Vinculada</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Cadastrado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        {isLoading ? 'Carregando usuários...' : 'Nenhum usuário cadastrado ou encontrado.'}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const isSuper = u.role === 'SUPERADMIN' || u.role === 'SUPER_ADMIN';
                      const isAdmin = u.role === 'ADMIN';
                      const tenantName = u.tenant_id ? tenantMap.get(u.tenant_id) || 'Escritório' : 'Global / Master';

                      return (
                        <tr key={u.id} className="hover:bg-slate-800/40 transition">
                          <td className="px-6 py-4 font-semibold text-slate-200 text-sm">
                            {u.name}
                          </td>
                          <td className="px-6 py-4 font-mono text-slate-400">
                            {u.email}
                          </td>
                          <td className="px-6 py-4">
                            {isSuper && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                                SUPERADMIN
                              </span>
                            )}
                            {isAdmin && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-300 border border-blue-500/30">
                                ADMIN
                              </span>
                            )}
                            {!isSuper && !isAdmin && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                                TECHNICIAN
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-slate-300 font-medium">
                            {tenantName}
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              Ativo
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-slate-400">
                            {u.created_at || '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: NOVA EMPRESA */}
      {/* ========================================================================= */}
      {isNewTenantOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-500" />
                Cadastrar Nova Empresa (Tenant)
              </h2>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setIsNewTenantOpen(false);
                }}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateTenant} autoComplete="off" className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome da Empresa *</label>
                <input
                  type="text"
                  required
                  id="new-tenant-name"
                  name="velodesk_new_tenant_name"
                  autoComplete="off"
                  value={tenantForm.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="ex: Advocacia Silveira & Associados"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Slug (Identificador URL) *</label>
                <input
                  type="text"
                  required
                  id="new-tenant-slug"
                  name="velodesk_new_tenant_slug"
                  autoComplete="off"
                  value={tenantForm.slug}
                  onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value.toLowerCase() })}
                  placeholder="ex: advocacia-silveira"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">Identificador exclusivo sem espaços nem acentos.</span>
              </div>

              {/* Color Picker HEX */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-blue-400" />
                    Cor Primária (HEX)
                  </span>
                  <span className="font-mono text-slate-400">{tenantForm.primary_color}</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={tenantForm.primary_color}
                    onChange={(e) => setTenantForm({ ...tenantForm, primary_color: e.target.value })}
                    className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-slate-700 p-0.5"
                  />
                  <div className="flex items-center gap-1.5 flex-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setTenantForm({ ...tenantForm, primary_color: c })}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full transition transform hover:scale-110 ${
                          tenantForm.primary_color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">URL do Logo (Opcional)</label>
                <input
                  type="url"
                  id="new-tenant-logo-url"
                  name="velodesk_new_tenant_logo_url"
                  autoComplete="off"
                  value={tenantForm.logo_url}
                  onChange={(e) => setTenantForm({ ...tenantForm, logo_url: e.target.value })}
                  placeholder="https://exemplo.com/logo.png"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Limite Máximo de Computadores</label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  id="new-tenant-max-devices"
                  name="velodesk_new_tenant_max_devices"
                  value={tenantForm.max_devices}
                  onChange={(e) => setTenantForm({ ...tenantForm, max_devices: parseInt(e.target.value) || 50 })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Administrador Inicial Opcional */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <span className="font-semibold text-slate-400 block text-[11px] uppercase tracking-wider">
                  Administrador Inicial do Escritório (Opcional)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-0.5">Nome do Admin</label>
                    <input
                      type="text"
                      id="create-tenant-admin-name"
                      name="velodesk_tenant_admin_name"
                      autoComplete="off"
                      value={tenantForm.admin_name}
                      onChange={(e) => setTenantForm({ ...tenantForm, admin_name: e.target.value })}
                      placeholder="Gestor de TI"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-0.5">E-mail do Admin</label>
                    <input
                      type="email"
                      id="create-tenant-admin-email"
                      name="velodesk_tenant_admin_email"
                      autoComplete="off"
                      data-lpignore="true"
                      value={tenantForm.admin_email}
                      onChange={(e) => setTenantForm({ ...tenantForm, admin_email: e.target.value })}
                      placeholder="admin@empresa.com"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 mb-0.5">Senha Provisória</label>
                  <input
                    type="password"
                    id="create-tenant-admin-password"
                    name="velodesk_tenant_admin_password"
                    autoComplete="new-password"
                    data-lpignore="true"
                    value={tenantForm.admin_password}
                    onChange={(e) => setTenantForm({ ...tenantForm, admin_password: e.target.value })}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setIsNewTenantOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Criar Empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR EMPRESA */}
      {/* ========================================================================= */}
      {editingTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-blue-500" />
                Editar Empresa: {editingTenant.name}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setEditingTenant(null);
                }}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateTenant} autoComplete="off" className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome da Empresa</label>
                <input
                  type="text"
                  required
                  id="edit-tenant-name"
                  name="velodesk_edit_tenant_name"
                  value={editingTenant.name}
                  onChange={(e) => setEditingTenant({ ...editingTenant, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Slug</label>
                <input
                  type="text"
                  required
                  id="edit-tenant-slug"
                  name="velodesk_edit_tenant_slug"
                  value={editingTenant.slug}
                  onChange={(e) => setEditingTenant({ ...editingTenant, slug: e.target.value.toLowerCase() })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                />
              </div>

              {/* Color Picker HEX */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>Cor Primária (HEX)</span>
                  <span className="font-mono text-slate-400">{editingTenant.primary_color}</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={editingTenant.primary_color}
                    onChange={(e) => setEditingTenant({ ...editingTenant, primary_color: e.target.value })}
                    className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-slate-700 p-0.5"
                  />
                  <div className="flex items-center gap-1.5 flex-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditingTenant({ ...editingTenant, primary_color: c })}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full transition transform hover:scale-110 ${
                          editingTenant.primary_color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">URL do Logo</label>
                <input
                  type="url"
                  id="edit-tenant-logo-url"
                  name="velodesk_edit_tenant_logo_url"
                  value={editingTenant.logo_url || ''}
                  onChange={(e) => setEditingTenant({ ...editingTenant, logo_url: e.target.value })}
                  placeholder="https://exemplo.com/logo.png"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Limite de Máquinas</label>
                  <input
                    type="number"
                    min="1"
                    id="edit-tenant-max-devices"
                    name="velodesk_edit_tenant_max_devices"
                    value={editingTenant.max_devices}
                    onChange={(e) =>
                      setEditingTenant({ ...editingTenant, max_devices: parseInt(e.target.value) || 50 })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Status</label>
                  <select
                    id="edit-tenant-status"
                    name="velodesk_edit_tenant_status"
                    value={editingTenant.status || 'ACTIVE'}
                    onChange={(e) => setEditingTenant({ ...editingTenant, status: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="BLOCKED">Bloqueado</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setEditingTenant(null);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: NOVO USUÁRIO */}
      {/* ========================================================================= */}
      {isNewUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                Cadastrar Novo Usuário / Técnico
              </h2>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setIsNewUserOpen(false);
                }}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} autoComplete="off" className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Empresa Vinculada</label>
                <select
                  id="new-user-tenant"
                  name="velodesk_user_tenant"
                  value={userForm.tenant_id}
                  onChange={(e) => setUserForm({ ...userForm, tenant_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                >
                  <option value="">Nenhuma (Super-Admin Global)</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  id="create-user-fullname"
                  name="velodesk_user_fullname"
                  autoComplete="off"
                  value={userForm.name}
                  onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                  placeholder="ex: João Silva"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">E-mail de Acesso *</label>
                <input
                  type="email"
                  required
                  id="create-user-email"
                  name="velodesk_user_account_email"
                  autoComplete="off"
                  data-lpignore="true"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  placeholder="ex: joao@empresa.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Senha Inicial (Argon2id) *</label>
                <input
                  type="password"
                  required
                  id="create-user-password"
                  name="velodesk_user_account_password"
                  autoComplete="new-password"
                  data-lpignore="true"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Papel / Nível de Acesso (Role) *</label>
                <select
                  id="new-user-role"
                  name="velodesk_user_role"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                >
                  <option value="TECHNICIAN">TECHNICIAN (Acesso e Controle Remoto de Computadores)</option>
                  <option value="ADMIN">ADMIN (Administrador do Escritório e Usuários Locais)</option>
                  <option value="SUPERADMIN">SUPERADMIN (Administrador Master Global)</option>
                </select>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setIsNewUserOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
