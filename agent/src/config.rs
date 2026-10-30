//! Configuração do Agente VeloDesk
//!
//! Gerencia parâmetros operacionais como endereço do servidor de sinalização,
//! credenciais, resolução, taxa de quadros (FPS) e taxa de bits alvo.

use std::env;

/// Modo preferencial de captura de tela
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureBackend {
    /// Windows Graphics Capture (padrão prioritário, zero-copy, sem borda amarela)
    Wgc,
    /// DXGI Desktop Duplication API (fallback para compatibilidade)
    Dxgi,
    /// Simulação sintética para testes automatizados e ambientes sem monitor
    Mock,
}

/// Configuração operacional do agente VeloDesk
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// URL do servidor de sinalização (WebSocket, ex: ws://127.0.0.1:8080/ws)
    pub server_url: String,
    /// Identificador único de 9 dígitos (ex: 832-192-041)
    pub agent_id: String,
    /// Nome de host da máquina remota
    pub hostname: String,
    /// Hash SHA-256 da senha de acesso (opcional)
    pub password_hash: String,
    /// Taxa de quadros por segundo alvo (padrão: 60)
    pub target_fps: u32,
    /// Taxa de bits alvo para o encoder H.264 em bps (padrão: 4_000_000 = 4 Mbps)
    pub target_bitrate: u32,
    /// Backend preferido de captura
    pub capture_backend: CaptureBackend,
    /// Intervalo de heartbeat em segundos
    pub heartbeat_interval_secs: u64,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            server_url: "ws://127.0.0.1:8080/ws".to_string(),
            agent_id: generate_default_agent_id(),
            hostname: get_system_hostname(),
            password_hash: String::new(),
            target_fps: 60,
            target_bitrate: 4_000_000,
            capture_backend: CaptureBackend::Wgc,
            heartbeat_interval_secs: 15,
        }
    }
}

impl AgentConfig {
    /// Carrega configuração a partir de argumentos de linha de comando ou variáveis de ambiente
    pub fn from_env() -> Self {
        let mut cfg = Self::default();

        if let Ok(val) = env::var("VELODESK_SERVER_URL") {
            if !val.trim().is_empty() {
                cfg.server_url = val;
            }
        }

        if let Ok(val) = env::var("VELODESK_AGENT_ID") {
            if !val.trim().is_empty() {
                cfg.agent_id = val;
            }
        }

        if let Ok(val) = env::var("VELODESK_PASSWORD_HASH") {
            cfg.password_hash = val;
        }

        if let Ok(val) = env::var("VELODESK_FPS") {
            if let Ok(fps) = val.parse::<u32>() {
                if fps > 0 && fps <= 144 {
                    cfg.target_fps = fps;
                }
            }
        }

        if let Ok(val) = env::var("VELODESK_BITRATE") {
            if let Ok(br) = val.parse::<u32>() {
                if br >= 500_000 {
                    cfg.target_bitrate = br;
                }
            }
        }

        cfg
    }
}

/// Gera um ID de agente aleatório no formato 123-456-789
fn generate_default_agent_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(123456789);

    let n1 = (nanos % 900) + 100;
    let n2 = ((nanos / 1000) % 900) + 100;
    let n3 = ((nanos / 1000000) % 900) + 100;
    format!("{n1:03}-{n2:03}-{n3:03}")
}

/// Obtém o hostname do sistema ou um valor fallback
fn get_system_hostname() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .unwrap_or_else(|_| "VeloDesk-Host".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = AgentConfig::default();
        assert_eq!(cfg.target_fps, 60);
        assert_eq!(cfg.target_bitrate, 4_000_000);
        assert_eq!(cfg.capture_backend, CaptureBackend::Wgc);
        assert_eq!(cfg.heartbeat_interval_secs, 15);
        assert!(cfg.agent_id.contains('-'));
        assert_eq!(cfg.agent_id.len(), 11);
    }

    #[test]
    fn test_agent_id_format() {
        let id = generate_default_agent_id();
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.len(), 3);
        for p in parts {
            assert_eq!(p.len(), 3);
            assert!(p.chars().all(|c| c.is_ascii_digit()));
        }
    }
}
