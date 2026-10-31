/**
 * Gerenciador WebRTC do Operador VeloDesk.
 * 
 * Cuida do ciclo de vida da RTCPeerConnection, STUN/TURN, Data Channels de baixa
 * latência e recepção da MediaStreamTrack acelerada por hardware.
 */

import { TURNCredentials } from '../protocol/signaling';
import {
  InputMessage,
  createKeyDownMessage,
  createKeyUpMessage,
  serializeInputMessage,
} from '../protocol/input';
import { WebRTCStatsCollector, WebRTCStatsSummary } from './stats';
import { SignalingClient } from './signaling';

export interface WebRTCEvents {
  onStream: (stream: MediaStream) => void;
  onStats: (stats: WebRTCStatsSummary) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onDataChannelStateChange: (channel: 'input' | 'control', state: RTCDataChannelState) => void;
  onError: (error: Error) => void;
}

export class WebRTCClient {
  private pc: RTCPeerConnection | null = null;
  private inputChannel: RTCDataChannel | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private statsCollector: WebRTCStatsCollector | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private currentSessionId: string | null = null;
  private mediaStream: MediaStream | null = null;

  // Throttling de movimento do mouse (60-120 Hz)
  private pendingMouseMoveMsg: InputMessage | null = null;
  private rafId: number | null = null;

  constructor(
    private signaling: SignalingClient,
    private events: WebRTCEvents
  ) {}

  public get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  public get stream(): MediaStream | null {
    return this.mediaStream;
  }

  public get isInputReady(): boolean {
    return this.inputChannel !== null && this.inputChannel.readyState === 'open';
  }

  /**
   * Inicializa a RTCPeerConnection configurada com os servidores STUN/TURN fornecidos pela sinalização.
   */
  public initializePeerConnection(sessionId: string, turnCreds?: TURNCredentials): RTCPeerConnection {
    this.close();
    this.currentSessionId = sessionId;

    const iceServers: RTCIceServer[] = [];

    if (turnCreds && turnCreds.uris && turnCreds.uris.length > 0) {
      iceServers.push({
        urls: turnCreds.uris,
        username: turnCreds.username,
        credential: turnCreds.credential,
      });
    } else {
      // Fallback para STUN público se nada fornecido
      iceServers.push({
        urls: ['stun:stun.l.google.com:19302', 'stun:turn.velodesk.local:3478'],
      });
    }

    const config: RTCConfiguration = {
      iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };

    const pc = new RTCPeerConnection(config);
    this.pc = pc;

    // Monitora candidatos ICE locais para enviar ao Host
    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentSessionId) {
        this.signaling.sendIceCandidate(this.currentSessionId, event.candidate.toJSON());
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE Connection State:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection State:', pc.connectionState);
      this.events.onConnectionStateChange(pc.connectionState);
      if (pc.connectionState === 'connected') {
        this.startStats();
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.stopStats();
      }
    };

    // Recebe a trilha de vídeo H.264 do Host
    pc.ontrack = (event) => {
      console.log('[WebRTC] Trilha de vídeo remota recebida:', event.track.kind);
      if (event.track.kind === 'video') {
        let stream = event.streams[0];
        if (!stream) {
          stream = new MediaStream([event.track]);
        }
        this.mediaStream = stream;
        this.events.onStream(stream);
      }
    };

