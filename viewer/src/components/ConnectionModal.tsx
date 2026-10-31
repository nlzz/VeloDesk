import React, { useState, useEffect } from 'react';
import {
  Monitor,
  KeyRound,
  Server,
  Zap,
  ArrowRight,
  Eye,
  EyeOff,
  History,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface ConnectionModalProps {
  onConnect: (targetId: string, password: string, serverUrl: string) => void;
  isConnecting: boolean;
  statusText: string;
  errorMessage: string | null;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  onConnect,
  isConnecting,
  statusText,
  errorMessage,
}) => {
  const [targetId, setTargetId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  // Inicializa a URL padrão do servidor WebSocket
  useEffect(() => {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host || 'localhost:8080';
      setServerUrl(`${protocol}//${host}/ws`);

      // Carrega histórico local
      try {
        const stored = localStorage.getItem('velodesk_recent_ids');
        if (stored) {
          setRecentIds(JSON.parse(stored));
        }
      } catch {
        // Ignora erro de storage
      }
    }
  }, []);

  // Formata o ID do Host automaticamente em 9 dígitos: "123-456-789"
  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    let formatted = raw;
    if (raw.length > 6) {
      formatted = `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
    } else if (raw.length > 3) {
      formatted = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    }
    setTargetId(formatted);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = targetId.trim();
    if (!cleanId || isConnecting) return;

    // Salva no histórico
    const updated = [cleanId, ...recentIds.filter((id) => id !== cleanId)].slice(0, 5);
    setRecentIds(updated);
    try {
      localStorage.setItem('velodesk_recent_ids', JSON.stringify(updated));
    } catch {
      // Ignora erro
    }

    onConnect(cleanId, password, serverUrl);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 z-50">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl shadow-cyan-950/20 overflow-hidden">
        {/* Cabeçalho */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 px-6 py-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
              <Zap className="w-5 h-5 fill-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                VeloDesk <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 font-mono">v2.0 Enterprise</span>
              </h1>
              <p className="text-xs text-slate-400">Controle Remoto de Ultra-Baixa Latência</p>
            </div>
          </div>
        </div>

        {/* Formulário Principal */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Campo: ID do Host */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-brand-400" />
              ID do Host Remoto
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Ex: 832-192-041"
                value={targetId}
                onChange={handleIdChange}
                disabled={isConnecting}
                autoFocus
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-3.5 text-lg font-mono tracking-widest text-white placeholder-slate-600 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
            </div>

            {/* Sugestões do histórico */}
            {recentIds.length > 0 && !isConnecting && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 pt-1 overflow-x-auto">
                <History className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="shrink-0">Recentes:</span>
                {recentIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTargetId(id)}
                    className="font-mono text-brand-400 hover:text-brand-300 hover:underline px-1 py-0.5 rounded bg-slate-800/50 shrink-0 transition"
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Campo: Senha do Host */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-brand-400" />
              Senha de Acesso (Opcional)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Insira a senha se exigida pelo agente"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isConnecting}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-4 pr-11 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Opções Avançadas de Servidor */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-slate-400 hover:text-brand-400 flex items-center gap-1 transition"
            >
              <Server className="w-3 h-3" />
              {showAdvanced ? 'Ocultar Servidor de Sinalização' : 'Configurar Servidor de Sinalização'}
            </button>

            {showAdvanced && (
              <div className="mt-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1.5">
                <label className="text-xs text-slate-400">URL WebSocket (WSS / WS)</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  disabled={isConnecting}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>
            )}
          </div>

          {/* Feedback de Erro */}
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Status de Conexão */}
          {isConnecting && (
            <div className="p-3 bg-brand-500/10 border border-brand-500/30 rounded-xl flex items-center gap-2.5 text-xs text-brand-300 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-brand-400 shrink-0" />
              <span>{statusText || 'Conectando ao host remoto...'}</span>
            </div>
          )}

          {/* Botão de Ação */}
          <button
            type="submit"
            disabled={isConnecting || !targetId.trim()}
            className="w-full bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 px-4 rounded-xl shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2 transition-all group"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Estabelecendo Sessão...</span>
              </>
            ) : (
              <>
                <span>Conectar ao Host</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
          {/* Link para Hub Enterprise / Multi-Tenant */}
          <div className="pt-2 text-center">
            <a
              href="/t/default"
              className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-4 transition-colors"
            >
              🏢 Acessar Painel Enterprise & Helpdesk (/t/:slug)
            </a>
          </div>
        </form>

        {/* Rodapé Informativo */}
        <div className="px-6 py-3 bg-slate-950/50 border-t border-slate-800 text-center text-[11px] text-slate-500">
          Criptografia Ponta a Ponta WebRTC (DTLS-SRTP) • Hardware Accelerated H.264
        </div>
      </div>
    </div>
  );
};
