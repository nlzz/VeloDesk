//! VeloDesk v2.0 - Helpdesk Integrado e Tray App do Agente
//!
//! Reúne captura rápida de tela e controle do System Tray para solicitação
//! de suporte pelo cliente com 1 clique.

pub mod screenshot;
pub mod tray;

pub use screenshot::capture_desktop_screenshot;
pub use tray::{SystemTrayController, TrayCommand};
