/**
 * Cliente de Sinalização WebSocket para o VeloDesk Server.
 */

import {
  ConnectAckMessage,
  ConnectErrorMessage,
  DisconnectMessage,
  ICECandidateMessage,
  SignalingMessage,
  WebRTCOfferMessage,
} from '../protocol/signaling';

export type SignalingStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SignalingEvents {
  onStatusChange?: (status: SignalingStatus) => void;
  onConnectAck?: (msg: ConnectAckMessage) => void;
  onConnectError?: (msg: ConnectErrorMessage) => void;
  onWebRTCOffer?: (msg: WebRTCOfferMessage) => void;
  onIceCandidate?: (msg: ICECandidateMessage) => void;
  onDisconnect?: (msg: DisconnectMessage) => void;
  onError?: (err: Event | Error) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private pingIntervalId: number | null = null;
  private currentStatus: SignalingStatus = 'disconnected';

  constructor(private events: SignalingEvents = {}) {}

  public get status(): SignalingStatus {
    return this.currentStatus;
  }

  private setStatus(status: SignalingStatus) {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.events.onStatusChange?.(status);
    }
  }

  /**
   * Conecta ao servidor de sinalização WebSocket.
   */
  public connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.setStatus('connecting');

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this.setStatus('error');
        this.events.onError?.(err as Error);
        return reject(err);
      }

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage;
          this.handleIncomingMessage(msg);
        } catch (err) {
          console.warn('[Signaling] Falha ao processar mensagem JSON:', event.data, err);
        }
      };

      this.ws.onerror = (event) => {
        this.setStatus('error');
        this.events.onError?.(event);
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.setStatus('disconnected');
      };
    });
  }

  /**
   * Envia requisição de conexão para o host remoto via seu ID de 9 dígitos.
   */
  public sendConnectRequest(targetId: string, passwordHash?: string, operatorInfo?: string) {
    this.send({
      type: 'connect_request',
      target_id: targetId,
      password_hash: passwordHash,
      operator_info: operatorInfo || 'VeloDesk Operator',
    });
  }

  /**
   * Envia a resposta SDP (Answer) gerada pelo PeerConnection.
   */
  public sendAnswer(sessionId: string, sdp: string) {
    this.send({
      type: 'webrtc_answer',
      session_id: sessionId,
      sdp,
    });
  }

  /**
   * Envia um candidato ICE descoberto localmente.
   */
  public sendIceCandidate(sessionId: string, candidate: RTCIceCandidateInit) {
    this.send({
      type: 'ice_candidate',
      session_id: sessionId,
      candidate,
    });
  }

  /**
   * Envia notificação de desconexão.
   */
  public sendDisconnect(sessionId: string, reason: string = 'user_closed') {
    this.send({
      type: 'disconnect',
      session_id: sessionId,
      reason,
    });
  }

  private send(data: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleIncomingMessage(msg: SignalingMessage) {
    switch (msg.type) {
      case 'connect_ack':
        this.events.onConnectAck?.(msg);
        break;
      case 'connect_error':
        this.events.onConnectError?.(msg);
        break;
      case 'webrtc_offer':
        this.events.onWebRTCOffer?.(msg);
        break;
      case 'ice_candidate':
        this.events.onIceCandidate?.(msg);
        break;
      case 'disconnect':
        this.events.onDisconnect?.(msg);
        break;
      case 'pong':
        // Heartbeat mantido com sucesso
        break;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingIntervalId = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.pingIntervalId !== null) {
      window.clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  public disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
