//! Módulo de codificação de vídeo acelerada por hardware (H.264 MFT).
//!
//! Converte frames brutos capturados na GPU/CPU em NAL Units Annex B
//! para transmissão em tempo real via WebRTC.

pub mod mft;
pub mod mft_interop;
pub mod nalu;

use crate::capture::RawFrame;
pub use mft::MftEncoder;
pub use nalu::{Nalu, NaluParser, NaluType};
use thiserror::Error;

/// Erros durante a codificação de vídeo H.264
#[derive(Debug, Error)]
pub enum EncoderError {
    /// Falha na inicialização do encoder MFT
    #[error("Falha ao inicializar o encoder Media Foundation H.264: {0}")]
    InitializationFailed(String),
    /// Falha no processamento de entrada/saída da MFT
    #[error("Erro durante processamento na MFT: {0}")]
    ProcessingFailed(String),
    /// Formato de frame incompatível
    #[error("Formato de frame incompatível ou dimensões inválidas: {0}x{1}")]
    InvalidDimensions(u32, u32),
    /// Erro de API COM / Win32
    #[error("Erro Win32 / COM: {0}")]
    Windows(#[from] windows::core::Error),
}

/// Contrato para codificadores de vídeo em tempo real
pub trait VideoEncoder: Send {
    /// Codifica um frame bruto BGRA e retorna as NAL Units geradas
    fn encode(&mut self, frame: &RawFrame) -> Result<Vec<Nalu>, EncoderError>;
    /// Solicita forçadamente um Keyframe (IDR Slice + SPS/PPS)
    fn request_keyframe(&mut self);
}
