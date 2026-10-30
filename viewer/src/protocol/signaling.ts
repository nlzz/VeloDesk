/**
 * Tipos de Mensagem do Protocolo de Sinalização VeloDesk (WebSocket).
 */

export interface TURNCredentials {
  username: string;
  credential: string;
  ttl: number;
  uris: string[];
}

export interface ConnectRequestMessage {
  type: 'connect_request';
  target_id: string;
  password_hash?: string;
  operator_info?: string;
}

export interface ConnectAckMessage {
  type: 'connect_ack';
  session_id: string;
  target_id: string;
  turn_credentials?: TURNCredentials;
}

export interface ConnectErrorMessage {
  type: 'connect_error';
  message: string;
}

export interface WebRTCOfferMessage {
  type: 'webrtc_offer';
  session_id: string;
  sdp: string;
}

export interface WebRTCAnswerMessage {
  type: 'webrtc_answer';
  session_id: string;
  sdp: string;
}

export interface ICECandidateMessage {
  type: 'ice_candidate';
  session_id: string;
  candidate: RTCIceCandidateInit;
}

export interface DisconnectMessage {
  type: 'disconnect';
  session_id: string;
  reason?: string;
}

export interface HeartbeatMessage {
  type: 'ping' | 'pong';
}

export type SignalingMessage =
  | ConnectRequestMessage
  | ConnectAckMessage
  | ConnectErrorMessage
  | WebRTCOfferMessage
  | WebRTCAnswerMessage
  | ICECandidateMessage
  | DisconnectMessage
  | HeartbeatMessage;
