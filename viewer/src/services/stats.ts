/**
 * Coletor e analisador de estatísticas WebRTC em tempo real.
 */

export interface WebRTCStatsSummary {
  fps: number;
  latencyMs: number;
  bitrateKbps: number;
  jitterMs: number;
  packetsLost: number;
  connectionType: 'direct' | 'relay' | 'unknown';
  resolution: string;
  bytesReceived: number;
}

export class WebRTCStatsCollector {
  private lastTimestamp: number = 0;
  private lastBytesReceived: number = 0;
  private lastFramesDecoded: number = 0;
  private intervalId: number | null = null;

  constructor(
    private pc: RTCPeerConnection,
    private onStats: (stats: WebRTCStatsSummary) => void,
    private intervalMs: number = 1000
  ) {}

  public start() {
    if (this.intervalId !== null) return;
    this.intervalId = window.setInterval(() => this.collect(), this.intervalMs);
  }

  public stop() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async collect(): Promise<void> {
    if (!this.pc || this.pc.connectionState === 'closed') {
      this.stop();
      return;
    }

    try {
      const stats = await this.pc.getStats();
      const now = performance.now();
      const timeDeltaSec = (now - this.lastTimestamp) / 1000;

      let fps = 0;
      let latencyMs = 0;
      let bitrateKbps = 0;
      let jitterMs = 0;
      let packetsLost = 0;
      let connectionType: 'direct' | 'relay' | 'unknown' = 'unknown';
      let resolution = '--';
      let currentBytes = 0;

      stats.forEach((report) => {
        // Video Inbound RTP
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          currentBytes = report.bytesReceived || 0;
          const framesDecoded = report.framesDecoded || 0;
          packetsLost = report.packetsLost || 0;
          jitterMs = Math.round((report.jitter || 0) * 1000);

          if (report.frameWidth && report.frameHeight) {
            resolution = `${report.frameWidth}x${report.frameHeight}`;
          }

          if (timeDeltaSec > 0 && this.lastTimestamp > 0) {
            const bytesDelta = currentBytes - this.lastBytesReceived;
            bitrateKbps = Math.round((bytesDelta * 8) / (timeDeltaSec * 1000));

            const framesDelta = framesDecoded - this.lastFramesDecoded;
            fps = Math.round(framesDelta / timeDeltaSec);
          }

          this.lastBytesReceived = currentBytes;
          this.lastFramesDecoded = framesDecoded;
        }

        // Candidate Pair (RTT & Connection Type)
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.selected) {
          if (report.currentRoundTripTime !== undefined) {
            latencyMs = Math.round(report.currentRoundTripTime * 1000);
          }

          // Descobre se é relay (TURN) ou direto (P2P STUN/Host)
          const remoteCandidate = stats.get(report.remoteCandidateId);
          const localCandidate = stats.get(report.localCandidateId);
          if (
            (remoteCandidate && remoteCandidate.candidateType === 'relay') ||
            (localCandidate && localCandidate.candidateType === 'relay')
          ) {
            connectionType = 'relay';
          } else if (remoteCandidate || localCandidate) {
            connectionType = 'direct';
          }
        }
      });

      this.lastTimestamp = now;

      this.onStats({
        fps: Math.max(0, fps),
        latencyMs,
        bitrateKbps: Math.max(0, bitrateKbps),
        jitterMs,
        packetsLost,
        connectionType,
        resolution,
        bytesReceived: currentBytes,
      });
    } catch {
      // Ignora erro se PeerConnection foi encerrada durante getStats
    }
  }
}
