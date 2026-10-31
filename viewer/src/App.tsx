import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ConnectionModal } from './components/ConnectionModal';
import { RemoteSession } from './components/RemoteSession';
import { TenantNavbar, DashboardTab } from './components/dashboard/TenantNavbar';
import { DevicesView } from './components/dashboard/DevicesView';
import { HelpdeskView } from './components/dashboard/HelpdeskView';
import { AuditView } from './components/dashboard/AuditView';
import { TenantLogin } from './components/dashboard/TenantLogin';
import { InSessionChat, ChatMessage } from './components/InSessionChat';
import { FileTransferModal } from './components/FileTransferModal';
import { SignalingClient } from './services/signaling';
import { WebRTCClient } from './services/webrtc';
import { InputMessage } from './protocol/input';
import { WebRTCStatsSummary } from './services/stats';
import { api, TenantInfo, UserInfo, RemoteDevice, DeviceGroup, DeviceTag, HelpdeskTicket } from './services/api';

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
    return str;
  }
}

function getTenantSlugFromUrl(): string | null {
  const path = window.location.pathname;
  if (path.startsWith('/t/')) {
    const parts = path.substring(3).split('/');
    if (parts[0]) return parts[0];
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant');
}

export const App: React.FC = () => {
  // Estado de Autenticação e Multi-Tenancy
  const [tenant, setTenant] = useState<TenantInfo | null>(api.getTenant());
  const [user, setUser] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>('devices');
  const [isDirectConnectMode, setIsDirectConnectMode] = useState(false);

  // Dados do Dashboard
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [tags, setTags] = useState<DeviceTag[]>([]);
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);

  // Estado da Sessão WebRTC
  const [sessionState, setSessionState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [targetId, setTargetId] = useState('');
  const [statusText, setStatusText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<WebRTCStatsSummary | null>(null);

  // Ferramentas da Sessão (Chat & Transferência de Arquivos)
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isFileTransferOpen, setIsFileTransferOpen] = useState(false);
  const [sessionChatMessages, setSessionChatMessages] = useState<ChatMessage[]>([]);

  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRTCClient | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // 1. Detecção Inicial de Slug de Tenant pela URL
  useEffect(() => {
    const slug = getTenantSlugFromUrl();
    if (slug) {
      api.getTenantBySlug(slug)
        .then((t) => {
          setTenant(t);
          api.setTenant(t);
        })
        .catch((err) => {
          console.warn('[App] Tenant não localizado via slug:', err);
        });
    }
  }, []);

  // 2. Carrega Dados do Dashboard quando autenticado
  const loadDashboardData = useCallback(async () => {
    if (!api.getToken()) return;
    setIsLoadingDashboard(true);
    try {
      const [devs, grps, tgs, tcks] = await Promise.all([
        api.listDevices(),
        api.listGroups(),
        api.listTags(),
        api.listTickets(),
      ]);
      setDevices(devs);
      setGroups(grps);
      setTags(tgs);
      setTickets(tcks);
    } catch (err) {
      console.error('[App] Erro ao carregar dados do tenant:', err);
    } finally {
      setIsLoadingDashboard(false);
    }
  }, []);

  useEffect(() => {
    if (api.getToken() && tenant) {
      loadDashboardData();
    }
  }, [tenant, loadDashboardData]);

  // 3. Inicializa Sinalização e WebRTC
  useEffect(() => {
    const signaling = new SignalingClient({
      onConnectAck: async (msg) => {
        console.log('[App] Conexão aprovada pelo servidor. SessionID:', msg.session_id);
        currentSessionIdRef.current = msg.session_id;
        setStatusText('Host localizado. Aguardando stream H.264...');

        if (webrtcRef.current) {
          webrtcRef.current.initializePeerConnection(msg.session_id, msg.turn_credentials);
        }
      },
      onConnectError: (msg) => {
        console.warn('[App] Erro de conexão:', msg.message);
        setErrorMessage(msg.message);
        disconnectSession();
      },
      onWebRTCOffer: async (msg) => {
        setStatusText('Negociando túnel P2P/TURN...');
        if (webrtcRef.current) {
          try {
            await webrtcRef.current.handleRemoteOffer(msg.session_id, msg.sdp);
          } catch (err) {
            console.error('[App] Falha ao processar oferta SDP:', err);
            setErrorMessage('Falha na negociação WebRTC com o host.');
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
        setErrorMessage(`Sessão encerrada pelo host: ${msg.reason || 'Finalizada'}`);
        disconnectSession();
      },
      onError: () => {
        setErrorMessage('Não foi possível conectar ao servidor de sinalização.');
        disconnectSession();
      },
    });

    const webrtc = new WebRTCClient(signaling, {
      onStream: (remoteStream) => {
        setStream(remoteStream);
        setSessionState('connected');
        setStatusText('');
        setErrorMessage(null);
      },
      onStats: (summary) => {
        setStats(summary);
      },
      onConnectionStateChange: (state) => {
        if (state === 'failed') {
          setErrorMessage('Falha na conexão WebRTC com o host remoto.');
          disconnectSession();
        } else if (state === 'disconnected') {
          setStatusText('Reconectando...');
        }
      },
      onDataChannelStateChange: (channel, state) => {
        console.log(`[App] DataChannel ${channel} estado:`, state);
      },
      onError: (err) => {
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

  const handleConnect = async (inputTargetId: string, inputPassword?: string, serverUrl?: string) => {
    setErrorMessage(null);
    setTargetId(inputTargetId);
    setSessionState('connecting');
    setStatusText('Conectando ao servidor...');

    const defaultUrl = window.location.protocol === 'https:'
      ? `wss://${window.location.host}/ws`
      : `ws://${window.location.host}/ws`;

    try {
      const signaling = signalingRef.current;
      if (!signaling) return;

      await signaling.connect(serverUrl || defaultUrl);
      setStatusText(`Solicitando controle remoto ao Host ${inputTargetId}...`);

      const passwordHash = inputPassword ? await calculateSha256(inputPassword) : undefined;
      signaling.sendConnectRequest(inputTargetId, passwordHash, user?.name || 'Técnico VeloDesk');
    } catch (err) {
      console.error('[App] Falha ao iniciar conexão:', err);
      setErrorMessage('Falha ao conectar no servidor. Verifique a rede.');
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
    setIsChatOpen(false);
    setIsFileTransferOpen(false);
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

  const handleSendChatMessage = (text: string) => {
    const newMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: 'tech',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setSessionChatMessages((prev) => [...prev, newMsg]);
    // Envia pelo data channel de controle
    if (webrtcRef.current) {
      webrtcRef.current.sendControl({ type: 'chat', text });
    }
  };

  const handleSendFile = async (file: File, sha256: string) => {
    if (currentSessionIdRef.current) {
      await api.logFileTransfer(currentSessionIdRef.current, {
        filename: file.name,
        file_size: file.size,
        sha256_hash: sha256,
        direction: 'VIEWER_TO_AGENT',
        status: 'COMPLETED',
      });
    }
    if (webrtcRef.current) {
      webrtcRef.current.sendControl({
        type: 'file_start',
        filename: file.name,
        size: file.size,
        sha256,
      });
    }
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
    setTenant(null);
    setIsDirectConnectMode(true);
  };

  // Se estiver em sessão remota ativa, exibe visualizador WebRTC tela cheia
  if (sessionState === 'connected') {
    return (
      <div className="w-screen h-screen bg-black text-slate-100 flex flex-col overflow-hidden select-none">
        <RemoteSession
          targetId={targetId}
          stream={stream}
          stats={stats}
          onSendInput={handleSendInput}
          onSendShortcut={handleSendShortcut}
          onDisconnect={disconnectSession}
          onOpenChat={() => setIsChatOpen(!isChatOpen)}
          onOpenFileTransfer={() => setIsFileTransferOpen(true)}
        />

        <InSessionChat
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          messages={sessionChatMessages}
          onSendMessage={handleSendChatMessage}
        />

        <FileTransferModal
          isOpen={isFileTransferOpen}
          onClose={() => setIsFileTransferOpen(false)}
          onSendFile={handleSendFile}
        />
      </div>
    );
  }

  // Se houver tenant e o usuário não estiver autenticado nem em modo direto
  if (tenant && !api.getToken() && !isDirectConnectMode) {
    return (
      <TenantLogin
        tenant={tenant}
        onLoginSuccess={(u) => {
          setUser(u);
          loadDashboardData();
        }}
        onDirectConnect={() => setIsDirectConnectMode(true)}
      />
    );
  }

  // Dashboard do Técnico autenticado
  if (tenant && api.getToken()) {
    const pendingTickets = tickets.filter((t) => t.status === 'PENDING').length;
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <TenantNavbar
          tenant={tenant}
          user={user || { id: '', name: 'Técnico Autorizado', email: '', role: 'TECH' }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onLogout={handleLogout}
          pendingTicketsCount={pendingTickets}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {activeTab === 'devices' && (
            <DevicesView
              devices={devices}
              groups={groups}
              tags={tags}
              onConnect={(agentId) => handleConnect(agentId)}
              isLoading={isLoadingDashboard}
            />
          )}

          {activeTab === 'helpdesk' && (
            <HelpdeskView
              tickets={tickets}
              onConnectToTicket={(agentId) => handleConnect(agentId)}
              onRefresh={loadDashboardData}
              currentTechName={user?.name || 'Técnico'}
            />
          )}

          {activeTab === 'audit' && <AuditView />}

          {activeTab === 'direct' && (
            <div className="max-w-md mx-auto pt-8">
              <ConnectionModal
                onConnect={handleConnect}
                isConnecting={sessionState === 'connecting'}
                statusText={statusText}
                errorMessage={errorMessage}
              />
            </div>
          )}
        </main>
      </div>
    );
  }

  // Fallback: Conexão Direta Standalone
  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none">
      <ConnectionModal
        onConnect={handleConnect}
        isConnecting={sessionState === 'connecting'}
        statusText={statusText}
        errorMessage={errorMessage}
      />
    </div>
  );
};
