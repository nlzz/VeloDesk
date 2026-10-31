import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, LifeBuoy, ShieldCheck, Zap, LogOut, Shield } from 'lucide-react';
import { TenantInfo, UserInfo } from '../../services/api';

export type DashboardTab = 'devices' | 'helpdesk' | 'audit' | 'direct';

interface TenantNavbarProps {
  tenant: TenantInfo;
  user: UserInfo;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onLogout: () => void;
  pendingTicketsCount: number;
}

export const TenantNavbar: React.FC<TenantNavbarProps> = ({
  tenant,
  user,
  activeTab,
  onTabChange,
  onLogout,
  pendingTicketsCount,
}) => {
  const navigate = useNavigate();
  const isSuperAdmin =
    user?.role === 'SUPERADMIN' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'LEGACY_SUPER_ADMIN';
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Tenant Logo */}
        <div className="flex items-center gap-3">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt={tenant.name} className="h-9 w-auto rounded object-contain bg-white/10 p-1" />
          ) : (
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-sm"
              style={{ backgroundColor: tenant.primary_color || '#2563EB' }}
            >
              {tenant.name.substring(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100 text-base leading-tight tracking-tight">{tenant.name}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Enterprise v2.0
              </span>
            </div>
            <span className="text-xs text-slate-400 font-mono">/t/{tenant.slug}</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
          <button
            type="button"
            onClick={() => onTabChange('devices')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'devices'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Dispositivos</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('helpdesk')}
            className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'helpdesk'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Fila de Chamados</span>
            {pendingTicketsCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950 animate-pulse">
                {pendingTicketsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('audit')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'audit'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Auditoria Forense</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('direct')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'direct'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Conexão Manual</span>
          </button>
        </nav>

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500/20 via-yellow-500/20 to-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 hover:border-amber-400 hover:text-amber-200 transition shadow-md shadow-amber-500/10 cursor-pointer"
              title="Retornar ao Painel Master Super-Admin"
            >
              <Shield className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
              <span>🛡️ Painel Master</span>
            </button>
          )}

          <div className="text-right">
            <div className="text-xs font-semibold text-slate-200">{user.name}</div>
            <div className="text-[10px] font-mono text-slate-400">{user.role}</div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            title="Encerrar sessão"
            className="p-2 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-700/60 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
