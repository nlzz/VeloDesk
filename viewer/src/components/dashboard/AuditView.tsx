import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  Hash,
  FileText,
} from 'lucide-react';
import { AuditEvent, SessionRecord, api, AuditVerificationResult } from '../../services/api';

export const AuditView: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [verificationResult, setVerificationResult] = useState<AuditVerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'chain' | 'sessions'>('chain');

  const loadAuditData = async () => {
    try {
      const [evts, sess] = await Promise.all([
        api.listAuditEvents(),
        api.listSessions(),
      ]);
      setEvents(evts);
      setSessions(sess);
    } catch (err) {
      console.error('[Audit] Erro ao carregar dados de auditoria:', err);
    }
  };

  useEffect(() => {
    loadAuditData();
  }, []);

  const handleVerifyChain = async () => {
    setIsVerifying(true);
    try {
      const res = await api.verifyAuditChain();
      setVerificationResult(res);
    } catch (err: any) {
      setVerificationResult({
        verified: false,
        total_events: events.length,
        message: 'Falha na verificação da cadeia',
        error: err.message,
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const exportToJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(events, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `velodesk-audit-${new Date().toISOString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-4">
      {/* Top Banner de Blindagem Jurídica e Rastreabilidade */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-slate-100">Auditoria Forense & Rastreabilidade LGPD</h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Art. 46 / 48 LGPD
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Cadeia sequencial imutável selada com SHA-256 e HMAC. Qualquer alteração, deleção ou injeção indevida é detectada matematicamente.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleVerifyChain}
            disabled={isVerifying}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-md transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
            <span>Verificar Cadeia Criptográfica</span>
          </button>

          <button
            type="button"
            onClick={exportToJson}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700/60 transition"
            title="Exportar trilha forense"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>Exportar JSON</span>
          </button>
        </div>
      </div>

      {/* Cartão de Resultado da Verificação da Cadeia */}
      {verificationResult && (
        <div
          className={`p-4 rounded-2xl border transition shadow-sm flex items-center justify-between ${
            verificationResult.verified
              ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/20 border-red-500/40 text-red-300'
          }`}
        >
          <div className="flex items-center gap-3">
            {verificationResult.verified ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
            )}
            <div>
              <div className="font-bold text-xs sm:text-sm">
                {verificationResult.verified
                  ? 'Cadeia de Custódia 100% Íntegra (Tamper-Evident Verified)'
                  : 'ALERTA: Adulteração Detectada nos Registros de Auditoria!'}
              </div>
              <div className="text-[11px] opacity-80">
                {verificationResult.message} ({verificationResult.total_events} elos criptográficos checados)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtabs: Cadeia Criptográfica vs Sessões */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('chain')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeSubTab === 'chain' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Hash className="w-3.5 h-3.5" />
          <span>Elos Criptográficos ({events.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('sessions')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeSubTab === 'sessions' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Histórico de Sessões ({sessions.length})</span>
        </button>
      </div>

      {/* Tabela de Elos Criptográficos */}
      {activeSubTab === 'chain' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/60 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3">Seq</th>
                  <th className="px-4 py-3">Tipo do Evento</th>
                  <th className="px-4 py-3">Payload SHA-256</th>
                  <th className="px-4 py-3">Selo HMAC-SHA256</th>
                  <th className="px-4 py-3">Carimbo Temporal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                {events.map((evt) => (
                  <tr key={evt.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3 font-bold text-blue-400">#{evt.sequence_number}</td>
                    <td className="px-4 py-3 font-sans font-bold text-slate-200">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs">
                        {evt.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400" title={evt.payload_hash}>
                      {evt.payload_hash.substring(0, 16)}...
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-semibold" title={evt.hmac_sha256}>
                      {evt.hmac_sha256.substring(0, 16)}...
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(evt.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500 font-sans text-xs">
                      Nenhum evento registrado ainda na cadeia de auditoria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabela de Histórico de Sessões */}
      {activeSubTab === 'sessions' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/60 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3">Sessão</th>
                  <th className="px-4 py-3">Agente / Máquina</th>
                  <th className="px-4 py-3">Técnico</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Início</th>
                  <th className="px-4 py-3">Duração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-xs">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3 font-mono text-blue-400 font-bold">{s.session_id.substring(0, 12)}...</td>
                    <td className="px-4 py-3 font-mono text-slate-200">{s.agent_id}</td>
                    <td className="px-4 py-3 text-slate-300">{s.tech_name || 'Operador'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400">
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono">
                      {new Date(s.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono">
                      {s.duration_seconds}s
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-xs">
                      Nenhuma sessão remota registrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
