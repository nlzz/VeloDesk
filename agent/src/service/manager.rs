//! Gerenciador de Instalação, Remoção e Controle do Windows Service (SCM).
//!
//! Permite a instalação do agente como serviço no boot do sistema (`AutoStart`),
//! operando sob a conta `NT AUTHORITY\SYSTEM` na Session 0, além de iniciar,
//! parar e consultar o status do serviço via CLI.

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::ffi::OsString;
#[cfg(windows)]
use std::thread::sleep;
#[cfg(windows)]
use std::time::{Duration, Instant};

#[cfg(windows)]
use windows_service::{
    service::{
        ServiceAccess, ServiceErrorControl, ServiceInfo, ServiceStartType, ServiceState,
        ServiceType,
    },
    service_manager::{ServiceManager, ServiceManagerAccess},
};

/// Identificador único do serviço no Windows Service Control Manager
pub const SERVICE_NAME: &str = "VeloDeskAgent";
/// Nome amigável de exibição do serviço
pub const SERVICE_DISPLAY_NAME: &str = "VeloDesk Remote Access Service";
/// Descrição oficial exibida no console de serviços do Windows (services.msc)
pub const SERVICE_DESCRIPTION: &str =
    "Serviço de Acesso e Suporte Remoto VeloDesk de Alta Performance com suporte a UAC e Desktop Seguro.";

/// Instala o executável atual como um Windows Service com inicialização automática (`AutoStart`)
#[cfg(windows)]
pub fn install_service() -> anyhow::Result<()> {
    log::info!(
        "[ServiceManager] Instalando '{}' no Windows SCM...",
        SERVICE_NAME
    );

    let manager_access = ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE;
    let service_manager =
        ServiceManager::local_computer(None::<&str>, manager_access).map_err(|e| {
            anyhow::anyhow!("Falha ao conectar ao SCM (requer privilégios de Administrador): {e}")
        })?;

    let exe_path = env::current_exe().map_err(|e| {
        anyhow::anyhow!("Não foi possível obter o caminho do binário do agente: {e}")
    })?;

    let service_info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe_path,
        launch_arguments: vec![OsString::from("--service")],
        dependencies: vec![],
        account_name: None, // None = NT AUTHORITY\SYSTEM (LocalSystem)
        account_password: None,
    };

    let service = service_manager
        .create_service(&service_info, ServiceAccess::CHANGE_CONFIG)
        .map_err(|e| anyhow::anyhow!("Falha ao criar o serviço no SCM: {e}"))?;

    service
        .set_description(SERVICE_DESCRIPTION)
        .map_err(|e| anyhow::anyhow!("Falha ao definir descrição do serviço: {e}"))?;

    // Garante que o arquivo de configuração em %ProgramData%\VeloDesk\service.json exista
    let cfg_path = super::unattended::get_default_config_path();
    if !cfg_path.exists() {
        let default_cfg = super::unattended::ServiceConfig::default();
        let _ = super::unattended::save_service_config(&default_cfg, None);
        log::info!(
            "[ServiceManager] Configuração padrão criada em: {}",
            cfg_path.display()
        );
    }

    log::info!(
        "[ServiceManager] Serviço '{}' instalado com sucesso! Tipo: AutoStart, Conta: NT AUTHORITY\\SYSTEM",
        SERVICE_NAME
    );
    Ok(())
}

/// Remove o serviço do Windows Service Control Manager
#[cfg(windows)]
pub fn uninstall_service() -> anyhow::Result<()> {
    log::info!(
        "[ServiceManager] Desinstalando '{}' do Windows SCM...",
        SERVICE_NAME
    );

    let manager_access = ServiceManagerAccess::CONNECT;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)
        .map_err(|e| anyhow::anyhow!("Falha ao conectar ao SCM: {e}"))?;

    let service_access = ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE;
    let service = service_manager
        .open_service(SERVICE_NAME, service_access)
        .map_err(|e| {
            anyhow::anyhow!(
                "Serviço '{}' não está instalado ou erro ao abrir: {e}",
                SERVICE_NAME
            )
        })?;

    // Tenta parar antes de excluir
    if let Ok(status) = service.query_status() {
        if status.current_state != ServiceState::Stopped {
            log::info!("[ServiceManager] Parando serviço antes da desinstalação...");
            let _ = service.stop();
        }
    }

    service
        .delete()
        .map_err(|e| anyhow::anyhow!("Falha ao solicitar exclusão do serviço: {e}"))?;

    log::info!(
        "[ServiceManager] Serviço '{}' desinstalado com sucesso.",
        SERVICE_NAME
    );
    Ok(())
}

