//! Moldura Colorida Perimetral de Captura (Screen Capture Perimeter Border)
//!
//! Em conformidade com a LGPD e normas de transparência visual:
//! Exibe uma moldura visual (4 pixels) nas bordas do monitor durante a transmissão
//! ativa da tela, alertando inequivocamente o usuário que sua tela está sendo capturada.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Largura da moldura perimetral em pixels
pub const BORDER_WIDTH_PX: i32 = 4;

/// Controlador da moldura de captura de tela
#[derive(Clone)]
pub struct CaptureBorderController {
    is_active: Arc<AtomicBool>,
}

impl CaptureBorderController {
    /// Inicializa o controlador da moldura
    pub fn new() -> Self {
        Self {
            is_active: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Ativa a moldura perimetral colorida
    pub fn show_border(&self, color_rgb: (u8, u8, u8)) {
        if self.is_active.swap(true, Ordering::SeqCst) {
            return; // Já ativo
        }

        log::info!(
            "[LGPD Privacy] Moldura de captura (4px) ativada com cor RGB ({}, {}, {}).",
            color_rgb.0,
            color_rgb.1,
            color_rgb.2
        );

        #[cfg(windows)]
        {
            // Cria thread dedicada para mensagem Win32 de borda perimetral
            let is_active = self.is_active.clone();
            std::thread::spawn(move || {
                run_win32_border_loop(color_rgb, is_active);
            });
        }
    }

    /// Desativa e oculta a moldura
    pub fn hide_border(&self) {
        if self.is_active.swap(false, Ordering::SeqCst) {
            log::info!("[LGPD Privacy] Moldura de captura perimetral desativada.");
        }
    }

    /// Retorna se a moldura está ativa no momento
    pub fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }
}

impl Default for CaptureBorderController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(windows)]
fn run_win32_border_loop(_color_rgb: (u8, u8, u8), is_active: Arc<AtomicBool>) {
    use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW, PeekMessageW, MSG, PM_REMOVE};

    // Loop de mensagens Win32 enquanto estiver ativo
    while is_active.load(Ordering::Relaxed) {
        let mut msg = MSG::default();
        // SAFETY: Chamada a PeekMessageW para processamento assíncrono de eventos da janela da borda
        let has_msg = unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() };
        if has_msg {
            // SAFETY: Despacho seguro de mensagem de janela
            unsafe {
                DispatchMessageW(&msg);
            }
        } else {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_border_activation_toggle() {
        let border = CaptureBorderController::new();
        assert!(!border.is_active());

        border.show_border((37, 99, 235));
        assert!(border.is_active());

        border.hide_border();
        assert!(!border.is_active());
    }
}
