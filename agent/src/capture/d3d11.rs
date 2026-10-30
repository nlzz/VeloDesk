//! Gerenciador de contexto e recursos Direct3D 11.
//!
//! Cria e encapsula o dispositivo `ID3D11Device` e `ID3D11DeviceContext` com suporte
//! a BGRA e drivers de aceleração por hardware (com fallback automático para WARP).

use thiserror::Error;
use windows::core::Result as WinResult;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP,
};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_SAMPLE_DESC};

/// Erros na inicialização e gerenciamento de recursos Direct3D 11
#[derive(Debug, Error)]
pub enum D3D11Error {
    /// Falha ao inicializar o dispositivo Direct3D 11
    #[error("Falha ao criar ID3D11Device (Win32 HRESULT: {0})")]
    DeviceCreationFailed(windows::core::Error),
    /// Falha ao alocar textura 2D
    #[error("Falha ao criar textura 2D: {0}")]
    TextureCreationFailed(windows::core::Error),
    /// Falha ao mapear recurso de textura para leitura
    #[error("Falha ao mapear textura de staging: {0}")]
    MapFailed(windows::core::Error),
}

/// Estrutura contendo o dispositivo e o contexto D3D11
#[derive(Clone)]
pub struct D3D11Context {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
}

impl D3D11Context {
    /// Inicializa um novo contexto D3D11 com suporte a aceleração gráfica
    pub fn new() -> Result<Self, D3D11Error> {
        let (device, context) = Self::create_device(D3D_DRIVER_TYPE_HARDWARE)
            .or_else(|_| Self::create_device(D3D_DRIVER_TYPE_WARP))
            .map_err(D3D11Error::DeviceCreationFailed)?;

        Ok(Self { device, context })
    }

    /// Tenta instanciar o dispositivo D3D11 com o tipo de driver especificado
    fn create_device(
        driver_type: D3D_DRIVER_TYPE,
    ) -> WinResult<(ID3D11Device, ID3D11DeviceContext)> {
        let mut device = None;
        let mut context = None;

        // SAFETY: D3D11CreateDevice é invocado com parâmetros válidos e ponteiros
        // de saída devidamente inicializados como None para receber os objetos COM.
        unsafe {
            D3D11CreateDevice(
                None,
                driver_type,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }

        match (device, context) {
            (Some(dev), Some(ctx)) => Ok((dev, ctx)),
            _ => Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                -1,
            ))),
        }
    }

    /// Retorna uma referência ao dispositivo Direct3D 11
    pub fn device(&self) -> &ID3D11Device {
        &self.device
    }

    /// Retorna uma referência ao contexto imediato Direct3D 11
    pub fn context(&self) -> &ID3D11DeviceContext {
        &self.context
    }

    /// Cria uma textura 2D com perfil de Staging para leitura pela CPU
    pub fn create_staging_texture(
        &self,
        width: u32,
        height: u32,
        format: DXGI_FORMAT,
    ) -> Result<ID3D11Texture2D, D3D11Error> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };

        let mut texture = None;
        // SAFETY: Invocamos CreateTexture2D com descrição válida e ponteiro de saída.
        unsafe {
            self.device
                .CreateTexture2D(&desc, None, Some(&mut texture))
                .map_err(D3D11Error::TextureCreationFailed)?;
        }

        texture.ok_or_else(|| {
            D3D11Error::TextureCreationFailed(windows::core::Error::from_hresult(
                windows::core::HRESULT(-1),
            ))
        })
    }

    /// Copia uma região ou recurso de textura para outro
    pub fn copy_resource(&self, dst: &ID3D11Texture2D, src: &ID3D11Texture2D) {
        // SAFETY: CopyResource recebe recursos compatíveis previamente criados ou
        // capturados com dimensões e formatos idênticos.
        unsafe {
            self.context.CopyResource(dst, src);
        }
    }

    /// Mapeia uma textura de staging e executa uma closure com os bytes brutos
    pub fn read_staging_texture<F, R>(
        &self,
        texture: &ID3D11Texture2D,
        f: F,
    ) -> Result<R, D3D11Error>
    where
        F: FnOnce(&[u8], u32) -> R,
    {
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();

        // SAFETY: Map é chamado em uma textura criada com D3D11_USAGE_STAGING e D3D11_CPU_ACCESS_READ.
        unsafe {
            self.context
                .Map(texture, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(D3D11Error::MapFailed)?;
        }

        let desc = {
            let mut d = D3D11_TEXTURE2D_DESC::default();
            // SAFETY: GetDesc lê metadados estáticos do cabeçalho da textura D3D11.
            unsafe { texture.GetDesc(&mut d) };
            d
        };

        let row_pitch = mapped.RowPitch;
        let total_size = (row_pitch * desc.Height) as usize;

        // SAFETY: mapped.pData aponta para a memória alocada pelo driver DirectX,
        // garantida como válida e imutável durante o escopo antes de Unmap.
        let slice = unsafe { std::slice::from_raw_parts(mapped.pData as *const u8, total_size) };
        let res = f(slice, row_pitch);

        // SAFETY: Unmap libera o bloqueio de leitura de memória do buffer DirectX.
        unsafe {
            self.context.Unmap(texture, 0);
        }

        Ok(res)
    }
}

impl Default for D3D11Context {
    fn default() -> Self {
        Self::new().unwrap_or_else(|e| {
            panic!("Falha crítica ao inicializar Direct3D 11: {e}");
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;

    #[test]
    fn test_d3d11_initialization() {
        let ctx = D3D11Context::new();
        assert!(
            ctx.is_ok(),
            "D3D11 context creation failed: {:?}",
            ctx.err()
        );
    }

    #[test]
    fn test_create_staging_texture() {
        if let Ok(ctx) = D3D11Context::new() {
            let tex = ctx.create_staging_texture(100, 100, DXGI_FORMAT_B8G8R8A8_UNORM);
            assert!(tex.is_ok());
        }
    }
}
