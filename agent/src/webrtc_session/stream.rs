//! Loop de captura, codificação e transmissão de vídeo H.264 em tempo real.

use crate::capture::ScreenCapturer;
use crate::encoder::VideoEncoder;
use bytes::BytesMut;
use rtc::media::Sample;
use rtc::rtp_transceiver::PayloadType;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample;
use webrtc::media_stream::Track;
use webrtc::rtp_transceiver::RtpSender;

/// Gerencia a transmissão contínua de quadros de vídeo na sessão WebRTC
pub struct VideoStreamer;

impl VideoStreamer {
    /// Inicia o loop de streaming em uma tarefa assíncrona do Tokio
    pub fn spawn(
        track: Arc<TrackLocalStaticSample>,
        sender: Arc<dyn RtpSender>,
        capturer: Arc<Mutex<Box<dyn ScreenCapturer>>>,
        encoder: Arc<Mutex<Box<dyn VideoEncoder>>>,
        fps: u32,
        is_running: Arc<AtomicBool>,
    ) {
        tokio::spawn(async move {
            let frame_duration = Duration::from_millis(1000 / fps.max(1) as u64);
            let mut interval = tokio::time::interval(frame_duration);

            let ssrc = match track.ssrcs().await.first().copied() {
                Some(s) => s,
                None => {
                    log::error!("[Streamer] Nenhum SSRC disponível na trilha de vídeo");
                    return;
                }
            };

            let payload_type = match Self::get_payload_type(&sender).await {
                Ok(pt) => pt,
                Err(e) => {
                    log::warn!("[Streamer] Usando payload type padrão 102 (detecção falhou: {e})");
                    102
                }
            };

            log::info!(
                "[Streamer] Iniciando streaming de vídeo H.264 a {} FPS (SSRC: {}, PT: {})",
                fps,
                ssrc,
                payload_type
            );

            while is_running.load(Ordering::Relaxed) {
                interval.tick().await;

                // 1. Captura de tela
                let frame_opt = {
                    let mut cap = capturer.lock().await;
                    cap.capture()
                };

                let frame = match frame_opt {
                    Ok(Some(f)) => f,
                    Ok(None) => continue, // Nenhuma alteração de tela ou frame ignorado
                    Err(e) => {
                        log::debug!("[Streamer] Erro ao capturar frame: {e}");
                        continue;
                    }
                };

                // 2. Codificação H.264 MFT
                let nalus = {
                    let mut enc = encoder.lock().await;
                    match enc.encode(&frame) {
                        Ok(n) => n,
                        Err(e) => {
                            log::debug!("[Streamer] Erro na codificação do frame: {e}");
                            continue;
                        }
                    }
                };

                if nalus.is_empty() {
                    continue;
                }

                // 3. Monta o pacote Annex B agregando NALUs
                let mut packet_data = BytesMut::new();
                for nalu in nalus {
                    // Start code Annex B de 4 bytes
                    packet_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
                    packet_data.extend_from_slice(&nalu.data);
                }

                // 4. Envia o sample para o WebRTC
                let sample = Sample {
                    data: packet_data.into(),
                    duration: frame_duration,
                    ..Sample::new(Instant::now())
                };

                if let Err(e) = track
                    .sample_writer(ssrc, payload_type)
                    .write_sample(&sample)
                    .await
                {
                    log::debug!("[Streamer] Falha ao escrever sample na trilha de vídeo: {e}");
                }
            }

            log::info!("[Streamer] Loop de streaming de vídeo finalizado");
        });
    }

    /// Resolve o PayloadType negociado para o sender da trilha de vídeo
    async fn get_payload_type(sender: &Arc<dyn RtpSender>) -> anyhow::Result<PayloadType> {
        let params = sender.get_parameters().await?;
        if let Some(codec) = params.rtp_parameters.codecs.first() {
            Ok(codec.payload_type)
        } else {
            anyhow::bail!("Nenhum codec negociado encontrado para a trilha de vídeo");
        }
    }
}
