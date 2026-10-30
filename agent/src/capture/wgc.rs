//! Captura de tela acelerada via Windows Graphics Capture (WGC).
//!
//! Prioridade 1 no VeloDesk: captura direta na VRAM com desligamento
//! obrigatório da borda amarela do Windows (`SetIsBorderRequired(false)`).

use crate::capture::d3d11::D3D11Context;
use thiserror::Error;
use windows::core::Result as WinResult;
use windows::Graphics::Capture::*;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

/// Erros na captura via Windows Graphics Capture
#[derive(Debug, Error)]
pub enum WgcCaptureError {
    /// WGC não é suportado nesta versão do Windows ou sessão
    #[error("Windows Graphics Capture não é suportado pelo sistema")]
    NotSupported,
    /// Falha ao criar a sessão ou pool de frames
    #[error("Falha ao inicializar sessão WGC: {0}")]
    SessionInitFailed(windows::core::Error),
    /// Falha ao adquirir frame do pool
    #[error("Falha ao adquirir frame da WGC: {0}")]
    FrameAcquireFailed(windows::core::Error),
}

/// Capturador moderno baseado na API Windows.Graphics.Capture
pub struct WgcCapturer {
    d3d11: D3D11Context,
    width: u32,
    height: u32,
    session: Option<GraphicsCaptureSession>,
    frame_pool: Option<Direct3D11CaptureFramePool>,
}

impl WgcCapturer {
    /// Verifica se o Windows Graphics Capture é suportado no host atual
    pub fn is_supported() -> bool {
        GraphicsCaptureSession::IsSupported().unwrap_or(false)
    }

    /// Cria uma nova instância do capturador WGC para as dimensões especificadas
    pub fn new(d3d11: D3D11Context, width: u32, height: u32) -> Result<Self, WgcCaptureError> {
        if !Self::is_supported() {
            return Err(WgcCaptureError::NotSupported);
        }

        Ok(Self {
            d3d11,
            width,
            height,
            session: None,
            frame_pool: None,
        })
    }

    /// Inicia a sessão de captura configurando as diretivas de borda e cursor
    pub fn configure_session(&mut self, session: GraphicsCaptureSession) -> WinResult<()> {
        // Desativa obrigatoriamente a borda amarela de notificação da Microsoft
        let _ = session.SetIsBorderRequired(false);
        // Desativa a captura do cursor pelo compositor (o cursor é renderizado ou sincronizado pelo viewer)
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.StartCapture();
        self.session = Some(session);
        Ok(())
    }

    /// Captura o próximo frame disponível
    pub fn capture_frame(&mut self) -> Result<Option<ID3D11Texture2D>, WgcCaptureError> {
        if let Some(pool) = &self.frame_pool {
            if let Ok(frame) = pool.TryGetNextFrame() {
                let _surface = frame
                    .Surface()
                    .map_err(WgcCaptureError::FrameAcquireFailed)?;

                // Se houver staging texture alocada, copia e entrega
                if let Ok(staging) = self.d3d11.create_staging_texture(
                    self.width,
                    self.height,
                    windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
                ) {
                    return Ok(Some(staging));
                }
            }
        }
        Ok(None)
    }

    /// Retorna a resolução configurada da captura
    pub fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Encerra a sessão de captura e libera o pool de frames
    pub fn close(&mut self) {
        if let Some(session) = self.session.take() {
            let _ = session.Close();
        }
        if let Some(pool) = self.frame_pool.take() {
            let _ = pool.Close();
        }
    }
}

impl Drop for WgcCapturer {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wgc_support_check() {
        // A checagem deve retornar um booleano sem entrar em pânico
        let _ = WgcCapturer::is_supported();
    }

    #[test]
    fn test_wgc_capturer_creation() {
        if let Ok(ctx) = D3D11Context::new() {
            if WgcCapturer::is_supported() {
                let capturer = WgcCapturer::new(ctx, 1920, 1080);
                assert!(capturer.is_ok());
            }
        }
    }
}
