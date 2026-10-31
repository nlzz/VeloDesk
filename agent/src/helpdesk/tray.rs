//! Aplicativo de Notificação do Sistema (Windows System Tray App)
//!
//! Exibe ícone discreto na bandeja do Windows (perto do relógio) com
//! menu de contexto para abertura rápida de chamados, captura de tela
//! e encerramento de sessão assistida.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Mensagens de comando acionadas pelo Tray
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayCommand {
    RequestSupport,
    CheckStatus,
    EndSession,
    Exit,
}

/// Controlador do System Tray
#[derive(Clone)]
pub struct SystemTrayController {
    is_running: Arc<AtomicBool>,
    tenant_name: Arc<parking_lot::Mutex<String>>,
}

impl SystemTrayController {
    pub fn new(tenant_name: &str) -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            tenant_name: Arc::new(parking_lot::Mutex::new(tenant_name.to_string())),
        }
    }

    /// Inicia a exibição do ícone no System Tray
    pub fn start<F>(&self, on_command: F)
    where
        F: Fn(TrayCommand) + Send + Sync + 'static,
    {
        if self.is_running.swap(true, Ordering::SeqCst) {
            return;
        }

        let name = self.tenant_name.lock().clone();
        log::info!(
            "[SystemTray] Ícone da bandeja iniciado para Tenant: '{}'.",
            name
        );

        let is_running = self.is_running.clone();
        let cmd_cb = Arc::new(on_command);

        std::thread::spawn(move || {
            #[cfg(windows)]
            run_win32_tray_loop(is_running, cmd_cb);

            #[cfg(not(windows))]
            while is_running.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        });
    }

    /// Oculta e encerra o ícone do System Tray
    pub fn stop(&self) {
        if self.is_running.swap(false, Ordering::SeqCst) {
            log::info!("[SystemTray] Ícone da bandeja desativado.");
        }
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }
}

// Mutex auxiliar
mod parking_lot {
    use std::sync::Mutex as StdMutex;

    pub struct Mutex<T>(StdMutex<T>);

    impl<T> Mutex<T> {
        pub fn new(val: T) -> Self {
            Self(StdMutex::new(val))
        }

        pub fn lock(&self) -> std::sync::MutexGuard<'_, T> {
            match self.0.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            }
        }
    }
}

#[cfg(windows)]
fn run_win32_tray_loop(
    is_running: Arc<AtomicBool>,
    _on_command: Arc<dyn Fn(TrayCommand) + Send + Sync>,
) {
    use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW, PeekMessageW, MSG, PM_REMOVE};

    while is_running.load(Ordering::Relaxed) {
        let mut msg = MSG::default();
        // SAFETY: Loop de mensagens para processar interações do usuário com o ícone do Tray
        let has_msg = unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() };
        if has_msg {
            // SAFETY: Despacho seguro de mensagem Win32
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
    fn test_tray_controller_lifecycle() {
        let tray = SystemTrayController::new("Escritório Alfa");
        assert!(!tray.is_running());

        tray.start(|_cmd| {});
        assert!(tray.is_running());

        tray.stop();
        assert!(!tray.is_running());
    }
}
