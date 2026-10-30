import React, { useRef, useEffect, useCallback } from 'react';
import {
  InputMessage,
  createMouseMoveMessage,
  createMouseDownMessage,
  createMouseUpMessage,
  createMouseWheelMessage,
  createKeyDownMessage,
  createKeyUpMessage,
} from '../protocol/input';
import { normalizeCoordinates, VideoViewportDimensions } from '../protocol/normalization';
import { Loader2, Monitor } from 'lucide-react';

interface VideoPlayerProps {
  stream: MediaStream | null;
  scaleMode: 'contain' | 'original' | 'fill';
  onSendInput: (msg: InputMessage) => void;
  isInputEnabled?: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  stream,
  scaleMode,
  onSendInput,
  isInputEnabled = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Vincula o MediaStream ao elemento de vídeo acelerado por hardware
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch((err) => {
        console.warn('[VideoPlayer] Autoplay bloqueado pelo navegador, aguardando interação:', err);
      });
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  // Garante foco do teclado no container ao clicar
  const ensureFocus = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  // Coleta dimensões dinâmicas da viewport para o algoritmo de normalização
  const getViewportDimensions = useCallback((): VideoViewportDimensions | null => {
    const video = videoRef.current;
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    return {
      elementWidth: rect.width,
      elementHeight: rect.height,
      videoWidth: video.videoWidth || rect.width,
      videoHeight: video.videoHeight || rect.height,
      elementLeft: rect.left,
      elementTop: rect.top,
    };
  }, []);

  // Tratamento de Movimento do Mouse
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      if (!isInputEnabled) return;
      const viewport = getViewportDimensions();
      if (!viewport) return;

      const { x, y } = normalizeCoordinates(e.clientX, e.clientY, viewport);
      onSendInput(createMouseMoveMessage(x, y));
    },
    [isInputEnabled, getViewportDimensions, onSendInput]
  );

  // Tratamento de Clique Pressionado
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      ensureFocus();
      if (!isInputEnabled) return;

      // 0 = Esq, 1 = Meio, 2 = Dir
      onSendInput(createMouseDownMessage(e.button));
    },
    [ensureFocus, isInputEnabled, onSendInput]
  );

  // Tratamento de Liberação de Botão
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      if (!isInputEnabled) return;
      onSendInput(createMouseUpMessage(e.button));
    },
    [isInputEnabled, onSendInput]
  );

  // Previne menu de contexto do navegador para repassar clique direito ao host
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Tratamento de Rolagem (Mouse Wheel)
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLVideoElement>) => {
      if (!isInputEnabled) return;
      e.preventDefault();
      onSendInput(createMouseWheelMessage(e.deltaX, e.deltaY));
    },
    [isInputEnabled, onSendInput]
  );

  // Tratamento de Tecla Pressionada
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isInputEnabled) return;

      // Não intercepta F11 (tela cheia do navegador) ou F12 (DevTools)
      if (e.key === 'F11' || e.key === 'F12') {
        return;
      }

      e.preventDefault();
      onSendInput(createKeyDownMessage(e.code, e.keyCode));
    },
    [isInputEnabled, onSendInput]
  );

  // Tratamento de Liberação de Tecla
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isInputEnabled) return;

      if (e.key === 'F11' || e.key === 'F12') {
        return;
      }

      e.preventDefault();
      onSendInput(createKeyUpMessage(e.code, e.keyCode));
    },
    [isInputEnabled, onSendInput]
  );

  // Estilos de dimensionamento conforme scaleMode
  const getVideoStyle = (): React.CSSProperties => {
    switch (scaleMode) {
      case 'original':
        return {
          width: 'auto',
          height: 'auto',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'none',
        };
      case 'fill':
        return {
          width: '100%',
          height: '100%',
          objectFit: 'fill',
        };
      case 'contain':
      default:
        return {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        };
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onClick={ensureFocus}
      className="relative w-full h-full bg-black flex items-center justify-center outline-none select-none overflow-hidden cursor-crosshair"
    >
      {/* Elemento de Vídeo Acelerado */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
        style={getVideoStyle()}
        className="pointer-events-auto"
      />

      {/* Overlay de carregamento enquanto não houver trilha de vídeo ativa */}
      {!stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-400 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-brand-400 shadow-xl">
            <Monitor className="w-8 h-8" />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300 font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
            <span>Aguardando fluxo de vídeo H.264 do Host...</span>
          </div>
          <p className="text-xs text-slate-500 max-w-sm text-center">
            Negociação WebRTC estabelecida. A superfície D3D11 / WGC do host remoto será projetada aqui.
          </p>
        </div>
      )}
    </div>
  );
};
