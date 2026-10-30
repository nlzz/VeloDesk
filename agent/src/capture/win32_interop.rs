//! Interoperabilidade Win32 e COM para o subsistema de captura.
//!
//! Encapsula chamadas de métricas de tela e ciclo de vida de inicialização COM.

use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
};

/// Dimensões da tela em pixels
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenDimensions {
    /// Largura em pixels
    pub width: u32,
    /// Altura em pixels
    pub height: u32,
    /// Largura do desktop virtual multimonitor
    pub virtual_width: u32,
    /// Altura do desktop virtual multimonitor
    pub virtual_height: u32,
}

/// Obtém as dimensões da tela primária e do desktop virtual
pub fn get_screen_dimensions() -> ScreenDimensions {
    // SAFETY: GetSystemMetrics é uma chamada somente-leitura ao subsistema Win32
    // que não manipula ponteiros e é segura para invocação em qualquer thread.
    let (width, height, v_width, v_height) = unsafe {
        (
            GetSystemMetrics(SM_CXSCREEN) as u32,
            GetSystemMetrics(SM_CYSCREEN) as u32,
            GetSystemMetrics(SM_CXVIRTUALSCREEN) as u32,
            GetSystemMetrics(SM_CYVIRTUALSCREEN) as u32,
        )
    };

    ScreenDimensions {
        width: if width == 0 { 1920 } else { width },
        height: if height == 0 { 1080 } else { height },
        virtual_width: if v_width == 0 { 1920 } else { v_width },
        virtual_height: if v_height == 0 { 1080 } else { v_height },
    }
}

/// Guarda RAII para ciclo de vida do COM na thread de captura
pub struct ComGuard;

impl ComGuard {
    /// Inicializa a biblioteca COM com apartment multithreaded
    pub fn new() -> Self {
        // SAFETY: CoInitializeEx é invocado com flags bem definidas para inicializar
        // o subsistema COM na thread atual.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        Self
    }
}

impl Default for ComGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        // SAFETY: CoUninitialize finaliza os recursos COM alocados na thread atual.
        unsafe {
            CoUninitialize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_screen_dimensions_not_zero() {
        let dims = get_screen_dimensions();
        assert!(dims.width > 0);
        assert!(dims.height > 0);
    }

    #[test]
    fn test_com_guard_raii() {
        let guard = ComGuard::new();
        drop(guard);
    }
}
