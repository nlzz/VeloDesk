//! Camada nativa do VeloDesk Viewer (Tauri v2).
//!
//! Fornece integração com o sistema operacional hospedeiro, comandos IPC
//! e inicialização do runtime gráfico nativo (WebView2 no Windows).

pub mod commands;

use serde::{Deserialize, Serialize};

/// Informações do ambiente de execução do operador
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SystemInfo {
    /// Nome da plataforma (ex: "windows", "linux", "macos")
    pub os: String,
    /// Versão do VeloDesk Viewer
    pub version: String,
}

/// Inicializa o contexto e construtor do aplicativo Tauri
pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::get_system_info]);

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(err) => {
            eprintln!("Falha ao construir aplicativo Tauri: {err}");
            return;
        }
    };

    app.run(|_app_handle, _event| {});
}
