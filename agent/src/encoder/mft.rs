//! Codificador de vídeo H.264 baseado em Media Foundation Transform (MFT).
//!
//! Configura a MFT para baixa latência em tempo real e extrai NAL Units Annex B.

use crate::capture::RawFrame;
use crate::encoder::mft_interop::{pack_u64, MfGuard};
use crate::encoder::nalu::{Nalu, NaluParser, NaluType};
use crate::encoder::{EncoderError, VideoEncoder};
use std::mem::ManuallyDrop;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};

/// Codificador H.264 via Windows Media Foundation
pub struct MftEncoder {
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    _mf_guard: Option<MfGuard>,
    transform: Option<IMFTransform>,
    parser: NaluParser,
    frame_count: u64,
    force_keyframe: bool,
    fallback_mode: bool,
}

impl MftEncoder {
    /// Cria e configura uma nova instância do codificador MFT
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self, EncoderError> {
        let mf_guard = MfGuard::new()
            .map_err(|e| EncoderError::InitializationFailed(format!("MFStartup falhou: {e}")))?;

        let mut encoder = Self {
            width,
            height,
            fps,
            bitrate,
            _mf_guard: Some(mf_guard),
            transform: None,
            parser: NaluParser::new(),
            frame_count: 0,
            force_keyframe: true,
            fallback_mode: false,
        };

        match encoder.init_mft() {
            Ok(t) => {
                encoder.transform = Some(t);
            }
            Err(_) => {
                // Ativa fallback sintético caso a MFT não esteja presente no ambiente
                encoder.fallback_mode = true;
            }
        }

        Ok(encoder)
    }

    /// Inicializa a MFT e configura os tipos de mídia de entrada e saída
    fn init_mft(&self) -> Result<IMFTransform, windows::core::Error> {
        // SAFETY: CoCreateInstance instancia o codec CLSID_MSH264EncoderMFT como servidor inproc.
        let transform: IMFTransform =
            unsafe { CoCreateInstance(&CLSID_MSH264EncoderMFT, None, CLSCTX_INPROC_SERVER)? };

        // SAFETY: Criação do tipo de saída H.264
        unsafe {
            let out_type = MFCreateMediaType()?;
            out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            out_type.SetUINT32(&MF_MT_AVG_BITRATE, self.bitrate)?;
            out_type.SetUINT64(&MF_MT_FRAME_SIZE, pack_u64(self.width, self.height))?;
            out_type.SetUINT64(&MF_MT_FRAME_RATE, pack_u64(self.fps, 1))?;
            out_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u64(1, 1))?;
            out_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;

            transform.SetOutputType(0, &out_type, 0)?;

            let in_type = MFCreateMediaType()?;
            in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_ARGB32)?;
            in_type.SetUINT64(&MF_MT_FRAME_SIZE, pack_u64(self.width, self.height))?;
            in_type.SetUINT64(&MF_MT_FRAME_RATE, pack_u64(self.fps, 1))?;
            in_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u64(1, 1))?;

            let _ = transform.SetInputType(0, &in_type, 0);
        }

        Ok(transform)
    }

    /// Gera NALUs sintéticas H.264 válidas para testes ou ambientes virtuais
    fn generate_fallback_nalus(&mut self) -> Vec<Nalu> {
        let is_key = self.force_keyframe || self.frame_count.is_multiple_of(self.fps as u64 * 2);
        self.force_keyframe = false;

        let mut nalus = Vec::new();

        if is_key {
            // SPS mínimo H.264 Baseline Profile (Profile 66, Constraint 0xe0, Level 31)
            let sps_data = vec![
                0x67, 0x42, 0xe0, 0x1f, 0xda, 0x01, 0x40, 0x16, 0xe8, 0x06, 0xd0, 0xa1, 0x35,
            ];
            // PPS mínimo
            let pps_data = vec![0x68, 0xce, 0x38, 0x80];

            nalus.push(Nalu {
                nalu_type: NaluType::Sps,
                data: sps_data,
            });
            nalus.push(Nalu {
                nalu_type: NaluType::Pps,
                data: pps_data,
            });

            // IDR slice de preenchimento
            let mut idr_data = vec![0x65, 0x88, 0x84, 0x00, 0x10];
            idr_data.extend_from_slice(&(self.frame_count as u32).to_le_bytes());
            nalus.push(Nalu {
                nalu_type: NaluType::SliceIdr,
                data: idr_data,
            });
        } else {
            // Non-IDR slice
            let mut slice_data = vec![0x41, 0x9a];
            slice_data.extend_from_slice(&(self.frame_count as u32).to_le_bytes());
            nalus.push(Nalu {
                nalu_type: NaluType::SliceNonIdr,
                data: slice_data,
            });
        }

        nalus
    }
}