/// Inicia o serviço através do Service Control Manager
#[cfg(windows)]
pub fn start_service() -> anyhow::Result<()> {
    log::info!("[ServiceManager] Iniciando serviço '{}'...", SERVICE_NAME);

    let manager_access = ServiceManagerAccess::CONNECT;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)
        .map_err(|e| anyhow::anyhow!("Falha ao conectar ao SCM: {e}"))?;

    let service = service_manager
        .open_service(
            SERVICE_NAME,
            ServiceAccess::START | ServiceAccess::QUERY_STATUS,
        )
        .map_err(|e| anyhow::anyhow!("Falha ao abrir serviço: {e}"))?;

    let status = service
        .query_status()
        .map_err(|e| anyhow::anyhow!("Falha ao consultar status: {e}"))?;

    if status.current_state == ServiceState::Running {
        log::info!(
            "[ServiceManager] O serviço '{}' já está em execução.",
            SERVICE_NAME
        );
        return Ok(());
    }

    service
        .start(&[OsString::from("--service")])
        .map_err(|e| anyhow::anyhow!("Falha ao iniciar o serviço: {e}"))?;

    // Aguarda transição para Running (até 10 segundos)
    let start_time = Instant::now();
    while start_time.elapsed() < Duration::from_secs(10) {
        if let Ok(st) = service.query_status() {
            if st.current_state == ServiceState::Running {
                log::info!(
                    "[ServiceManager] Serviço '{}' iniciado e em execução!",
                    SERVICE_NAME
                );
                return Ok(());
            }
        }
        sleep(Duration::from_millis(500));
    }

    log::warn!("[ServiceManager] Serviço iniciado, mas ainda não atingiu estado Running.");
    Ok(())
}

/// Para o serviço através do Service Control Manager
#[cfg(windows)]
pub fn stop_service() -> anyhow::Result<()> {
    log::info!("[ServiceManager] Parando serviço '{}'...", SERVICE_NAME);

    let manager_access = ServiceManagerAccess::CONNECT;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)
        .map_err(|e| anyhow::anyhow!("Falha ao conectar ao SCM: {e}"))?;

    let service = service_manager
        .open_service(
            SERVICE_NAME,
            ServiceAccess::STOP | ServiceAccess::QUERY_STATUS,
        )
        .map_err(|e| anyhow::anyhow!("Falha ao abrir serviço: {e}"))?;

    let status = service
        .query_status()
        .map_err(|e| anyhow::anyhow!("Falha ao consultar status: {e}"))?;

    if status.current_state == ServiceState::Stopped {
        log::info!(
            "[ServiceManager] O serviço '{}' já está parado.",
            SERVICE_NAME
        );
        return Ok(());
    }

    service
        .stop()
        .map_err(|e| anyhow::anyhow!("Falha ao enviar sinal de parada ao serviço: {e}"))?;

    // Aguarda transição para Stopped (até 10 segundos)
    let start_time = Instant::now();
    while start_time.elapsed() < Duration::from_secs(10) {
        if let Ok(st) = service.query_status() {
            if st.current_state == ServiceState::Stopped {
                log::info!(
                    "[ServiceManager] Serviço '{}' parado com sucesso.",
                    SERVICE_NAME
                );
                return Ok(());
            }
        }
        sleep(Duration::from_millis(500));
    }

    log::warn!("[ServiceManager] Sinal de parada enviado, aguardando finalização completa.");
    Ok(())
}

/// Consulta e formata o status atual do serviço
#[cfg(windows)]
pub fn status_service() -> anyhow::Result<String> {
    let manager_access = ServiceManagerAccess::CONNECT;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)
        .map_err(|e| anyhow::anyhow!("Falha ao conectar ao SCM: {e}"))?;

    let service = service_manager
        .open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS)
        .map_err(|e| {
            anyhow::anyhow!(
                "Serviço '{}' não está instalado ou inacessível: {e}",
                SERVICE_NAME
            )
        })?;

    let status = service
        .query_status()
        .map_err(|e| anyhow::anyhow!("Falha ao consultar status: {e}"))?;

    let state_str = match status.current_state {
        ServiceState::Running => "EM EXECUÇÃO (Running)",
        ServiceState::Stopped => "PARADO (Stopped)",
        ServiceState::StartPending => "INICIANDO (StartPending)",
        ServiceState::StopPending => "PARANDO (StopPending)",
        ServiceState::ContinuePending => "CONTINUANDO (ContinuePending)",
        ServiceState::PausePending => "PAUSANDO (PausePending)",
        ServiceState::Paused => "PAUSADO (Paused)",
    };

    let summary = format!(
        "Serviço: {}\nNome de Exibição: {}\nEstado Atual: {}\nPID: {:?}",
        SERVICE_NAME, SERVICE_DISPLAY_NAME, state_str, status.process_id
    );

    Ok(summary)
}

// Fallbacks para compilação cruzada em plataformas não-Windows
#[cfg(not(windows))]
pub fn install_service() -> anyhow::Result<()> {
    anyhow::bail!("Instalação de serviço suportada apenas em Windows");
}

#[cfg(not(windows))]
pub fn uninstall_service() -> anyhow::Result<()> {
    anyhow::bail!("Desinstalação de serviço suportada apenas em Windows");
}

#[cfg(not(windows))]
pub fn start_service() -> anyhow::Result<()> {
    anyhow::bail!("Início de serviço suportado apenas em Windows");
}

#[cfg(not(windows))]
pub fn stop_service() -> anyhow::Result<()> {
    anyhow::bail!("Parada de serviço suportada apenas em Windows");
}

#[cfg(not(windows))]
pub fn status_service() -> anyhow::Result<String> {
    Ok("Mock Service Status (Non-Windows)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_metadata_constants() {
        assert_eq!(SERVICE_NAME, "VeloDeskAgent");
        assert!(SERVICE_DISPLAY_NAME.contains("VeloDesk"));
        assert!(SERVICE_DESCRIPTION.contains("UAC"));
    }
}
