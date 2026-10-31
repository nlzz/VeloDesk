import React, { useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { ControlToolbar } from './ControlToolbar';
import { InputMessage } from '../protocol/input';
import { WebRTCStatsSummary } from '../services/stats';

interface RemoteSessionProps {
  targetId: string;
  stream: MediaStream | null;
  stats: WebRTCStatsSummary | null;
  onSendInput: (msg: InputMessage) => void;
  onSendShortcut: (shortcut: 'ctrl_alt_del' | 'win_d' | 'ctrl_shift_esc' | 'alt_tab' | 'win_l') => void;
  onDisconnect: () => void;
  onOpenChat?: () => void;
  onOpenFileTransfer?: () => void;
}

export const RemoteSession: React.FC<RemoteSessionProps> = ({
  targetId,
  stream,
  stats,
  onSendInput,
  onSendShortcut,
  onDisconnect,
  onOpenChat,
  onOpenFileTransfer,
}) => {
  const [scaleMode, setScaleMode] = useState<'contain' | 'original' | 'fill'>('contain');

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden flex flex-col">
      {/* Barra de Controle Flutuante no Topo */}
      <ControlToolbar
        targetId={targetId}
        stats={stats}
        scaleMode={scaleMode}
        onScaleModeChange={setScaleMode}
        onSendShortcut={onSendShortcut}
        onDisconnect={onDisconnect}
        onOpenChat={onOpenChat}
        onOpenFileTransfer={onOpenFileTransfer}
      />

      {/* Área Central de Visualização e Captura de Input */}
      <div className="flex-1 w-full h-full relative">
        <VideoPlayer
          stream={stream}
          scaleMode={scaleMode}
          onSendInput={onSendInput}
        />
      </div>
    </div>
  );
};