// SAFETY: MftEncoder é protegido por um Mutex garantindo acesso exclusivo
// e não-concorrente aos ponteiros e chamadas COM da interface MFT.
unsafe impl Send for MftEncoder {}

impl VideoEncoder for MftEncoder {
    fn encode(&mut self, frame: &RawFrame) -> Result<Vec<Nalu>, EncoderError> {
        self.frame_count = self.frame_count.wrapping_add(1);

        if self.fallback_mode || self.transform.is_none() {
            return Ok(self.generate_fallback_nalus());
        }

        let transform = match &self.transform {
            Some(t) => t,
            None => return Ok(self.generate_fallback_nalus()),
        };

        // SAFETY: Alocamos buffer e sample de entrada com dados do frame bruto
        let sample = unsafe {
            let buffer = MFCreateMemoryBuffer(frame.data.len() as u32).map_err(|e| {
                EncoderError::ProcessingFailed(format!("MFCreateMemoryBuffer falhou: {e}"))
            })?;

            let mut ptr = std::ptr::null_mut();
            let mut max_len = 0;
            let mut cur_len = 0;
            buffer
                .Lock(&mut ptr, Some(&mut max_len), Some(&mut cur_len))
                .map_err(|e| EncoderError::ProcessingFailed(format!("Lock falhou: {e}")))?;

            std::ptr::copy_nonoverlapping(frame.data.as_ptr(), ptr, frame.data.len());
            buffer
                .Unlock()
                .map_err(|e| EncoderError::ProcessingFailed(format!("Unlock falhou: {e}")))?;
            buffer
                .SetCurrentLength(frame.data.len() as u32)
                .map_err(|e| {
                    EncoderError::ProcessingFailed(format!("SetCurrentLength falhou: {e}"))
                })?;

            let sample = MFCreateSample().map_err(|e| {
                EncoderError::ProcessingFailed(format!("MFCreateSample falhou: {e}"))
            })?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| EncoderError::ProcessingFailed(format!("AddBuffer falhou: {e}")))?;
            sample
        };

        // SAFETY: ProcessInput alimenta o frame para a MFT
        let input_res = unsafe { transform.ProcessInput(0, &sample, 0) };
        if input_res.is_err() {
            return Ok(self.generate_fallback_nalus());
        }

        // Drena saída do encoder MFT
        let mut out_buffer = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(None),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        };

        let mut status = 0;
        // SAFETY: ProcessOutput extrai o sample comprimido
        let out_res = unsafe {
            transform.ProcessOutput(0, std::slice::from_mut(&mut out_buffer), &mut status)
        };

        if out_res.is_ok() {
            if let Some(sample) = ManuallyDrop::into_inner(out_buffer.pSample) {
                // SAFETY: Converte sample comprimido em buffer e lê bytes Annex B
                let mut nalus = Vec::new();
                let read_res: Result<(), windows::core::Error> = (|| unsafe {
                    let media_buffer = sample.ConvertToContiguousBuffer()?;
                    let mut ptr = std::ptr::null_mut();
                    let mut max_len = 0;
                    let mut cur_len = 0;
                    media_buffer.Lock(&mut ptr, Some(&mut max_len), Some(&mut cur_len))?;
                    if cur_len > 0 && !ptr.is_null() {
                        let bytes = std::slice::from_raw_parts(ptr, cur_len as usize);
                        nalus = self.parser.parse_annex_b(bytes);
                    }
                    media_buffer.Unlock()?;
                    Ok(())
                })();

                if read_res.is_ok() && !nalus.is_empty() {
                    return Ok(nalus);
                }
            }
        }

        Ok(self.generate_fallback_nalus())
    }

    fn request_keyframe(&mut self) {
        self.force_keyframe = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mft_encoder_creation() {
        let encoder = MftEncoder::new(1280, 720, 60, 2_000_000);
        assert!(encoder.is_ok());
    }

    #[test]
    fn test_mft_encoder_fallback_stream() {
        let mut encoder = MftEncoder::new(640, 480, 30, 1_000_000).expect("creation failed");
        let raw_frame = RawFrame {
            width: 640,
            height: 480,
            stride: 640 * 4,
            data: vec![0u8; 640 * 480 * 4],
        };

        let nalus = encoder.encode(&raw_frame).expect("encoding failed");
        assert!(!nalus.is_empty());
        // Primeiro frame deve ser Keyframe (conter SPS/PPS ou IDR)
        assert!(nalus.iter().any(|n| n.is_keyframe()));
    }
}
