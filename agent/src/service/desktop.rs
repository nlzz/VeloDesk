//! Detecção e Monitoramento de Transição de Desktops do Windows (UAC e Winlogon).
//!
//! No Windows, telas administrativas de Controle de Conta de Usuário (UAC Consent.exe)
//! e a tela de bloqueio do sistema operam no Secure Desktop ("Winlogon"), isolado do
//! desktop do usuário ("Default"). Este módulo detecta essas transições via `OpenInputDesktop`.

#[cfg(windows)]
use windows::Win32::Foundation::HANDLE;
#[cfg(windows)]
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_ACCESS_FLAGS,
    DESKTOP_CONTROL_FLAGS, HDESK, UOI_NAME,
};

/// Informações sobre o desktop de entrada ativo do Windows
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopInfo {
    /// Nome do desktop (ex: "Default", "Winlogon", "Screen-saver")
    pub name: String,
    /// Indica se é o Secure Desktop (UAC ou tela de bloqueio)
    pub is_secure_desktop: bool,
    /// Indica se é o desktop interativo padrão do usuário
    pub is_default: bool,
}

impl DesktopInfo {
    /// Cria uma nova instância de DesktopInfo
    pub fn new(name: &str) -> Self {
        let is_winlogon = name.eq_ignore_ascii_case("Winlogon");
        let is_default = name.eq_ignore_ascii_case("Default");
        Self {
            name: name.to_string(),
            is_secure_desktop: is_winlogon,
            is_default,
        }
    }
}

/// RAII Guard para fechamento automático do handle de desktop (`HDESK`)
#[cfg(windows)]
pub struct DesktopGuard {
    handle: HDESK,
}

#[cfg(windows)]
impl DesktopGuard {
    /// Cria um novo guard encapsulando o handle do desktop
    pub fn new(handle: HDESK) -> Self {
        Self { handle }
    }

    /// Retorna o handle bruto do desktop
    pub fn raw(&self) -> HDESK {
        self.handle
    }
}

#[cfg(windows)]
impl Drop for DesktopGuard {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            // SAFETY:
            // O handle foi obtido com sucesso através de OpenInputDesktop e está
            // ativo. O fechamento é obrigatório para evitar vazamento de objetos
            // de kernel USER na sessão de console.
            unsafe {
                let _ = CloseDesktop(self.handle);
            }
        }
    }
}

/// Obtém o nome do Desktop de Entrada ativo no momento.
///
/// Retorna `DesktopInfo` contendo o nome e sinalizador se está em Secure Desktop (UAC/Winlogon).
#[cfg(windows)]
pub fn get_active_input_desktop() -> anyhow::Result<DesktopInfo> {
    // Flag 0: sem herança, allow_other_threads: FALSE, acesso de leitura de objetos
    // DESKTOP_READOBJECTS (0x0001) | DESKTOP_WRITEOBJECTS (0x0080)
    const DESKTOP_READOBJECTS: u32 = 0x0001;

    // SAFETY:
    // Chamada a OpenInputDesktop consulta o desktop atualmente recebendo entrada do usuário
    // no Window Station atual (winsta0). É uma API segura da Win32 que retorna erro caso
    // o chamador não tenha permissão suficiente ou caso não haja desktop de entrada disponível.
    let h_desk = unsafe {
        OpenInputDesktop(
            DESKTOP_CONTROL_FLAGS(0),
            false,
            DESKTOP_ACCESS_FLAGS(DESKTOP_READOBJECTS),
        )
    }
    .map_err(|e| anyhow::anyhow!("Falha ao abrir Desktop de entrada ativo: {e}"))?;

    let guard = DesktopGuard::new(h_desk);

    // Buffer para armazenar o nome em UTF-16
    let mut buffer = [0u16; 256];
    let mut needed = 0u32;

    // SAFETY:
    // Passamos um buffer alocado na stack de 256 u16 (512 bytes) e seu tamanho exato.
    // GetUserObjectInformationW preenche a string UTF-16 terminada em nulo e escreve
    // o número de bytes necessários em `needed`.
    unsafe {
        GetUserObjectInformationW(
            HANDLE(guard.raw().0 as _),
            UOI_NAME,
            Some(buffer.as_mut_ptr() as *mut _),
            (buffer.len() * std::mem::size_of::<u16>()) as u32,
            Some(&mut needed),
        )
    }
    .map_err(|e| {
        anyhow::anyhow!(
            "Falha ao consultar nome do objeto desktop (GetUserObjectInformationW): {e}"
        )
    })?;

    // Procura o caractere nulo terminador
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    let desktop_name = String::from_utf16_lossy(&buffer[..len]);

    log::debug!(
        "[Desktop] Desktop de entrada ativo detectado: '{}'",
        desktop_name
    );
    Ok(DesktopInfo::new(&desktop_name))
}

/// Implementação mock para plataformas não-Windows
#[cfg(not(windows))]
pub fn get_active_input_desktop() -> anyhow::Result<DesktopInfo> {
    Ok(DesktopInfo::new("Default"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_desktop_info_classification() {
        let default_desktop = DesktopInfo::new("Default");
        assert!(default_desktop.is_default);
        assert!(!default_desktop.is_secure_desktop);

        let winlogon_desktop = DesktopInfo::new("Winlogon");
        assert!(!winlogon_desktop.is_default);
        assert!(winlogon_desktop.is_secure_desktop);

        let custom_desktop = DesktopInfo::new("CustomDesktop");
        assert!(!custom_desktop.is_default);
        assert!(!custom_desktop.is_secure_desktop);
    }

    #[test]
    #[cfg(windows)]
    fn test_get_active_input_desktop_call() {
        // Em ambiente de teste interativo, a chamada deve retornar ao menos um desktop válido
        // ou erro controlado de permissão, sem panicar.
        let result = get_active_input_desktop();
        match result {
            Ok(info) => {
                assert!(!info.name.is_empty());
                println!("Desktop ativo de teste: {}", info.name);
            }
            Err(e) => {
                println!("Aviso: OpenInputDesktop retornou erro (esperado se não houver console interativo): {e}");
            }
        }
    }
}
