//! Comandos nativos expostos para a interface do operador via IPC.

use crate::SystemInfo;

/// Comando nativo para obter informações do sistema operacional
#[tauri::command]
pub fn get_system_info() -> Result<SystemInfo, String> {
    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_info_command() {
        let info = get_system_info().expect("get_system_info should succeed");
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }
}
