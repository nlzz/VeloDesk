//! Capturador de tela via DXGI Desktop Duplication API (Fallback).
//!
//! Utilizado quando a API Windows Graphics Capture (WGC) não estiver disponível
//! ou em versões legadas do Windows 10.

use crate::capture::d3d11::D3D11Context;
use thiserror::Error;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D};
use windows::Win32::Graphics::Dxgi::*;

/// Erros originados na captura DXGI
#[derive(Debug, Error)]
pub enum DxgiCaptureError {
    /// Falha ao instanciar IDXGIFactory
    #[error("Falha ao criar IDXGIFactory: {0}")]
    FactoryError(windows::core::Error),
    /// Nenhum adaptador ou monitor encontrado
    #[error("Adaptador ou saída de vídeo não encontrada")]
    OutputNotFound,
    /// Falha na chamada DuplicateOutput
    #[error("DuplicateOutput falhou: {0}")]
    DuplicationFailed(windows::core::Error),
    /// Falha ao adquirir frame
    #[error("Falha na chamada AcquireNextFrame: {0}")]
    AcquireFailed(windows::core::Error),
    /// Falha ao liberar frame
    #[error("Falha na chamada ReleaseFrame: {0}")]
    ReleaseFailed(windows::core::Error),
}

/// Capturador de tela acelerado via DXGI Desktop Duplication
pub struct DxgiCapturer {
    d3d11: D3D11Context,
    duplication: Option<IDXGIOutputDuplication>,
    width: u32,
    height: u32,
}

impl DxgiCapturer {
    /// Cria uma nova instância do capturador DXGI
    pub fn new(d3d11: D3D11Context) -> Result<Self, DxgiCaptureError> {
        let (dup, width, height) = Self::init_duplication(d3d11.device())?;

        Ok(Self {
            d3d11,
            duplication: Some(dup),
            width,
            height,
        })
    }

    /// Inicializa a interface IDXGIOutputDuplication para o monitor primário
    fn init_duplication(
        device: &ID3D11Device,
    ) -> Result<(IDXGIOutputDuplication, u32, u32), DxgiCaptureError> {
        // SAFETY: CreateDXGIFactory1 é invocado de forma segura para obter a interface COM.
        let factory: IDXGIFactory1 =
            unsafe { CreateDXGIFactory1().map_err(DxgiCaptureError::FactoryError)? };

        // SAFETY: EnumAdapters1 obtém o adaptador primário index 0.
        let adapter: IDXGIAdapter1 = unsafe {
            factory
                .EnumAdapters1(0)
                .map_err(|_| DxgiCaptureError::OutputNotFound)?
        };

        // SAFETY: EnumOutputs obtém o monitor primário index 0.
        let output: IDXGIOutput = unsafe {
            adapter
                .EnumOutputs(0)
                .map_err(|_| DxgiCaptureError::OutputNotFound)?
        };

        let output1: IDXGIOutput1 = output.cast().map_err(DxgiCaptureError::FactoryError)?;

        // SAFETY: DuplicateOutput é invocado com o dispositivo Direct3D 11 ativo.
        let dup = unsafe {
            output1
                .DuplicateOutput(device)
                .map_err(DxgiCaptureError::DuplicationFailed)?
        };

        // SAFETY: GetDesc em IDXGIOutputDuplication lê as dimensões do desktop duplicado.
        let desc = unsafe { dup.GetDesc() };
        let width = if desc.ModeDesc.Width > 0 {
            desc.ModeDesc.Width
        } else {
            1920
        };
        let height = if desc.ModeDesc.Height > 0 {
            desc.ModeDesc.Height
        } else {
            1080
        };

        Ok((dup, width, height))
    }

    /// Tenta readquirir a interface caso haja perda de acesso (DXGI_ERROR_ACCESS_LOST)
    pub fn reinitialize(&mut self) -> Result<(), DxgiCaptureError> {
        self.duplication = None;
        let (dup, width, height) = Self::init_duplication(self.d3d11.device())?;
        self.duplication = Some(dup);
        self.width = width;
        self.height = height;
        Ok(())
    }

    /// Captura o próximo frame com tempo limite em milissegundos
    /// Retorna `Ok(Some(texture))` se um novo frame foi entregue, ou `Ok(None)` em caso de timeout.
    pub fn capture_frame(
        &mut self,
        timeout_ms: u32,
    ) -> Result<Option<ID3D11Texture2D>, DxgiCaptureError> {
        if self.duplication.is_none() {
            self.reinitialize()?;
        }

        let dup = match &self.duplication {
            Some(d) => d,
            None => return Ok(None),
        };

        let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource = None;

        // SAFETY: AcquireNextFrame recebe ponteiros válidos para metadados e recurso.
        let hr = unsafe { dup.AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource) };

        if let Err(e) = hr {
            // DXGI_ERROR_WAIT_TIMEOUT significa que a tela não mudou no intervalo
            if e.code() == DXGI_ERROR_WAIT_TIMEOUT {
                return Ok(None);
            }
            // DXGI_ERROR_ACCESS_LOST requer reinicialização (ex: troca de desktop, UAC)
            if e.code() == DXGI_ERROR_ACCESS_LOST {
                let _ = self.reinitialize();
                return Ok(None);
            }
            return Err(DxgiCaptureError::AcquireFailed(e));
        }

        let mut captured_tex = None;

        if let Some(res) = resource {
            if let Ok(tex) = res.cast::<ID3D11Texture2D>() {
                // Cria uma textura de destino ou copia para preservação
                if let Ok(staging) = self.d3d11.create_staging_texture(
                    self.width,
                    self.height,
                    windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
                ) {
                    self.d3d11.copy_resource(&staging, &tex);
                    captured_tex = Some(staging);
                }
            }
        }

        // SAFETY: ReleaseFrame deve ser chamado logo após processar o frame adquirido.
        unsafe {
            let _ = dup.ReleaseFrame();
        }

        Ok(captured_tex)
    }

    /// Retorna as dimensões (largura, altura) da captura DXGI
    pub fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dxgi_capturer_creation() {
        if let Ok(ctx) = D3D11Context::new() {
            // Em ambientes headless (como VMs sem sessão gráfica ativa), pode retornar OutputNotFound
            let capturer = DxgiCapturer::new(ctx);
            if let Ok(cap) = capturer {
                assert!(cap.width > 0);
                assert!(cap.height > 0);
            }
        }
    }
}
