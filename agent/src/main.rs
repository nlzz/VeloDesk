//! Ponto de Entrada do Host Agent do VeloDesk (`velodesk-agent`).
//!
//! Inicializa subsistemas de captura WGC/DXGI, encoder H.264 MFT,
//! injeção de inputs e cliente de sinalização WebRTC.

pub mod capture;
pub mod config;
pub mod encoder;
pub mod input;
pub mod protocol;
pub mod signaling;
pub mod webrtc_session;

use config::AgentConfig;
use signaling::SignalingClient;
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Inicializa o logger formatado
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    log::info!("============================================================");
    log::info!("  VeloDesk Host Agent v0.2.0 (Rust)");
    log::info!("  Acesso e Suporte Remoto de Alta Performance");
    log::info!("  Captura: Windows Graphics Capture (WGC) / DXGI");
    log::info!("  Encoder: Windows Media Foundation (MFT) H.264");
    log::info!("  Transporte: WebRTC P2P (DTLS-SRTP) com Fallback Coturn");
    log::info!("============================================================");

    let mut config = AgentConfig::from_env();

    // Leitura simplificada de argumentos de linha de comando
    let args: Vec<String> = env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--server" | "-s" if i + 1 < args.len() => {
                config.server_url = args[i + 1].clone();
                i += 2;
            }
            "--id" if i + 1 < args.len() => {
                config.agent_id = args[i + 1].clone();
                i += 2;
            }
            "--password" | "-p" if i + 1 < args.len() => {
                config.password_hash = args[i + 1].clone();
                i += 2;
            }
            "--fps" if i + 1 < args.len() => {
                if let Ok(fps) = args[i + 1].parse::<u32>() {
                    config.target_fps = fps;
                }
                i += 2;
            }
            "--bitrate" if i + 1 < args.len() => {
                if let Ok(br) = args[i + 1].parse::<u32>() {
                    config.target_bitrate = br;
                }
                i += 2;
            }
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            _ => {
                i += 1;
            }
        }
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

/// Exibe texto de ajuda e parâmetros aceitos pela CLI
fn print_help() {
    println!("Uso: velodesk-agent [opções]");
    println!();
    println!("Opções:");
    println!("  --server, -s <URL>    URL WebSocket do servidor de sinalização (padrão: ws://127.0.0.1:8080/ws)");
    println!("  --id <ID>             Identificador de 9 dígitos customizado (ex: 832-192-041)");
    println!("  --password, -p <HASH> Hash SHA-256 da senha de acesso do agente");
    println!("  --fps <NUM>           Taxa de quadros por segundo alvo (padrão: 60)");
    println!("  --bitrate <NUM>       Taxa de bits alvo em bps (padrão: 4000000 = 4 Mbps)");
    println!("  --help, -h            Exibe esta mensagem de ajuda");
}
