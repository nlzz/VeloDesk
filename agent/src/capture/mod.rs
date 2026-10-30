//! Módulo unificado de captura de tela acelerada por GPU.
//!
//! Implementa a estratégia com prioridade 1 em Windows Graphics Capture (WGC)
//! e fallback automático para DXGI Desktop Duplication API.

pub mod d3d11;
pub mod dxgi;
pub mod wgc;
pub mod win32_interop;

use d3d11::D3D11Context;
use dxgi::DxgiCapturer;
use thiserror::Error;
use wgc::WgcCapturer;
use win32_interop::get_screen_dimensions;

/// Erros gerais no pipeline de captura
#[derive(Debug, Error)]
pub enum CaptureError {
    /// Falha no subsistema Direct3D 11
    #[error("Erro D3D11: {0}")]
    D3D11(#[from] d3d11::D3D11Error),
    /// Falha no módulo DXGI
    #[error("Erro DXGI: {0}")]
    Dxgi(#[from] dxgi::DxgiCaptureError),
    /// Falha no módulo WGC
    #[error("Erro WGC: {0}")]
    Wgc(#[from] wgc::WgcCaptureError),
    /// Nenhum backend de captura disponível no ambiente atual
    #[error("Nenhum backend de captura suportado")]
    NoBackendAvailable,
}

/// Representa um frame de vídeo bruto em memória
#[derive(Debug, Clone)]
pub struct RawFrame {
    /// Largura do frame em pixels
    pub width: u32,
    /// Altura do frame em pixels
    pub height: u32,
    /// Linha de varredura (stride/pitch em bytes)
    pub stride: u32,
    /// Dados BGRA brutos
    pub data: Vec<u8>,
}

/// Contrato para subsistemas de captura de tela
pub trait ScreenCapturer: Send {
    /// Captura o próximo frame disponível
    fn capture(&mut self) -> Result<Option<RawFrame>, CaptureError>;
    /// Retorna a resolução nativa da captura
    fn resolution(&self) -> (u32, u32);
}

/// Capturador automático com fallback inteligente (WGC -> DXGI -> Simulação Sintética)
pub struct AutoCapturer {
    wgc: Option<WgcCapturer>,
    dxgi: Option<DxgiCapturer>,
    d3d11: D3D11Context,
    width: u32,
    height: u32,
    mock_mode: bool,
    synthetic_counter: u64,
}

impl AutoCapturer {
    /// Instancia o capturador automático escolhendo o melhor backend disponível
    pub fn new() -> Result<Self, CaptureError> {
        let dims = get_screen_dimensions();
        let d3d11 = D3D11Context::new()?;

        let mut wgc_capturer = None;
        if WgcCapturer::is_supported() {
            if let Ok(cap) = WgcCapturer::new(d3d11.clone(), dims.width, dims.height) {
                wgc_capturer = Some(cap);
            }
        }

        let mut dxgi_capturer = None;
        if wgc_capturer.is_none() {
            if let Ok(cap) = DxgiCapturer::new(d3d11.clone()) {
                dxgi_capturer = Some(cap);
            }
        }

        let mock_mode = wgc_capturer.is_none() && dxgi_capturer.is_none();

        Ok(Self {
            wgc: wgc_capturer,
            dxgi: dxgi_capturer,
            d3d11,
            width: dims.width,
            height: dims.height,
            mock_mode,
            synthetic_counter: 0,
        })
    }

    /// Força o modo de captura sintética (útil para testes isolados)
    pub fn new_mock(width: u32, height: u32) -> Result<Self, CaptureError> {
        let d3d11 = D3D11Context::new()?;
        Ok(Self {
            wgc: None,
            dxgi: None,
            d3d11,
            width,
            height,
            mock_mode: true,
            synthetic_counter: 0,
        })
    }

    /// Gera um frame sintético quando não há monitor físico ativo
    fn generate_synthetic_frame(&mut self) -> RawFrame {
        self.synthetic_counter = self.synthetic_counter.wrapping_add(1);
        let color = ((self.synthetic_counter % 255) as u8).max(30);

        let stride = self.width * 4;
        let total_size = (stride * self.height) as usize;
        let mut data = vec![0u8; total_size];

        // Preenche com padrão gradiente BGRA
        for y in 0..self.height {
            for x in 0..self.width {
                let idx = ((y * stride) + (x * 4)) as usize;
                data[idx] = color; // B
                data[idx + 1] = ((x * 255) / self.width) as u8; // G
                data[idx + 2] = ((y * 255) / self.height) as u8; // R
                data[idx + 3] = 255; // A
            }
        }

        RawFrame {
            width: self.width,
            height: self.height,
            stride,
            data,
        }
    }
}

impl ScreenCapturer for AutoCapturer {
    fn capture(&mut self) -> Result<Option<RawFrame>, CaptureError> {
        if self.mock_mode {
            return Ok(Some(self.generate_synthetic_frame()));
        }

        if let Some(wgc) = &mut self.wgc {
            if let Ok(Some(tex)) = wgc.capture_frame() {
                let frame = self
                    .d3d11
                    .read_staging_texture(&tex, |bytes, stride| RawFrame {
                        width: self.width,
                        height: self.height,
                        stride,
                        data: bytes.to_vec(),
                    })?;
                return Ok(Some(frame));
            }
        }

        if let Some(dxgi) = &mut self.dxgi {
            if let Ok(Some(tex)) = dxgi.capture_frame(16) {
                let frame = self
                    .d3d11
                    .read_staging_texture(&tex, |bytes, stride| RawFrame {
                        width: self.width,
                        height: self.height,
                        stride,
                        data: bytes.to_vec(),
                    })?;
                return Ok(Some(frame));
            }
        }

        Ok(None)
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_capturer_creation() {
        let capturer = AutoCapturer::new();
        assert!(
            capturer.is_ok(),
            "AutoCapturer creation failed: {:?}",
            capturer.err()
        );
    }

    #[test]
    fn test_mock_capturer_frame() {
        let mut capturer = AutoCapturer::new_mock(640, 480).expect("mock creation failed");
        let frame = capturer.capture().expect("capture failed");
        assert!(frame.is_some());
        let f = frame.unwrap();
        assert_eq!(f.width, 640);
        assert_eq!(f.height, 480);
        assert_eq!(f.data.len(), 640 * 480 * 4);
    }
}
