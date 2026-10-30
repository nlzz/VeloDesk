//! Monitoramento de Sessões do Windows e Notificações WTS.
//!
//! Gerencia a detecção da sessão interativa ativa no console (Session 1, 2...)
//! e o processamento de eventos do sistema operacional como Logon, Logoff,
//! Bloqueio e Desbloqueio (WTS_SESSION_LOCK, WTS_SESSION_UNLOCK, WTS_CONSOLE_CONNECT).

#[cfg(windows)]
use windows::Win32::Foundation::HWND;
#[cfg(windows)]
use windows::Win32::System::RemoteDesktop::{
    WTSGetActiveConsoleSessionId, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
};

/// Constantes de notificação de sessão da API Win32 WTS
pub const WTS_CONSOLE_CONNECT: u32 = 0x1;
pub const WTS_CONSOLE_DISCONNECT: u32 = 0x2;
pub const WTS_REMOTE_CONNECT: u32 = 0x3;
pub const WTS_REMOTE_DISCONNECT: u32 = 0x4;
pub const WTS_SESSION_LOGON: u32 = 0x5;
pub const WTS_SESSION_LOGOFF: u32 = 0x6;
pub const WTS_SESSION_LOCK: u32 = 0x7;
pub const WTS_SESSION_UNLOCK: u32 = 0x8;
pub const WTS_SESSION_REMOTE_CONTROL: u32 = 0x9;

/// Flag para receber eventos de todas as sessões ativas
pub const NOTIFY_FOR_ALL_SESSIONS: u32 = 1;
/// Flag para receber eventos apenas da sessão chamadora
pub const NOTIFY_FOR_THIS_SESSION: u32 = 0;

/// Eventos tipados de transição de sessão do Windows
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionNotificationEvent {
    /// O console físico foi conectado
    ConsoleConnect { session_id: u32 },
    /// O console físico foi desconectado
    ConsoleDisconnect { session_id: u32 },
    /// Uma sessão remota RDP conectou
    RemoteConnect { session_id: u32 },
    /// Uma sessão remota RDP desconectou
    RemoteDisconnect { session_id: u32 },
    /// Um usuário efetuou logon
    Logon { session_id: u32 },
    /// Um usuário efetuou logoff
    Logoff { session_id: u32 },
    /// A sessão do usuário foi bloqueada (Win+L / Secure Desktop)
    Lock { session_id: u32 },
    /// A sessão do usuário foi desbloqueada
    Unlock { session_id: u32 },
    /// Outro evento WTS não mapeado
    Other { event_code: u32, session_id: u32 },
}

impl SessionNotificationEvent {
    /// Retorna a ID da sessão associada ao evento
    pub fn session_id(&self) -> u32 {
        match *self {
            Self::ConsoleConnect { session_id }
            | Self::ConsoleDisconnect { session_id }
            | Self::RemoteConnect { session_id }
            | Self::RemoteDisconnect { session_id }
            | Self::Logon { session_id }
            | Self::Logoff { session_id }
            | Self::Lock { session_id }
            | Self::Unlock { session_id }
            | Self::Other { session_id, .. } => session_id,
        }
    }

    /// Indica se o evento requer reatachar o processo de captura e input
    pub fn requires_reattach(&self) -> bool {
        matches!(
            self,
            Self::ConsoleConnect { .. }
                | Self::Logon { .. }
                | Self::Lock { .. }
                | Self::Unlock { .. }
        )
    }
}

/// Converte códigos numéricos de eventos WTS para o enum tipado `SessionNotificationEvent`
pub fn parse_session_notification(event_code: u32, session_id: u32) -> SessionNotificationEvent {
    match event_code {
        WTS_CONSOLE_CONNECT => SessionNotificationEvent::ConsoleConnect { session_id },
        WTS_CONSOLE_DISCONNECT => SessionNotificationEvent::ConsoleDisconnect { session_id },
        WTS_REMOTE_CONNECT => SessionNotificationEvent::RemoteConnect { session_id },
        WTS_REMOTE_DISCONNECT => SessionNotificationEvent::RemoteDisconnect { session_id },
        WTS_SESSION_LOGON => SessionNotificationEvent::Logon { session_id },
        WTS_SESSION_LOGOFF => SessionNotificationEvent::Logoff { session_id },
        WTS_SESSION_LOCK => SessionNotificationEvent::Lock { session_id },
        WTS_SESSION_UNLOCK => SessionNotificationEvent::Unlock { session_id },
        other => SessionNotificationEvent::Other {
            event_code: other,
            session_id,
        },
    }
}

