import React, { useState } from 'react';
import {
  Maximize2,
  Minimize2,
  PhoneOff,
  Command,
  ChevronDown,
  Pin,
  PinOff,
  Zap,
} from 'lucide-react';
import { StatsBadge } from './StatsBadge';
import { WebRTCStatsSummary } from '../services/stats';

interface ControlToolbarProps {
  targetId: string;
  stats: WebRTCStatsSummary | null;
  scaleMode: 'contain' | 'original' | 'fill';
  onScaleModeChange: (mode: 'contain' | 'original' | 'fill') => void;
  onSendShortcut: (shortcut: 'ctrl_alt_del' | 'win_d' | 'ctrl_shift_esc' | 'alt_tab' | 'win_l') => void;
  onDisconnect: () => void;
}

export const ControlToolbar: React.FC<ControlToolbarProps> = ({
  targetId,
  stats,
  scaleMode,
  onScaleModeChange,
  onSendShortcut,
  onDisconnect,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcutsMenu, setShowShortcutsMenu] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('[Viewer] Falha ao alternar tela cheia:', err);
    }
  };

  const handleShortcut = (shortcut: 'ctrl_alt_del' | 'win_d' | 'ctrl_shift_esc' | 'alt_tab' | 'win_l') => {
    onSendShortcut(shortcut);
    setShowShortcutsMenu(false);
  };

  const isVisible = isPinned || isHovered;

  return (
    <div
      className="fixed top-0 left-0 right-0 flex justify-center z-40 pointer-events-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowShortcutsMenu(false);
      }}
    >
      {/* Gatilho invisível para revelar barra ao aproximar mouse do topo */}
      <div className="absolute top-0 w-80 h-3 pointer-events-auto" />

      {/* Conteúdo da Barra Flutuante */}
      <div
        className={`pointer-events-auto transition-all duration-300 transform ${
          isVisible ? 'translate-y-2 opacity-100' : '-translate-y-8 opacity-0'
        } bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl rounded-2xl px-4 py-2 flex items-center gap-3 text-slate-200`}
      >
        {/* Identificador da Sessão */}
        <div className="flex items-center gap-2 border-r border-slate-700/60 pr-3">
          <div className="w-6 h-6 rounded-lg bg-brand-500/20 text-brand-400 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 fill-current" />
          </div>
          <span className="font-mono text-xs font-semibold text-slate-100">{targetId}</span>
        </div>

        {/* Estatísticas em Tempo Real */}
        <StatsBadge stats={stats} compact />

        {/* Separador */}
        <div className="w-px h-4 bg-slate-700/60" />

        {/* Dropdown de Atalhos de Sistema */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowShortcutsMenu(!showShortcutsMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700/80 text-xs font-medium transition"
            title="Enviar atalhos de teclado do Windows"
          >
            <Command className="w-3.5 h-3.5 text-brand-400" />
            <span>Atalhos</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showShortcutsMenu && (
            <div className="absolute left-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
              <button
                type="button"
                onClick={() => handleShortcut('ctrl_alt_del')}
                className="w-full text-left px-3 py-2 hover:bg-brand-500/20 text-slate-200 flex items-center justify-between transition"
              >
                <span>Ctrl + Alt + Del</span>
                <span className="text-[10px] text-slate-400 font-mono">Segurança</span>
              </button>
              <button
                type="button"
                onClick={() => handleShortcut('win_d')}
                className="w-full text-left px-3 py-2 hover:bg-brand-500/20 text-slate-200 flex items-center justify-between transition"
              >
                <span>Win + D</span>
                <span className="text-[10px] text-slate-400 font-mono">Área Trab.</span>
              </button>
              <button
                type="button"
                onClick={() => handleShortcut('ctrl_shift_esc')}
                className="w-full text-left px-3 py-2 hover:bg-brand-500/20 text-slate-200 flex items-center justify-between transition"
              >
                <span>Ctrl + Shift + Esc</span>
                <span className="text-[10px] text-slate-400 font-mono">Tarefas</span>
              </button>
              <button
                type="button"
                onClick={() => handleShortcut('alt_tab')}
                className="w-full text-left px-3 py-2 hover:bg-brand-500/20 text-slate-200 flex items-center justify-between transition"
              >
                <span>Alt + Tab</span>
                <span className="text-[10px] text-slate-400 font-mono">Janelas</span>
              </button>
              <button
                type="button"
                onClick={() => handleShortcut('win_l')}
                className="w-full text-left px-3 py-2 hover:bg-brand-500/20 text-slate-200 flex items-center justify-between transition"
              >
                <span>Win + L</span>
                <span className="text-[10px] text-slate-400 font-mono">Bloquear</span>
              </button>
            </div>
          )}
        </div>

        {/* Modo de Escala */}
        <select
          value={scaleMode}
          onChange={(e) => onScaleModeChange(e.target.value as 'contain' | 'original' | 'fill')}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
          title="Modo de Ajuste do Vídeo"
        >
          <option value="contain">Ajustar Janela (16:9)</option>
          <option value="original">Original (1:1)</option>
          <option value="fill">Preencher (Esticar)</option>
        </select>

        {/* Botão Tela Cheia */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700/80 text-slate-300 hover:text-white transition"
          title={isFullscreen ? 'Sair da Tela Cheia' : 'Modo Tela Cheia (F11)'}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {/* Fixar Barra */}
        <button
          type="button"
          onClick={() => setIsPinned(!isPinned)}
          className={`p-1.5 rounded-lg transition ${
            isPinned
              ? 'bg-brand-500/20 text-brand-400 border border-brand-500/40'
              : 'bg-slate-800 hover:bg-slate-700/80 text-slate-400 hover:text-white'
          }`}
          title={isPinned ? 'Desafixar Barra' : 'Fixar Barra no Topo'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>

        {/* Desconectar */}
        <button
          type="button"
          onClick={onDisconnect}
          className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition flex items-center gap-1.5 px-2.5"
          title="Encerrar Sessão de Controle"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold">Sair</span>
        </button>
      </div>
    </div>
  );
};
