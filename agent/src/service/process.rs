//! Injeção e Gerenciamento de Processos Interativos na Sessão Ativa do Windows.
//!
//! O serviço Windows (executando na Session 0 como NT AUTHORITY\SYSTEM) utiliza
//! `WTSQueryUserToken`, `DuplicateTokenEx` e `CreateProcessAsUserW` para iniciar
//! o agente interativo na sessão ativa do console com acesso à interface gráfica
//! e desktops administrativos (UAC / Winlogon).

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::mem::zeroed;
#[cfg(windows)]
use windows::core::PWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows::Win32::Security::{
    DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS,
};
#[cfg(windows)]
use windows::Win32::System::RemoteDesktop::WTSQueryUserToken;
#[cfg(windows)]
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, GetExitCodeProcess, TerminateProcess, PROCESS_CREATION_FLAGS,
    PROCESS_INFORMATION, STARTUPINFOW,
};

/// RAII Guard para fechamento automático de Handles Win32
#[cfg(windows)]
pub struct HandleGuard {
    handle: HANDLE,
}

#[cfg(windows)]
impl HandleGuard {
    /// Cria um novo guard encapsulando o HANDLE
    pub fn new(handle: HANDLE) -> Self {
        Self { handle }
    }

    /// Retorna o HANDLE bruto
    pub fn raw(&self) -> HANDLE {
        self.handle
    }

    /// Libera o HANDLE sem fechar ao sair do escopo
    pub fn into_raw(mut self) -> HANDLE {
        let h = self.handle;
        self.handle = HANDLE::default();
        h
    }
}

#[cfg(windows)]
impl Drop for HandleGuard {
    fn drop(&mut self) {
        if !self.handle.is_invalid() && !self.handle.0.is_null() {
            // SAFETY:
            // O handle é válido e exclusivo deste guard. Fechamos via CloseHandle
            // para evitar vazamento de descritores de kernel.
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }
}

/// Representa um processo interativo do agente instanciado pelo serviço
#[derive(Debug)]
pub struct InteractiveAgentProcess {
    /// ID do processo (PID)
    pub pid: u32,
    /// ID da sessão na qual o processo está ativo
    pub session_id: u32,
    /// Desktop ao qual o processo está vinculado (ex: "winsta0\\default" ou "winsta0\\winlogon")
    pub desktop: String,
    #[cfg(windows)]
    process_handle: HANDLE,
    #[cfg(windows)]
    thread_handle: HANDLE,
}

impl InteractiveAgentProcess {
    /// Verifica se o processo filho ainda está em execução
    #[cfg(windows)]
    pub fn is_alive(&self) -> bool {
        if self.process_handle.is_invalid() || self.process_handle.0.is_null() {
            return false;
        }

        let mut exit_code = 0u32;
        // SAFETY:
        // Passamos um handle de processo válido e um ponteiro alocado na stack.
        // GetExitCodeProcess é uma consulta sem efeitos colaterais.
        let ok = unsafe { GetExitCodeProcess(self.process_handle, &mut exit_code) };
        if ok.is_err() {
            return false;
        }

        // STILL_ACTIVE = 259
        exit_code == 259
    }

    #[cfg(not(windows))]
    pub fn is_alive(&self) -> bool {
        false
    }

    /// Encerra forçadamente o processo caso ainda esteja ativo
    #[cfg(windows)]
    pub fn terminate(&mut self) {
        if self.is_alive() {
            log::info!("[Process] Encerrando processo filho PID {}", self.pid);
            // SAFETY:
            // Encerramento forçado de processo filho pertencente ao serviço.
            unsafe {
                let _ = TerminateProcess(self.process_handle, 1);
            }
        }
    }

