//! Preempção de Entrada Local (Local Input Preemption & Physical Mouse Override)
//!
//! Em conformidade com a LGPD e princípios de segurança do usuário:
//! Se o operador local na máquina host movimentar o mouse físico ou pressionar uma tecla,
//! a injeção remota (SendInput) é imediatamente bloqueada por 3 segundos.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Duração padrão do bloqueio de entrada remota quando o mouse físico é acionado
pub const DEFAULT_PREEMPTION_DURATION: Duration = Duration::from_secs(3);

/// Gerenciador de Preempção de Entrada Local
#[derive(Clone)]
pub struct InputPreemptionManager {
    locked_until: Arc<RwLock<Option<Instant>>>,
    duration: Duration,
    has_active_lockout: Arc<AtomicBool>,
}

impl InputPreemptionManager {
    /// Cria um novo gerenciador de preempção
    pub fn new(preemption_duration: Duration) -> Self {
        Self {
            locked_until: Arc::new(RwLock::new(None)),
            duration: preemption_duration,
            has_active_lockout: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Disparado quando um evento físico local (movimento do mouse ou clique) é detectado
    pub async fn trigger_local_activity(&self) {
        let mut lock = self.locked_until.write().await;
        let until = Instant::now() + self.duration;
        *lock = Some(until);
        self.has_active_lockout.store(true, Ordering::SeqCst);
        log::warn!(
            "[LGPD Privacy] Atividade de mouse físico local detectada. Entrada remota bloqueada por {:?}.",
            self.duration
        );
    }

    /// Verifica se a entrada remota está bloqueada no momento
    pub async fn is_remote_input_blocked(&self) -> bool {
        if !self.has_active_lockout.load(Ordering::Relaxed) {
            return false;
        }

        let lock = self.locked_until.read().await;
        if let Some(until) = *lock {
            if Instant::now() < until {
                return true;
            }
        }
        drop(lock);

        // Se expirou, reseta o estado
        let mut write_lock = self.locked_until.write().await;
        *write_lock = None;
        self.has_active_lockout.store(false, Ordering::SeqCst);
        false
    }

    /// Verificação rápida síncrona (não-bloqueante) para injetor de periféricos
    pub fn is_blocked_sync(&self) -> bool {
        self.has_active_lockout.load(Ordering::Relaxed)
    }

    /// Tempo restante de bloqueio em milissegundos
    pub async fn remaining_lockout_ms(&self) -> u64 {
        let lock = self.locked_until.read().await;
        if let Some(until) = *lock {
            let now = Instant::now();
            if now < until {
                return (until - now).as_millis() as u64;
            }
        }
        0
    }
}

impl Default for InputPreemptionManager {
    fn default() -> Self {
        Self::new(DEFAULT_PREEMPTION_DURATION)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_local_input_preemption() {
        let manager = InputPreemptionManager::new(Duration::from_millis(50));

        // Inicialmente não bloqueado
        assert!(!manager.is_remote_input_blocked().await);

        // Dispara evento local
        manager.trigger_local_activity().await;

        // Imediatamente deve estar bloqueado
        assert!(manager.is_remote_input_blocked().await);
        assert!(manager.remaining_lockout_ms().await > 0);

        // Aguarda expiração da janela de 50ms
        tokio::time::sleep(Duration::from_millis(60)).await;

        // Deve liberar a entrada remota
        assert!(!manager.is_remote_input_blocked().await);
        assert_eq!(manager.remaining_lockout_ms().await, 0);
    }
}
