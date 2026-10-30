//! Ponto de Entrada do Host Agent do VeloDesk (`velodesk-agent`).
//!
//! Inicializa subsistemas de captura WGC/DXGI, encoder H.264 MFT,
//! injeção de inputs, cliente de sinalização WebRTC, gestão do Windows Service
//! e suporte completo a UAC e Acesso Autônomo (Argon2id).

pub mod capture;
pub mod cli;
pub mod config;
pub mod encoder;
pub mod input;
pub mod protocol;
pub mod service;
pub mod signaling;
pub mod webrtc_session;

use cli::{parse_cli_args, print_help, CliCommand};
use config::AgentConfig;
use service::{
    calculate_sha256, hash_password_argon2, install_service, load_service_config, run_service,
    save_service_config, start_service, status_service, stop_service, uninstall_service,
};
use signaling::SignalingClient;
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Inicializa o logger formatado
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    // Processa os argumentos da linha de comando
    let cli_opts = parse_cli_args(env::args())?;

    // Despacha comandos de gestão do Windows Service ou Help
    match cli_opts.command {
        CliCommand::PrintHelp => {
            print_help();
            return Ok(());
        }
        CliCommand::InstallService => {
            println!("Instalando VeloDeskAgent como Windows Service (AutoStart)...");
            install_service()?;
            println!("Serviço instalado com sucesso!");
            return Ok(());
        }
        CliCommand::UninstallService => {
            println!("Desinstalando VeloDeskAgent do Windows Service Control Manager...");
            uninstall_service()?;
            println!("Serviço removido com sucesso.");
            return Ok(());
        }
        CliCommand::StartService => {
            println!("Iniciando serviço VeloDeskAgent...");
            start_service()?;
            println!("Serviço iniciado com sucesso.");
            return Ok(());
        }
        CliCommand::StopService => {
            println!("Enviando sinal de parada para VeloDeskAgent...");
            stop_service()?;
            println!("Serviço finalizado com sucesso.");
            return Ok(());
        }
        CliCommand::StatusService => {
            let status = status_service()?;
            println!("=== Status do Serviço VeloDesk ===");
            println!("{status}");
            return Ok(());
        }
        CliCommand::RunAsService => {
            log::info!("[Agent] Executando em modo Windows Service (Session 0)...");
            run_service()?;
            return Ok(());
        }
        CliCommand::SetPassword(new_password) => {
            println!("Derivando hash de chave permanente via Argon2id...");
            let argon2_hash = hash_password_argon2(&new_password)?;
            let sha256_hash = calculate_sha256(&new_password);

            let mut cfg = load_service_config(None).unwrap_or_default();
            cfg.password_hash_argon2 = argon2_hash;
            cfg.auth_token_sha256 = sha256_hash;
            cfg.unattended_enabled = true;

            let path = save_service_config(&cfg, None)?;
            println!("Senha permanente para acesso autônomo configurada com sucesso!");
            println!("Armazenamento seguro persistido em: {}", path.display());
            println!("ID do Host: {}", cfg.agent_id);
            return Ok(());
        }
        CliCommand::RunAgent => {
            // Continua para inicialização do agente interativo
        }
    }

    log::info!("============================================================");
    log::info!("  VeloDesk Host Agent v1.0.0 (Rust)");
    log::info!("  Acesso e Suporte Remoto de Alta Performance");
    log::info!("  Captura: Windows Graphics Capture (WGC) / DXGI");
    log::info!("  Encoder: Windows Media Foundation (MFT) H.264");
    log::info!("  Transporte: WebRTC P2P (DTLS-SRTP) com Fallback Coturn");
    log::info!("  UAC & Secure Desktop: Suportado via Session Injection");
    log::info!("============================================================");

    let mut config = AgentConfig::from_env();

    // Se houver configuração persistente de serviço, carrega valores de acesso autônomo
    if let Ok(svc_cfg) = load_service_config(None) {
        if svc_cfg.unattended_enabled {
            log::info!("[Agent] Configuração de acesso autônomo detectada (%ProgramData%).");
            config.agent_id = svc_cfg.agent_id;
            config.server_url = svc_cfg.server_url;
            if !svc_cfg.auth_token_sha256.is_empty() {
                config.password_hash = svc_cfg.auth_token_sha256;
            }
        }
    }

    // Sobrescreve com argumentos explícitos de CLI se fornecidos
    if let Some(srv) = cli_opts.server_url {
        config.server_url = srv;
    }
    if let Some(id) = cli_opts.agent_id {
        config.agent_id = id;
    }
    if let Some(pass) = cli_opts.password_hash {
        config.password_hash = pass;
    }
    if let Some(fps) = cli_opts.target_fps {
        config.target_fps = fps;
    }
    if let Some(br) = cli_opts.target_bitrate {
        config.target_bitrate = br;
    }

    if let Some(ref d) = cli_opts.desktop {
        log::info!("[Agent] Executando associado ao Desktop Win32: '{}'", d);
    }
    if cli_opts.is_interactive {
        log::info!("[Agent] Modo Interativo ativo (Console Session).");
    }

    log::info!("[Agent] ID do Host: {}", config.agent_id);
    log::info!("[Agent] Hostname: {}", config.hostname);
    log::info!("[Agent] Servidor de Sinalização: {}", config.server_url);
    log::info!(
        "[Agent] Meta de Vídeo: {} FPS @ {} kbps",
        config.target_fps,
        config.target_bitrate / 1000
    );

    let mut client = SignalingClient::new(config);

    tokio::select! {
        _ = client.run() => {},
        _ = tokio::signal::ctrl_c() => {
            log::info!("[Agent] Sinal de interrupção (Ctrl+C) recebido. Encerrando agente...");
        }
    }

    log::info!("[Agent] VeloDesk Host Agent finalizado com sucesso.");
    Ok(())
}