    #[cfg(not(windows))]
    pub fn terminate(&mut self) {}
}

#[cfg(windows)]
impl Drop for InteractiveAgentProcess {
    fn drop(&mut self) {
        // Fecha os descritores do processo e thread
        if !self.process_handle.is_invalid() && !self.process_handle.0.is_null() {
            // SAFETY: CloseHandle em descritor válido
            unsafe {
                let _ = CloseHandle(self.process_handle);
            }
        }
        if !self.thread_handle.is_invalid() && !self.thread_handle.0.is_null() {
            // SAFETY: CloseHandle em descritor válido
            unsafe {
                let _ = CloseHandle(self.thread_handle);
            }
        }
    }
}

/// Cria o processo interativo do agente na sessão de usuário indicada.
///
/// Duplica o token de segurança da sessão interativa e executa `velodesk-agent`
/// associado ao desktop alvo (`winsta0\default` ou `winsta0\winlogon`).
#[cfg(windows)]
pub fn spawn_agent_in_session(
    session_id: u32,
    desktop_name: &str,
    extra_args: &[&str],
) -> anyhow::Result<InteractiveAgentProcess> {
    log::info!(
        "[Process] Instanciando agente interativo na Session {} (Desktop: {})",
        session_id,
        desktop_name
    );

    // 1. Obter o token primário da sessão interativa
    let mut raw_user_token = HANDLE::default();
    // SAFETY:
    // WTSQueryUserToken consulta o token primário de autenticação do usuário logado na session_id.
    // Retorna erro se nenhum usuário estiver autenticado ainda (ex: Session 0 ou tela de logon inicial).
    unsafe { WTSQueryUserToken(session_id, &mut raw_user_token) }
        .map_err(|e| anyhow::anyhow!("Falha ao consultar token da sessão {session_id}: {e}"))?;

    let user_token_guard = HandleGuard::new(raw_user_token);

    // 2. Duplicar o token com privilégios primários completos
    let mut duplicated_token = HANDLE::default();
    // SAFETY:
    // DuplicateTokenEx cria um novo Primary Token independente com TOKEN_ALL_ACCESS,
    // permitindo a passagem para CreateProcessAsUserW.
    unsafe {
        DuplicateTokenEx(
            user_token_guard.raw(),
            TOKEN_ALL_ACCESS,
            None,
            SecurityImpersonation,
            TokenPrimary,
            &mut duplicated_token,
        )
    }
    .map_err(|e| anyhow::anyhow!("Falha ao duplicar token para criação de processo: {e}"))?;

    let dup_token_guard = HandleGuard::new(duplicated_token);

    // 3. Montar a linha de comando para o processo filho
    let current_exe = env::current_exe()
        .map_err(|e| anyhow::anyhow!("Falha ao obter caminho do executável do agente: {e}"))?;

    let full_desktop = if desktop_name.contains('\\') {
        desktop_name.to_string()
    } else {
        format!("winsta0\\{desktop_name}")
    };

    let mut cmd_str = format!(
        "\"{}\" --interactive --desktop \"{}\"",
        current_exe.display(),
        full_desktop
    );
    for arg in extra_args {
        cmd_str.push(' ');
        cmd_str.push_str(arg);
    }

    log::debug!("[Process] Linha de comando para injeção: {}", cmd_str);

    // Formatar strings UTF-16 para as APIs Win32
    let mut cmd_utf16: Vec<u16> = cmd_str.encode_utf16().chain(std::iter::once(0)).collect();
    let mut desktop_utf16: Vec<u16> = full_desktop
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    // 4. Configurar STARTUPINFOW
    // SAFETY: Inicialização segura de struct C com zeroed
    let mut si: STARTUPINFOW = unsafe { zeroed() };
    si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    si.lpDesktop = PWSTR(desktop_utf16.as_mut_ptr());

    // SAFETY: Inicialização de PROCESS_INFORMATION
    let mut pi: PROCESS_INFORMATION = unsafe { zeroed() };

    // 5. Instanciar o processo na sessão do console
    // SAFETY:
    // CreateProcessAsUserW executa o processo com o token primário da sessão interativa,
    // herdando o contexto de segurança e desktop correspondentes.
    unsafe {
        CreateProcessAsUserW(
            Some(dup_token_guard.raw()),
            windows::core::PCWSTR::null(),
            Some(PWSTR(cmd_utf16.as_mut_ptr())),
            None,
            None,
            false,
            PROCESS_CREATION_FLAGS(0),
            None,
            windows::core::PCWSTR::null(),
            &si,
            &mut pi,
        )
    }
    .map_err(|e| anyhow::anyhow!("CreateProcessAsUserW falhou na sessão {session_id}: {e}"))?;

    log::info!(
        "[Process] Agente interativo iniciado com sucesso! PID: {}",
        pi.dwProcessId
    );

    Ok(InteractiveAgentProcess {
        pid: pi.dwProcessId,
        session_id,
        desktop: full_desktop,
        process_handle: pi.hProcess,
        thread_handle: pi.hThread,
    })
}

/// Implementação mock para plataformas não-Windows
#[cfg(not(windows))]
pub fn spawn_agent_in_session(
    session_id: u32,
    desktop_name: &str,
    _extra_args: &[&str],
) -> anyhow::Result<InteractiveAgentProcess> {
    Ok(InteractiveAgentProcess {
        pid: 12345,
        session_id,
        desktop: desktop_name.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interactive_process_mock_or_structure() {
        let proc = InteractiveAgentProcess {
            pid: 9999,
            session_id: 1,
            desktop: "winsta0\\default".to_string(),
            #[cfg(windows)]
            process_handle: HANDLE::default(),
            #[cfg(windows)]
            thread_handle: HANDLE::default(),
        };

        assert_eq!(proc.pid, 9999);
        assert_eq!(proc.session_id, 1);
        assert_eq!(proc.desktop, "winsta0\\default");
        assert!(!proc.is_alive());
    }
}
