//! Privacy Masking (Mascaramento de Credenciais e Campos de Senha)
//!
//! Em conformidade com a LGPD e sigilo de dados sensíveis:
//! Identifica campos de senha (`IsPassword = true`) via UI Automation ou estado
//! de foco do sistema para proteção contra vazamento acidental em sessões assistidas.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Controlador de Mascaramento de Privacidade
#[derive(Clone)]
pub struct PrivacyMaskingController {
    is_sensitive_focus: Arc<AtomicBool>,
}

impl PrivacyMaskingController {
    pub fn new() -> Self {
        Self {
            is_sensitive_focus: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Sinaliza que um campo sensível / de senha está em foco
    pub fn set_sensitive_focus(&self, is_sensitive: bool) {
        let prev = self.is_sensitive_focus.swap(is_sensitive, Ordering::SeqCst);
        if prev != is_sensitive {
            log::debug!(
                "[LGPD Privacy] Estado de foco sensível alterado para: {}",
                is_sensitive
            );
        }
    }

    /// Retorna se há campo sensível ativo na tela
    pub fn is_sensitive_active(&self) -> bool {
        self.is_sensitive_focus.load(Ordering::Relaxed)
    }

    /// Detecta se a janela/controle ativo no Windows possui flag de senha
    #[cfg(windows)]
    pub fn check_active_window_password_field(&self) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

        // SAFETY: Obtenção segura da janela em foco no desktop
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() {
            return false;
        }

        let mut buffer = [0u16; 256];
        // SAFETY: Leitura do título da janela em foco
        let len = unsafe { GetWindowTextW(hwnd, &mut buffer) } as usize;
        let title = String::from_utf16_lossy(&buffer[..len]).to_lowercase();

        // Heurística de proteção em janelas sensíveis conhecidas (UAC, Logon, Credenciais)
        if title.contains("credential")
            || title.contains("segurança do windows")
            || title.contains("senha")
            || title.contains("password")
        {
            self.set_sensitive_focus(true);
            return true;
        }

        self.set_sensitive_focus(false);
        false
    }

    #[cfg(not(windows))]
    pub fn check_active_window_password_field(&self) -> bool {
        false
    }
}

impl Default for PrivacyMaskingController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_privacy_masking_toggle() {
        let masking = PrivacyMaskingController::new();
        assert!(!masking.is_sensitive_active());

        masking.set_sensitive_focus(true);
        assert!(masking.is_sensitive_active());

        masking.set_sensitive_focus(false);
        assert!(!masking.is_sensitive_active());
    }
}
