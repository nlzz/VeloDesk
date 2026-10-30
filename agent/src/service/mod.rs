//! Módulo de Serviço Windows, Gerenciamento de Sessões, UAC e Acesso Autônomo.
//!
//! Este módulo implementa a arquitetura de alta performance para execução contínua
//! do VeloDesk como serviço do sistema operacional Windows (`NT AUTHORITY\SYSTEM` na Session 0),
//! com supervisão de transições de desktop (UAC / Winlogon) e injeção do agente interativo
//! via duplicação de token (`CreateProcessAsUserW`).

pub mod desktop;
pub mod manager;
pub mod process;
pub mod session;
pub mod unattended;
pub mod worker;

pub use desktop::{get_active_input_desktop, DesktopInfo};
pub use manager::{
    install_service, start_service, status_service, stop_service, uninstall_service,
};
pub use process::spawn_agent_in_session;
pub use session::{get_active_console_session_id, SessionNotificationEvent};
pub use unattended::{
    calculate_sha256, get_default_config_path, hash_password_argon2, load_service_config,
    save_service_config, verify_password_argon2, ServiceConfig,
};
pub use worker::run_service;
