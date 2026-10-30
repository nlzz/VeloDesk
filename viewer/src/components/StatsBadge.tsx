import React from 'react';
import { WebRTCStatsSummary } from '../services/stats';
import { Activity, ShieldCheck, Repeat, Wifi } from 'lucide-react';

interface StatsBadgeProps {
  stats: WebRTCStatsSummary | null;
  compact?: boolean;
}

export const StatsBadge: React.FC<StatsBadgeProps> = ({ stats, compact = false }) => {
  if (!stats) return null;

  const isRelay = stats.connectionType === 'relay';

  const getLatencyColor = (ms: number) => {
    if (ms <= 35) return 'text-emerald-400';
    if (ms <= 75) return 'text-yellow-400';
    return 'text-rose-400';
  };

  const getFpsColor = (fps: number) => {
    if (fps >= 50) return 'text-emerald-400';
    if (fps >= 25) return 'text-yellow-400';
    return 'text-rose-400';
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-900/80 backdrop-blur rounded-lg border border-slate-700/60 text-[11px] font-mono">
        <span className="flex items-center gap-1">
          <Activity className="w-3 h-3 text-slate-400" />
          <span className={getLatencyColor(stats.latencyMs)}>{stats.latencyMs}ms</span>
        </span>
        <span className="text-slate-600">•</span>
        <span className={getFpsColor(stats.fps)}>{stats.fps} FPS</span>
        <span className="text-slate-600">•</span>
        <span className="text-slate-300">
          {stats.bitrateKbps >= 1000
            ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mbps`
            : `${stats.bitrateKbps} kbps`}
        </span>
        <span className="text-slate-600">•</span>
        <span
          className={`flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-sans ${
            isRelay
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          }`}
        >
          {isRelay ? <Repeat className="w-2.5 h-2.5" /> : <ShieldCheck className="w-2.5 h-2.5" />}
          {isRelay ? 'TURN' : 'P2P'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-700/80 shadow-lg text-xs font-mono">
      <div className="flex items-center gap-1.5">
        <Wifi className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-slate-400">RTT:</span>
        <span className={`font-semibold ${getLatencyColor(stats.latencyMs)}`}>
          {stats.latencyMs} ms
        </span>
      </div>

      <div className="w-px h-3 bg-slate-700" />

      <div className="flex items-center gap-1">
        <span className="text-slate-400">FPS:</span>
        <span className={`font-semibold ${getFpsColor(stats.fps)}`}>{stats.fps}</span>
      </div>

      <div className="w-px h-3 bg-slate-700" />

      <div className="flex items-center gap-1">
        <span className="text-slate-400">Taxa:</span>
        <span className="text-slate-200">
          {stats.bitrateKbps >= 1000
            ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mb/s`
            : `${stats.bitrateKbps} kb/s`}
        </span>
      </div>

      {stats.resolution !== '--' && (
        <>
          <div className="w-px h-3 bg-slate-700" />
          <div className="text-slate-400">{stats.resolution}</div>
        </>
      )}

      <div className="w-px h-3 bg-slate-700" />

      <div
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-sans font-medium ${
          isRelay
            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
        }`}
      >
        {isRelay ? <Repeat className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
        <span>{isRelay ? 'TURN Relay' : 'Direto P2P'}</span>
      </div>
    </div>
  );
};
