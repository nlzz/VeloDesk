//! Interoperabilidade e ciclo de vida do Windows Media Foundation (MF).

use windows::Win32::Media::MediaFoundation::{
    MFShutdown, MFStartup, MFSTARTUP_NOSOCKET, MF_VERSION,
};

/// Guarda RAII para ciclo de vida do Windows Media Foundation
pub struct MfGuard;

impl MfGuard {
    /// Inicializa o subsistema Media Foundation na thread atual
    pub fn new() -> windows::core::Result<Self> {
        // SAFETY: MFStartup é chamado com a versão oficial da API e sem sockets
        // para inicializar a biblioteca de codecs e MFTs.
        unsafe {
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)?;
        }
        Ok(Self)
    }
}

impl Drop for MfGuard {
    fn drop(&mut self) {
        // SAFETY: MFShutdown encerra e limpa os recursos do Media Foundation.
        unsafe {
            let _ = MFShutdown();
        }
    }
}

/// Empacota dois inteiros de 32 bits (largura/altura ou numerador/denominador) em um u64
#[inline]
pub fn pack_u64(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pack_u64() {
        let packed = pack_u64(1920, 1080);
        assert_eq!(packed >> 32, 1920);
        assert_eq!(packed & 0xFFFF_FFFF, 1080);
    }

    #[test]
    fn test_mf_guard() {
        let guard = MfGuard::new();
        assert!(guard.is_ok());
    }
}