/// Consulta o ID da sessão de console física conectada atualmente.
///
/// Retorna `Some(session_id)` se houver uma sessão interativa ou `None` se nenhuma sessão ativa estiver vinculada.
#[cfg(windows)]
pub fn get_active_console_session_id() -> Option<u32> {
    // SAFETY:
    // WTSGetActiveConsoleSessionId é uma API de consulta pura que não recebe ponteiros
    // e retorna 0xFFFFFFFF (u32::MAX) caso não haja console ativo ou ocorra falha.
    let session_id = unsafe { WTSGetActiveConsoleSessionId() };
    if session_id == 0xFFFF_FFFF {
        None
    } else {
        Some(session_id)
    }
}

/// Implementação mock para plataformas não-Windows
#[cfg(not(windows))]
pub fn get_active_console_session_id() -> Option<u32> {
    Some(1)
}

/// RAII Guard para registrar e desregistrar notificações de sessão via `WTSRegisterSessionNotification`
#[cfg(windows)]
pub struct WtsSessionNotificationGuard {
    hwnd: HWND,
}

#[cfg(windows)]
impl WtsSessionNotificationGuard {
    /// Registra uma janela para receber mensagens WM_WTSSESSION_CHANGE
    pub fn register(hwnd: HWND, flags: u32) -> anyhow::Result<Self> {
        // SAFETY:
        // Passamos um handle HWND válido e a flag de notificação.
        // A API Win32 registra o ouvinte no subsistema WTS do Windows.
        unsafe { WTSRegisterSessionNotification(hwnd, flags) }
            .map_err(|e| anyhow::anyhow!("Falha ao registrar notificação de sessão WTS: {e}"))?;

        Ok(Self { hwnd })
    }
}

#[cfg(windows)]
impl Drop for WtsSessionNotificationGuard {
    fn drop(&mut self) {
        // SAFETY:
        // O desregistro é seguro e necessário para evitar que o Windows tente enviar
        // mensagens para uma janela que já foi destruída.
        unsafe {
            let _ = WTSUnRegisterSessionNotification(self.hwnd);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_session_notification_events() {
        let ev_lock = parse_session_notification(WTS_SESSION_LOCK, 2);
        assert_eq!(ev_lock, SessionNotificationEvent::Lock { session_id: 2 });
        assert_eq!(ev_lock.session_id(), 2);
        assert!(ev_lock.requires_reattach());

        let ev_unlock = parse_session_notification(WTS_SESSION_UNLOCK, 2);
        assert_eq!(
            ev_unlock,
            SessionNotificationEvent::Unlock { session_id: 2 }
        );
        assert!(ev_unlock.requires_reattach());

        let ev_connect = parse_session_notification(WTS_CONSOLE_CONNECT, 1);
        assert_eq!(
            ev_connect,
            SessionNotificationEvent::ConsoleConnect { session_id: 1 }
        );
        assert!(ev_connect.requires_reattach());

        let ev_logoff = parse_session_notification(WTS_SESSION_LOGOFF, 3);
        assert_eq!(
            ev_logoff,
            SessionNotificationEvent::Logoff { session_id: 3 }
        );
        assert!(!ev_logoff.requires_reattach());

        let ev_unknown = parse_session_notification(0x999, 1);
        assert_eq!(
            ev_unknown,
            SessionNotificationEvent::Other {
                event_code: 0x999,
                session_id: 1
            }
        );
    }

    #[test]
    fn test_get_active_console_session_id() {
        // Deve retornar Some(id) ou None sem panicar
        let session = get_active_console_session_id();
        println!("Console Session ID detectada: {session:?}");
    }
}
