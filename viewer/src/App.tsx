import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ConnectionModal } from './components/ConnectionModal';
import { RemoteSession } from './components/RemoteSession';
import { SignalingClient } from './services/signaling';
import { WebRTCClient } from './services/webrtc';
import { InputMessage } from './protocol/input';
import { WebRTCStatsSummary } from './services/stats';

async function calculateSha256(str: string): Promise<string> {
  if (!str) return '';
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return str; // Fallback se SubtleCrypto não estiver disponível
  }
}

export const App: React.FC = () => {
  const [sessionState, setSessionState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [targetId, setTargetId] = useState('');
  const [statusText, setStatusText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<WebRTCStatsSummary | null>(null);

  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRTCClient | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // Inicializa instâncias
  useEffect(() => {
    const signaling = new SignalingClient({
      onConnectAck: async (msg) => {
        console.log('[App] Conexão aprovada pelo servidor. SessionID:', msg.session_id);
        currentSessionIdRef.current = msg.session_id;
        setStatusText('Host localizado. Aguardando oferta de vídeo H.264...');

        if (webrtcRef.current) {
          webrtcRef.current.initializePeerConnection(msg.session_id, msg.turn_credentials);
        }
      },
      onConnectError: (msg) => {
        console.warn('[App] Erro de conexão retornado:', msg.message);
        setErrorMessage(msg.message);
        disconnectSession();
      },
      onWebRTCOffer: async (msg) => {
        console.log('[App] Oferta WebRTC recebida. Processando SDP...');
        setStatusText('Negociando túnel WebRTC direto...');
        if (webrtcRef.current) {
          try {
            await webrtcRef.current.handleRemoteOffer(msg.session_id, msg.sdp);
          } catch (err) {
            console.error('[App] Falha ao processar oferta WebRTC:', err);
            setErrorMessage('Falha na negociação WebRTC com o agente.');
            disconnectSession();
          }
        }
      },
      onIceCandidate: async (msg) => {
        if (webrtcRef.current) {
          await webrtcRef.current.addIceCandidate(msg.candidate);
        }
      },
      onDisconnect: (msg) => {
        console.log('[App] Host encerrou a sessão:', msg.reason);
        setErrorMessage(`Sessão encerrada pelo host: ${msg.reason || 'Conexão finalizada'}`);
        disconnectSession();
      },
      onError: () => {
        setErrorMessage('Não foi possível conectar ao servidor de sinalização.');
        disconnectSession();
      },
    });

    const webrtc = new WebRTCClient(signaling, {
      onStream: (remoteStream) => {
        console.log('[App] Trilha de vídeo ativa recebida com sucesso!');
        setStream(remoteStream);
        setSessionState('connected');
        setStatusText('');
        setErrorMessage(null);
      },
      onStats: (summary) => {
        setStats(summary);
      },
      onConnectionStateChange: (state) => {
        console.log('[App] WebRTC Connection State:', state);
        if (state === 'failed') {
          setErrorMessage('Falha na conexão P2P/TURN com o host remoto.');
          disconnectSession();
        } else if (state === 'disconnected') {
          setStatusText('Reconectando...');
        }
      },
      onDataChannelStateChange: (channel, state) => {
        console.log(`[App] DataChannel ${channel} mudou para:`, state);
      },
      onError: (err) => {
        console.error('[App] Erro WebRTC:', err);
        setErrorMessage(`Erro WebRTC: ${err.message}`);
      },
    });

    signalingRef.current = signaling;
    webrtcRef.current = webrtc;

    return () => {
      webrtc.close();
      signaling.disconnect();
    };
  }, []);

  const handleConnect = async (inputTargetId: string, inputPassword: string, serverUrl: string) => {
    setErrorMessage(null);
    setTargetId(inputTargetId);
    setSessionState('connecting');
    setStatusText('Conectando ao servidor de sinalização...');

    try {
      const signaling = signalingRef.current;
      if (!signaling) return;

      await signaling.connect(serverUrl);
      setStatusText(`Solicitando conexão ao Host ${inputTargetId}...`);

      const passwordHash = inputPassword ? await calculateSha256(inputPassword) : undefined;
      signaling.sendConnectRequest(inputTargetId, passwordHash, 'VeloDesk Operator');
    } catch (err) {
      console.error('[App] Falha ao iniciar conexão:', err);
      setErrorMessage('Falha ao conectar no servidor WebSocket. Verifique a URL e sua conexão.');
      setSessionState('idle');
    }
  };

  const disconnectSession = useCallback(() => {
    if (signalingRef.current && currentSessionIdRef.current) {
      signalingRef.current.sendDisconnect(currentSessionIdRef.current, 'operator_closed');
    }
    if (webrtcRef.current) {
      webrtcRef.current.close();
    }
    if (signalingRef.current) {
      signalingRef.current.disconnect();
    }

    currentSessionIdRef.current = null;
    setStream(null);
    setStats(null);
    setSessionState('idle');
  }, []);

  const handleSendInput = useCallback((msg: InputMessage) => {
    if (webrtcRef.current) {
      webrtcRef.current.sendInput(msg);
    }
  }, []);

  const handleSendShortcut = useCallback(
    (shortcut: 'ctrl_alt_del' | 'win_d' | 'ctrl_shift_esc' | 'alt_tab' | 'win_l') => {
      if (webrtcRef.current) {
        webrtcRef.current.sendSpecialShortcut(shortcut);
      }
    },
    []
  );

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none">
      {sessionState === 'connected' ? (
        <RemoteSession
          targetId={targetId}
          stream={stream}
          stats={stats}
          onSendInput={handleSendInput}
          onSendShortcut={handleSendShortcut}
          onDisconnect={disconnectSession}
        />
      ) : (
        <ConnectionModal
          onConnect={handleConnect}
          isConnecting={sessionState === 'connecting'}
          statusText={statusText}
          errorMessage={errorMessage}
        />
      )}
    </div>
  );
};
