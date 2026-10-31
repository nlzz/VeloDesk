//! Banner Flutuante TopMost com Botão de Pânico (Kill Switch)
//!
//! Em conformidade com os Arts. 6º e 46 da LGPD:
//! Durante a sessão, exibe janela TopMost irremovível informando a identidade
//! do técnico e tempo de sessão, com Botão de Pânico vermelho para encerramento
//! imediato pelo usuário local com 1 clique.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub type PanicCallback = Arc<dyn Fn() + Send + Sync + 'static>;

/// Controlador do Banner de Sessão e Kill Switch
#[derive(Clone)]
pub struct SessionBannerController {
    is_showing: Arc<AtomicBool>,
    tech_name: Arc<parking_lot::Mutex<String>>,
    started_at: Arc<parking_lot::Mutex<Option<Instant>>>,
    panic_callback: Arc<parking_lot::Mutex<Option<PanicCallback>>>,
}

impl SessionBannerController {
    pub fn new() -> Self {
        Self {
            is_showing: Arc::new(AtomicBool::new(false)),
            tech_name: Arc::new(parking_lot::Mutex::new(String::new())),
            started_at: Arc::new(parking_lot::Mutex::new(None)),
            panic_callback: Arc::new(parking_lot::Mutex::new(None)),
        }
    }

    /// Exibe o banner de controle e registra callback de emergência
    pub fn show(&self, tech_name: &str, on_panic: PanicCallback) {
        *self.tech_name.lock() = tech_name.to_string();
        *self.started_at.lock() = Some(Instant::now());
        *self.panic_callback.lock() = Some(on_panic);

        if !self.is_showing.swap(true, Ordering::SeqCst) {
            log::info!(
                "[LGPD Privacy] Banner TopMost ativo para técnico: '{}'. Kill Switch armado.",
                tech_name
            );
        }
    }

    /// Dispara o botão de pânico (Kill Switch de emergência)
    pub fn trigger_panic(&self) {
        log::warn!("[LGPD Privacy] 🚨 BOTÃO DE PÂNICO ACIONADO PELO CLIENTE! Encerrando sessão imediatamente...");
        if let Some(cb) = self.panic_callback.lock().as_ref() {
            cb();
        }
        self.hide();
    }

    /// Oculta e encerra o banner
    pub fn hide(&self) {
        if self.is_showing.swap(false, Ordering::SeqCst) {
            *self.started_at.lock() = None;
            *self.panic_callback.lock() = None;
            log::info!("[LGPD Privacy] Banner TopMost ocultado.");
        }
    }

    /// Retorna se o banner está ativo
    pub fn is_showing(&self) -> bool {
        self.is_showing.load(Ordering::Relaxed)
    }

    /// Retorna a duração decorrida da sessão em segundos
    pub fn elapsed_seconds(&self) -> u64 {
        if let Some(start) = *self.started_at.lock() {
            start.elapsed().as_secs()
        } else {
            0
        }
    }

    /// Retorna o nome do técnico associado à sessão
    pub fn tech_name(&self) -> String {
        self.tech_name.lock().clone()
    }
}

impl Default for SessionBannerController {
    fn default() -> Self {
        Self::new()
    }
}

// Implementação leve do Mutex caso parking_lot não esteja em Cargo.toml
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_banner_and_kill_switch_trigger() {
        let banner = SessionBannerController::new();
        let was_called = Arc::new(AtomicBool::new(false));

        let was_called_clone = was_called.clone();
        let cb = Arc::new(move || {
            was_called_clone.store(true, Ordering::SeqCst);
        });

        banner.show("Suporte TI", cb);
        assert!(banner.is_showing());
        assert_eq!(banner.tech_name(), "Suporte TI");

        // Aciona o Kill Switch
        banner.trigger_panic();

        assert!(was_called.load(Ordering::SeqCst));
        assert!(!banner.is_showing());
    }
}
