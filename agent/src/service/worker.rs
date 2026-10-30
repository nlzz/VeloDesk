//! Implementação do ServiceMain, HandlerEx e Loop Operacional do Windows Service.
//!
//! Executa na Session 0 como NT AUTHORITY\SYSTEM, gerencia o ciclo de vida do serviço,
//! processa eventos de parada, desligamento e SessionChange (WTS), e supervisiona
//! o processo interativo do agente nos desktops "Default" e "Winlogon" (UAC).

#[cfg(windows)]
use std::ffi::OsString;
#[cfg(windows)]
use std::sync::mpsc::{self, Receiver, Sender};
#[cfg(windows)]
use std::time::Duration;

#[cfg(windows)]
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

#[cfg(windows)]
use super::desktop::get_active_input_desktop;
#[cfg(windows)]
use super::manager::SERVICE_NAME;
#[cfg(windows)]
use super::process::{spawn_agent_in_session, InteractiveAgentProcess};
#[cfg(windows)]
use super::session::get_active_console_session_id;
#[cfg(windows)]
use super::unattended::{load_service_config, save_service_config, ServiceConfig};

#[cfg(windows)]
define_windows_service!(ffi_service_main, my_service_main);

/// Eventos internos entregues ao supervisor de execução do serviço
#[cfg(windows)]
#[derive(Debug)]
enum ServiceEvent {
    /// Solicitação de parada ou desligamento do sistema operacional
    Shutdown,
    /// Notificação de mudança de sessão (WTS_SESSION_LOCK, UNLOCK, LOGON, CONNECT)
    SessionChanged { reason_raw: u32, session_id: u32 },
}

/// Ponto de entrada do serviço Windows disparado pelo Service Control Manager (SCM)
#[cfg(windows)]
pub fn run_service() -> anyhow::Result<()> {
    log::info!("[ServiceWorker] Inicializando despachante do Windows Service...");
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
        .map_err(|e| anyhow::anyhow!("Erro ao executar service_dispatcher::start: {e}"))
}

#[cfg(not(windows))]
pub fn run_service() -> anyhow::Result<()> {
    anyhow::bail!("O Windows Service só pode ser executado em ambiente Windows.");
}

/// Função ServiceMain invocada em background thread pelo SCM
#[cfg(windows)]
fn my_service_main(_arguments: Vec<OsString>) {
    if let Err(e) = run_service_worker() {
        log::error!("[ServiceWorker] Falha crítica na execução do serviço: {e}");
    }
}

/// Loop principal do serviço
#[cfg(windows)]
fn run_service_worker() -> windows_service::Result<()> {
    let (tx, rx): (Sender<ServiceEvent>, Receiver<ServiceEvent>) = mpsc::channel();
    let event_tx = tx.clone();

    // 1. Registra o manipulador de controle (HandlerEx)
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = event_tx.send(ServiceEvent::Shutdown);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::SessionChange(param) => {
                let _ = event_tx.send(ServiceEvent::SessionChanged {
                    reason_raw: param.reason.to_raw(),
                    session_id: param.notification.session_id,
                });
                ServiceControlHandlerResult::NoError
            }
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    // 2. Informa ao SCM que o serviço está em execução e aceita Stop, Shutdown e SessionChange
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP
            | ServiceControlAccept::SHUTDOWN
            | ServiceControlAccept::SESSION_CHANGE,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    log::info!("[ServiceWorker] Serviço VeloDesk operacional em Session 0 (SYSTEM).");

    // 3. Carrega configurações de acesso autônomo
    let config = match load_service_config(None) {
        Ok(cfg) => cfg,
        Err(_) => {
            let default_cfg = ServiceConfig::default();
            let _ = save_service_config(&default_cfg, None);
            default_cfg
        }
    };

    log::info!(
        "[ServiceWorker] Acesso autônomo ativado: {}. Agente ID: {}",
        config.unattended_enabled,
        config.agent_id
    );

    // 4. Loop de supervisão de processos interativos e transições de desktop
    let mut current_process: Option<InteractiveAgentProcess> = None;
    let mut last_session_id: Option<u32> = None;
    let mut last_desktop_name: String = String::new();

    loop {
        // Verifica se há sessão interativa de console ativa
        let active_session = get_active_console_session_id();
        let input_desktop = get_active_input_desktop().ok();

        let current_desktop_name = input_desktop
            .as_ref()
            .map(|d| d.name.clone())
            .unwrap_or_else(|| "Default".to_string());

        let needs_respawn = match (&current_process, active_session) {
            (None, Some(_)) => true,
            (Some(proc), Some(sess)) => {
                !proc.is_alive()
                    || last_session_id != Some(sess)
                    || last_desktop_name != current_desktop_name
            }
            (Some(_), None) => {
                // Console foi desconectado; encerra processo filho
                if let Some(mut proc) = current_process.take() {
                    proc.terminate();
                }
                last_session_id = None;
                last_desktop_name.clear();
                false
            }
            (None, None) => false,
        };

        if needs_respawn {
            if let Some(sess_id) = active_session {
                // Encerra processo filho anterior se ainda existir
                if let Some(mut proc) = current_process.take() {
                    proc.terminate();
                }

                log::info!(
                    "[ServiceWorker] Transição detectada! Sessão: {}, Desktop: '{}'",
                    sess_id,
                    current_desktop_name
                );

                // Monta argumentos adicionais para o processo interativo
                let server_arg = format!("--server={}", config.server_url);
                let id_arg = format!("--id={}", config.agent_id);
                let pass_arg = format!("--password={}", config.auth_token_sha256);
                let extra_args = [server_arg.as_str(), id_arg.as_str(), pass_arg.as_str()];

                match spawn_agent_in_session(sess_id, &current_desktop_name, &extra_args) {
                    Ok(proc) => {
                        current_process = Some(proc);
                        last_session_id = Some(sess_id);
                        last_desktop_name = current_desktop_name.clone();
                    }
                    Err(e) => {
                        log::warn!(
                            "[ServiceWorker] Não foi possível injetar agente interativo na sessão {sess_id}: {e}"
                        );
                    }
                }
            }
        }

        // Aguarda eventos de parada ou notificações de sessão (timeout de 1 segundo)
        match rx.recv_timeout(Duration::from_millis(1000)) {
            Ok(ServiceEvent::Shutdown) => {
                log::info!(
                    "[ServiceWorker] Sinal de parada/desligamento recebido. Finalizando serviço..."
                );
                break;
            }
            Ok(ServiceEvent::SessionChanged {
                reason_raw,
                session_id,
            }) => {
                log::info!(
                    "[ServiceWorker] Evento WTS recebido via HandlerEx: reason=0x{:X}, session_id={}",
                    reason_raw,
                    session_id
                );
                // Força reavaliação imediata no próximo ciclo
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Continua o loop de monitoramento
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }
    }

    // 5. Encerramento gracioso
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::StopPending,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 1,
        wait_hint: Duration::from_secs(5),
        process_id: None,
    })?;

    if let Some(mut proc) = current_process.take() {
        proc.terminate();
    }

    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    log::info!("[ServiceWorker] Serviço VeloDesk finalizado com sucesso.");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_worker_service_name_constant() {
        assert_eq!(crate::service::manager::SERVICE_NAME, "VeloDeskAgent");
    }
}
