//! Gestão de Acesso Autônomo (Unattended Access) e Credenciais Argon2id.
//!
//! Permite o armazenamento seguro de configurações de serviço em `%ProgramData%\VeloDesk\service.json`
//! e derivação criptográfica de senhas permanentes via Argon2id.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Nome padrão do arquivo de configuração do serviço
pub const SERVICE_CONFIG_FILENAME: &str = "service.json";
/// Diretório padrão de dados do serviço no Windows
pub const SERVICE_DIR_NAME: &str = "VeloDesk";

/// Configurações persistentes do serviço para acesso autônomo
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceConfig {
    /// Identificador fixo do agente (formato 123-456-789)
    pub agent_id: String,
    /// URL do servidor de sinalização (ex: ws://127.0.0.1:8080/ws)
    pub server_url: String,
    /// Hash criptográfico Argon2id da senha permanente (PHC string)
    pub password_hash_argon2: String,
    /// Token de autenticação SHA-256 para sinalização rápida
    pub auth_token_sha256: String,
    /// Se o acesso autônomo sem confirmação do usuário está habilitado
    pub unattended_enabled: bool,
    /// Se o serviço deve ser iniciado automaticamente com o boot do sistema
    pub auto_start: bool,
    /// Taxa de quadros por segundo alvo
    pub target_fps: u32,
    /// Taxa de bits alvo em bps
    pub target_bitrate: u32,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            agent_id: "832-192-041".to_string(),
            server_url: "ws://127.0.0.1:8080/ws".to_string(),
            password_hash_argon2: String::new(),
            auth_token_sha256: String::new(),
            unattended_enabled: true,
            auto_start: true,
            target_fps: 60,
            target_bitrate: 4_000_000,
        }
    }
}

/// Deriva um hash seguro da senha permanente utilizando Argon2id.
///
/// Produz uma string padrão PHC resistente a ataques de força bruta por GPU/ASIC.
pub fn hash_password_argon2(password: &str) -> anyhow::Result<String> {
    if password.trim().is_empty() {
        anyhow::bail!("A senha não pode ser vazia");
    }

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Falha ao calcular hash Argon2id: {e}"))?
        .to_string();

    Ok(password_hash)
}

/// Valida uma senha fornecida em texto plano contra um hash Argon2id armazenado.
pub fn verify_password_argon2(password: &str, hash_str: &str) -> bool {
    if password.trim().is_empty() || hash_str.trim().is_empty() {
        return false;
    }

    let parsed_hash = match PasswordHash::new(hash_str) {
        Ok(h) => h,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

/// Calcula o hash SHA-256 de uma senha para transporte no protocolo de sinalização.
pub fn calculate_sha256(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    let mut hex = String::with_capacity(result.len() * 2);
    for b in result {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex
}

/// Retorna o caminho absoluto padrão para o arquivo `%ProgramData%\VeloDesk\service.json`
pub fn get_default_config_path() -> PathBuf {
    let program_data = env::var("ProgramData")
        .or_else(|_| env::var("ALLUSERSPROFILE"))
        .unwrap_or_else(|_| "C:\\ProgramData".to_string());

    PathBuf::from(program_data)
        .join(SERVICE_DIR_NAME)
        .join(SERVICE_CONFIG_FILENAME)
}

/// Carrega a configuração do serviço a partir de um caminho customizado ou do padrão
pub fn load_service_config(custom_path: Option<&Path>) -> anyhow::Result<ServiceConfig> {
    let path = match custom_path {
        Some(p) => p.to_path_buf(),
        None => get_default_config_path(),
    };

    if !path.exists() {
        anyhow::bail!(
            "Arquivo de configuração não encontrado em: {}",
            path.display()
        );
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("Erro ao ler {}: {e}", path.display()))?;

    let config: ServiceConfig = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("Erro ao deserializar {}: {e}", path.display()))?;

    Ok(config)
}

/// Salva a configuração do serviço em disco, criando os diretórios pai se necessário
pub fn save_service_config(
    config: &ServiceConfig,
    custom_path: Option<&Path>,
) -> anyhow::Result<PathBuf> {
    let path = match custom_path {
        Some(p) => p.to_path_buf(),
        None => get_default_config_path(),
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| anyhow::anyhow!("Erro ao criar diretório {}: {e}", parent.display()))?;
    }

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| anyhow::anyhow!("Erro ao serializar ServiceConfig: {e}"))?;

    fs::write(&path, json)
        .map_err(|e| anyhow::anyhow!("Erro ao escrever {}: {e}", path.display()))?;

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argon2_hash_and_verification() {
        let password = "SecretPassword!123";
        let hash = hash_password_argon2(password).expect("Hash deve ser gerado com sucesso");

        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password_argon2(password, &hash));
        assert!(!verify_password_argon2("WrongPassword", &hash));
        assert!(!verify_password_argon2("", &hash));
    }

    #[test]
    fn test_argon2_empty_password_fails() {
        assert!(hash_password_argon2("").is_err());
        assert!(hash_password_argon2("   ").is_err());
    }

    #[test]
    fn test_sha256_calculation() {
        let hash = calculate_sha256("test");
        assert_eq!(
            hash,
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn test_service_config_save_and_load() {
        let temp_dir = env::temp_dir().join("velodesk_test_unattended");
        let test_path = temp_dir.join("test_service.json");

        let config = ServiceConfig {
            agent_id: "999-888-777".to_string(),
            password_hash_argon2: hash_password_argon2("VeloDeskAdmin@2026").unwrap(),
            auth_token_sha256: calculate_sha256("VeloDeskAdmin@2026"),
            unattended_enabled: true,
            ..Default::default()
        };

        save_service_config(&config, Some(&test_path)).expect("Salvar deve suceder");

        let loaded = load_service_config(Some(&test_path)).expect("Carregar deve suceder");
        assert_eq!(loaded, config);

        // Limpeza
        let _ = fs::remove_file(test_path);
        let _ = fs::remove_dir(temp_dir);
    }
}