    // Escuta canais de dados criados pelo Host
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      console.log('[WebRTC] DataChannel remoto recebido:', channel.label);
      this.setupDataChannel(channel);
    };

    // Pre-cria os canais caso a sinalização negocie canais locais
    try {
      const inputInit: RTCDataChannelInit = {
        ordered: false,
        maxRetransmits: 0,
      };
      const inputDc = pc.createDataChannel('velodesk-input', inputInit);
      this.setupDataChannel(inputDc);

      const controlInit: RTCDataChannelInit = {
        ordered: true,
      };
      const controlDc = pc.createDataChannel('velodesk-control', controlInit);
      this.setupDataChannel(controlDc);
    } catch (err) {
      console.warn('[WebRTC] Aviso ao pré-criar DataChannels:', err);
    }

    return pc;
  }

  private setupDataChannel(channel: RTCDataChannel) {
    if (channel.label === 'velodesk-input') {
      this.inputChannel = channel;
      channel.onopen = () => this.events.onDataChannelStateChange('input', channel.readyState);
      channel.onclose = () => this.events.onDataChannelStateChange('input', channel.readyState);
      channel.onerror = (e) => console.warn('[WebRTC] Erro no DataChannel input:', e);
    } else if (channel.label === 'velodesk-control') {
      this.controlChannel = channel;
      channel.onopen = () => this.events.onDataChannelStateChange('control', channel.readyState);
      channel.onclose = () => this.events.onDataChannelStateChange('control', channel.readyState);
      channel.onmessage = (e) => console.log('[WebRTC] Mensagem de controle recebida:', e.data);
    }
  }

  /**
   * Processa a Oferta SDP (webrtc_offer) enviada pelo Host e gera a Resposta (webrtc_answer).
   */
  public async handleRemoteOffer(sessionId: string, sdp: string): Promise<void> {
    if (!this.pc) {
      throw new Error('PeerConnection não inicializada antes da oferta SDP');
    }

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      console.log('[WebRTC] Descrição remota (Offer) aplicada com sucesso');

      // Aplica candidatos ICE que chegaram antes da Offer ser configurada
      while (this.pendingCandidates.length > 0) {
        const candidate = this.pendingCandidates.shift();
        if (candidate) {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }

      // Gera resposta SDP
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('[WebRTC] Descrição local (Answer) gerada e aplicada');

      if (answer.sdp) {
        this.signaling.sendAnswer(sessionId, answer.sdp);
      }
    } catch (err) {
      this.events.onError(err as Error);
      throw err;
    }
  }

  /**
   * Adiciona um candidato ICE recebido do Host.
   */
  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] Falha ao adicionar candidato ICE:', err);
    }
  }

  /**
   * Despacha uma mensagem de input via Data Channel velodesk-input.
   */
  public sendInput(msg: InputMessage): void {
    if (!this.inputChannel || this.inputChannel.readyState !== 'open') {
      return;
    }

    // Para movimento contínuo do mouse, agrupa e despacha no rAF para otimizar throughput
    if (msg.t === 'mm') {
      this.pendingMouseMoveMsg = msg;
      if (this.rafId === null) {
        this.rafId = requestAnimationFrame(() => {
          if (this.pendingMouseMoveMsg && this.inputChannel && this.inputChannel.readyState === 'open') {
            this.inputChannel.send(serializeInputMessage(this.pendingMouseMoveMsg));
          }
          this.pendingMouseMoveMsg = null;
          this.rafId = null;
        });
      }
      return;
    }

    // Cliques e Teclado são enviados imediatamente sem atraso
    try {
      this.inputChannel.send(serializeInputMessage(msg));
    } catch (err) {
      console.warn('[WebRTC] Erro ao enviar input via DataChannel:', err);
    }
  }

  /**
   * Envia mensagem arbitrária de controle (chat, transferência de arquivo) pelo canal velodesk-control.
   */
  public sendControl(data: any): void {
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      try {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        this.controlChannel.send(payload);
      } catch (err) {
        console.warn('[WebRTC] Erro ao enviar mensagem de controle:', err);
      }
    }
  }

  /**
   * Envia comando de controle ou atalho especial do sistema.
   */
  public sendSpecialShortcut(
    shortcut: 'ctrl_alt_del' | 'win_d' | 'ctrl_shift_esc' | 'alt_tab' | 'win_l'
  ): void {
    // Envia comando formal pelo canal velodesk-control
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      this.controlChannel.send(
        JSON.stringify({
          action: 'system_shortcut',
          shortcut,
        })
      );
    }

    // Envia sequência correspondente pelo canal velodesk-input como fallback
    if (shortcut === 'win_d') {
      this.sendInput(createKeyDownMessage('MetaLeft', 0x5b));
      this.sendInput(createKeyDownMessage('KeyD', 0x44));
      setTimeout(() => {
        this.sendInput(createKeyUpMessage('KeyD', 0x44));
        this.sendInput(createKeyUpMessage('MetaLeft', 0x5b));
      }, 50);
    } else if (shortcut === 'ctrl_shift_esc') {
      this.sendInput(createKeyDownMessage('ControlLeft', 0x11));
      this.sendInput(createKeyDownMessage('ShiftLeft', 0x10));
      this.sendInput(createKeyDownMessage('Escape', 0x1b));
      setTimeout(() => {
        this.sendInput(createKeyUpMessage('Escape', 0x1b));
        this.sendInput(createKeyUpMessage('ShiftLeft', 0x10));
        this.sendInput(createKeyUpMessage('ControlLeft', 0x11));
      }, 50);
    } else if (shortcut === 'alt_tab') {
      this.sendInput(createKeyDownMessage('AltLeft', 0x12));
      this.sendInput(createKeyDownMessage('Tab', 0x09));
      setTimeout(() => {
        this.sendInput(createKeyUpMessage('Tab', 0x09));
        this.sendInput(createKeyUpMessage('AltLeft', 0x12));
      }, 50);
    }
  }

  private startStats() {
    if (!this.pc) return;
    this.stopStats();
    this.statsCollector = new WebRTCStatsCollector(this.pc, (stats) => {
      this.events.onStats(stats);
    });
    this.statsCollector.start();
  }

  private stopStats() {
    if (this.statsCollector) {
      this.statsCollector.stop();
      this.statsCollector = null;
    }
  }

  /**
   * Finaliza e limpa completamente a conexão WebRTC.
   */
  public close(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopStats();

    if (this.inputChannel) {
      this.inputChannel.close();
      this.inputChannel = null;
    }

    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }

    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }

    this.mediaStream = null;
    this.pendingCandidates = [];
    this.currentSessionId = null;
  }
}
