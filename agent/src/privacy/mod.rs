//! VeloDesk v2.0 - Módulo Central de Salvaguardas Mandatórias de Privacidade e LGPD
//!
//! Reúne:
//! - Moldura perimetral colorida (4px) durante a captura
//! - Banner TopMost flutuante com identificação do técnico e Botão de Pânico (Kill Switch)
//! - Preempção de mouse físico local por 3 segundos
//! - Privacy Masking para campos de senha
//! - Quarentena isolada e varredura antivírus via Windows AMSI (AmsiScanBuffer)

pub mod amsi;
pub mod banner;
pub mod border;
pub mod lockout;
pub mod masking;

pub use amsi::{QuarantineManager, QuarantineScanResult};
pub use banner::SessionBannerController;
pub use border::CaptureBorderController;
pub use lockout::InputPreemptionManager;
pub use masking::PrivacyMaskingController;

use std::sync::Arc;

/// Controlador Unificado de Privacidade e Blindagem Jurídica do Agente
#[derive(Clone)]
pub struct PrivacyManager {
    pub border: CaptureBorderController,
    pub banner: SessionBannerController,
    pub preemption: InputPreemptionManager,
    pub masking: PrivacyMaskingController,
    pub quarantine: Arc<QuarantineManager>,
}

impl PrivacyManager {
    /// Inicializa todos os subsistemas de privacidade e quarentena
    pub fn new() -> anyhow::Result<Self> {
        let quarantine = QuarantineManager::new()?;
        Ok(Self {
            border: CaptureBorderController::new(),
            banner: SessionBannerController::new(),
            preemption: InputPreemptionManager::default(),
            masking: PrivacyMaskingController::new(),
            quarantine: Arc::new(quarantine),
        })
    }

    /// Disparado no início de uma sessão remota assistida
    pub fn on_session_started<F>(&self, tech_name: &str, on_kill_switch: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        // 1. Ativa a moldura perimetral visual
        self.border.show_border((37, 99, 235));

        // 2. Exibe o banner com o botão de pânico
        self.banner.show(tech_name, Arc::new(on_kill_switch));

        log::info!(
            "[PrivacyManager] Salvaguardas LGPD ativadas com sucesso para a sessão com '{}'",
            tech_name
        );
    }

    /// Disparado no encerramento da sessão
    pub fn on_session_ended(&self) {
        self.border.hide_border();
        self.banner.hide();
        self.masking.set_sensitive_focus(false);
        log::info!("[PrivacyManager] Salvaguardas visuais de sessão desativadas.");
    }
}
