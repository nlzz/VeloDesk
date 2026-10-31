import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TenantNavbar, DashboardTab } from './TenantNavbar';
import { DevicesView } from './DevicesView';
import { HelpdeskView } from './HelpdeskView';
import { AuditView } from './AuditView';
import { ConnectionModal } from '../ConnectionModal';
import { RemoteSession } from '../RemoteSession';
import { InSessionChat, ChatMessage } from '../InSessionChat';
import { FileTransferModal } from '../FileTransferModal';
import { SignalingClient } from '../../services/signaling';
import { WebRTCClient } from '../../services/webrtc';
import { InputMessage } from '../../protocol/input';
import { WebRTCStatsSummary } from '../../services/stats';
import {
  api,
  TenantInfo,
  UserInfo,
  RemoteDevice,
  DeviceGroup,
  DeviceTag,
  HelpdeskTicket,
} from '../../services/api';

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

interface OfficeDashboardProps {
  defaultTab?: DashboardTab;
}

export const OfficeDashboard: React.FC<OfficeDashboardProps> = ({ defaultTab = 'devices' }) => {
  const navigate = useNavigate();

  // Estados de Autenticação e Entidades
  const [tenant, setTenant] = useState<TenantInfo | null>(api.getTenant());
  const [user, setUser] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>(defaultTab);

  // Dados do Escritório
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [tags, setTags] = useState<DeviceTag[]>([]);
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);

  // Sessão WebRTC & Viewer Integrado
  const [sessionState, setSessionState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [targetId, setTargetId] = useState('');
  const [statusText, setStatusText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<WebRTCStatsSummary | null>(null);

  // Ferramentas em Sessão (Chat & Transferência de Arquivos)
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isFileTransferOpen, setIsFileTransferOpen] = useState(false);
  const [sessionChatMessages, setSessionChatMessages] = useState<ChatMessage[]>([]);

  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRTCClient | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // Carrega informações do usuário autenticado e tenant
  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        setUser(res.user);
        if (res.tenant) {
          setTenant(res.tenant);
        } else if (!tenant) {
          // Se for superadmin sem tenant fixo
          setTenant({
            id: 'global',
            name: 'VeloDesk Global',
            slug: 'global',
            logo_url: '',
            primary_color: '#2563EB',
            max_devices: 1000,
          });
        }
      })
      .catch((err) => {
        console.warn('[Dashboard] Erro ao carregar usuário atual:', err);
        api.logout();
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  // Carrega Dispositivos, Grupos e Tickets do Tenant
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
      console.error('[Dashboard] Erro ao carregar dados do tenant:', err);
    } finally {
      setIsLoadingDashboard(false);
    }
  }, []);

  useEffect(() => {
    if (api.getToken()) {
      loadDashboardData();
    }
  }, [loadDashboardData]);

  // Inicializa clientes de Sinalização e WebRTC
  useEffect(() => {
    const signaling = new SignalingClient({
      onConnectAck: async (ack) => {
        console.log('[Dashboard] Sessão autorizada pelo Host. SessionID:', ack.session_id);
        currentSessionIdRef.current = ack.session_id;
        setStatusText('Host localizado. Negociando stream H.264...');

        if (webrtcRef.current) {
          await webrtcRef.current.initializePeerConnection(ack.session_id, ack.turn_credentials);
        }
      },
      onConnectError: (err) => {
        console.warn('[Dashboard] Erro na conexão:', err.message);
        setErrorMessage(err.message);
        disconnectSession();
      },
      onWebRTCOffer: async (offer) => {
        setStatusText('Conectando via túnel WebRTC seguro...');
        if (webrtcRef.current) {
          try {
            await webrtcRef.current.handleRemoteOffer(offer.session_id, offer.sdp);
          } catch (e) {
            console.error('[Dashboard] Falha ao processar oferta SDP:', e);
            setErrorMessage('Falha na negociação WebRTC com o host.');
            disconnectSession();
          }
        }
      },
      onIceCandidate: async (candidate) => {
        if (webrtcRef.current) {
          await webrtcRef.current.addIceCandidate(candidate.candidate);
        }
      },
      onDisconnect: (msg) => {
        setErrorMessage(`Sessão finalizada pelo host: ${msg.reason || 'Desconectado'}`);
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
      onStats: (newStats) => {
        setStats(newStats);
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
        console.log(`[Dashboard] DataChannel ${channel} estado:`, state);
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

  // [ Conectar ] Dispara a conexão para o Agent ID informado
  const handleConnect = async (agentId: string, password?: string, overrideUrl?: string) => {
    setErrorMessage(null);
    setTargetId(agentId);
    setSessionState('connecting');
    setStatusText('Conectando ao servidor de sinalização...');

    const token = api.getToken() || '';
    const baseWs =
      window.location.protocol === 'https:'
        ? `wss://${window.location.host}/ws`
        : `ws://${window.location.host}/ws`;
    const targetWsUrl = overrideUrl || `${baseWs}?token=${encodeURIComponent(token)}`;

    try {
      const signaling = signalingRef.current;
      if (!signaling) return;

      await signaling.connect(targetWsUrl);
      setStatusText(`Solicitando controle remoto ao Host ${agentId}...`);

      const passHash = password ? await calculateSha256(password) : undefined;
      signaling.sendConnectRequest(agentId, passHash, user?.name || 'Técnico VeloDesk');
    } catch (err) {
      console.error('[Dashboard] Falha ao iniciar conexão:', err);
      setErrorMessage('Falha ao conectar no servidor. Verifique a rede e o token.');
      setSessionState('idle');
    }
  };

  // Encerramento da Sessão
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

  // Handlers de Input e Teclado
  const handleSendInput = useCallback((input: InputMessage) => {
    if (webrtcRef.current) {
      webrtcRef.current.sendInput(input);
    }
  }, []);

  const handleSendShortcut = useCallback((shortcut: string) => {
    if (webrtcRef.current) {
      webrtcRef.current.sendSpecialShortcut(shortcut as any);
    }
  }, []);

  // Chat em Sessão
  const handleSendChatMessage = (text: string) => {
    const newMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: 'tech',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setSessionChatMessages((prev) => [...prev, newMsg]);
    if (webrtcRef.current) {
      webrtcRef.current.sendControl({ type: 'chat', text });
    }
  };

  // Transferência de Arquivo
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
    navigate('/login', { replace: true });
  };

  // =========================================================================
  // VIEW: SESSÃO REMOTA CONECTADA EM TELA CHEIA (VIEWER INTEGRADO)
  // =========================================================================
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

  // =========================================================================
  // VIEW: ESTADO DE CONEXÃO EM ANDAMENTO
  // =========================================================================
  if (sessionState === 'connecting') {
    return (
      <div className="w-screen h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <h2 className="text-base font-bold text-slate-100">Iniciando Controle Remoto</h2>
          <p className="text-xs text-slate-400 font-mono">{statusText || `Conectando ao Host ${targetId}...`}</p>
          <button
            type="button"
            onClick={disconnectSession}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
          >
            Cancelar Conexão
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW: PAINEL DO ESCRITÓRIO (DASHBOARD)
  // =========================================================================
  const pendingTickets = tickets.filter((t) => t.status === 'PENDING').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col select-none">
      {tenant && (
        <TenantNavbar
          tenant={tenant}
          user={user || { id: '', name: 'Técnico Autorizado', email: '', role: 'TECHNICIAN' }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onLogout={handleLogout}
          pendingTicketsCount={pendingTickets}
        />
      )}

      {errorMessage && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between text-xs text-rose-300">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-rose-200 text-xs font-bold px-2 py-0.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* Aba de Computadores Cadastrados */}
        {activeTab === 'devices' && (
          <DevicesView
            devices={devices}
            groups={groups}
            tags={tags}
            onConnect={(agentId) => handleConnect(agentId)}
            isLoading={isLoadingDashboard}
          />
        )}

        {/* Aba de Chamados / Helpdesk */}
        {activeTab === 'helpdesk' && (
          <HelpdeskView
            tickets={tickets}
            onConnectToTicket={(agentId) => handleConnect(agentId)}
            onRefresh={loadDashboardData}
            currentTechName={user?.name || 'Técnico'}
          />
        )}

        {/* Aba de Auditoria Criptográfica */}
        {activeTab === 'audit' && <AuditView />}

        {/* Aba de Conexão Direta Standalone */}
        {activeTab === 'direct' && (
          <div className="max-w-md mx-auto pt-8">
            <ConnectionModal
              onConnect={handleConnect}
              isConnecting={false}
              statusText={statusText}
              errorMessage={errorMessage}
            />
          </div>
        )}
      </main>
    </div>
  );
};
