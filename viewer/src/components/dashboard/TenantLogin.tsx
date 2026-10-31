import React, { useState } from 'react';
import { Lock, Mail, ShieldAlert, Zap } from 'lucide-react';
import { TenantInfo, UserInfo, api } from '../../services/api';

interface TenantLoginProps {
  tenant: TenantInfo;
  onLoginSuccess: (user: UserInfo, token: string) => void;
  onDirectConnect: () => void;
}

export const TenantLogin: React.FC<TenantLoginProps> = ({
  tenant,
  onLoginSuccess,
  onDirectConnect,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.login(tenant.slug, email, password);
      onLoginSuccess(res.user, res.token);
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao autenticar.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        {/* Branding do Tenant */}
        <div className="text-center space-y-3">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt={tenant.name} className="h-12 w-auto mx-auto object-contain" />
          ) : (
            <div
              className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center font-bold text-white text-xl shadow-lg"
              style={{ backgroundColor: tenant.primary_color || '#2563EB' }}
            >
              {tenant.name.substring(0, 2).toUpperCase()}
            </div>
          )}

          <div>
            <h1 className="text-xl font-bold text-slate-100">{tenant.name}</h1>
            <p className="text-xs text-slate-400 mt-1">Portal do Técnico & Central de Atendimento</p>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-400">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail Corporativo</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tecnico@empresa.com"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Senha de Acesso</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{ backgroundColor: tenant.primary_color || '#2563EB' }}
            className="w-full py-2.5 rounded-xl text-white font-bold text-xs shadow-lg hover:opacity-95 transition disabled:opacity-50"
          >
            {isLoading ? 'Autenticando...' : 'Acessar Central de Suporte'}
          </button>
        </form>

        <div className="border-t border-slate-800 pt-4 text-center">
          <button
            type="button"
            onClick={onDirectConnect}
            className="text-xs text-slate-400 hover:text-slate-200 transition flex items-center justify-center gap-1.5 mx-auto"
          >
            <Zap className="w-3.5 h-3.5 text-blue-400" />
            <span>Alternar para Conexão P2P Direta</span>
          </button>
        </div>
      </div>
    </div>
  );
};
