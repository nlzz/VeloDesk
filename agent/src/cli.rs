//! Parser e Roteador de Linha de Comando (CLI) do VeloDesk Agent.
//!
//! Gerencia comandos de instalação, remoção e controle do Windows Service,
//! configuração de credenciais Argon2id e opções do pipeline interativo de captura.

/// Comandos operacionais aceitos pela CLI do agente
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    /// Execução interativa normal do agente
    RunAgent,
    /// Execução com ícone na bandeja do sistema (System Tray) e suporte
    RunTray,
    /// Solicitação de suporte com 1 clique e anexo de print da tela
    RequestSupport,
    /// Exibe metadados embutidos via PE Overlay (se presentes)
    InspectOverlay,
    /// Instalação do agente como Windows Service com inicialização automática (AutoStart)
    InstallService,
    /// Remoção do agente do Windows Service Control Manager
    UninstallService,
    /// Inicialização do serviço via SCM
    StartService,
    /// Parada do serviço via SCM
    StopService,
    /// Consulta de status atual do serviço no Windows
    StatusService,
    /// Execução invocada diretamente pelo Service Control Manager (Session 0)
    RunAsService,
    /// Configuração e armazenamento seguro de senha permanente via Argon2id
    SetPassword(String),
    /// Exibição da mensagem de ajuda
    PrintHelp,
}

/// Parâmetros e opções operacionais extraídos da linha de comando
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOptions {
    /// Comando principal a executar
    pub command: CliCommand,
    /// URL do servidor de sinalização (opcional)
    pub server_url: Option<String>,
    /// ID customizado do agente (opcional)
    pub agent_id: Option<String>,
    /// Hash de senha para sinalização (opcional)
    pub password_hash: Option<String>,
    /// Taxa de quadros alvo por segundo (FPS)
    pub target_fps: Option<u32>,
    /// Taxa de bits alvo em bps
    pub target_bitrate: Option<u32>,
    /// Nome do desktop Win32 alvo (ex: "winsta0\\default", "winsta0\\winlogon")
    pub desktop: Option<String>,
    /// Sinalizador se está executando em modo interativo injetado
    pub is_interactive: bool,
}

impl Default for CliOptions {
    fn default() -> Self {
        Self {
            command: CliCommand::RunAgent,
            server_url: None,
            agent_id: None,
            password_hash: None,
            target_fps: None,
            target_bitrate: None,
            desktop: None,
            is_interactive: false,
        }
    }
}

/// Analisa a lista de argumentos passados via CLI e produz `CliOptions`
pub fn parse_cli_args<I, T>(args: I) -> anyhow::Result<CliOptions>
where
    I: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let mut options = CliOptions::default();
    let args_vec: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();

    let mut i = 1; // Pula o nome do executável
    while i < args_vec.len() {
        let arg = &args_vec[i];

        match arg.as_str() {
            "--install-service" => {
                options.command = CliCommand::InstallService;
                i += 1;
            }
            "--tray" => {
                options.command = CliCommand::RunTray;
                i += 1;
            }
            "--request-support" => {
                options.command = CliCommand::RequestSupport;
                i += 1;
            }
            "--overlay-info" => {
                options.command = CliCommand::InspectOverlay;
                i += 1;
            }
            "--uninstall-service" => {
                options.command = CliCommand::UninstallService;
                i += 1;
            }
            "--start" => {
                options.command = CliCommand::StartService;
                i += 1;
            }
            "--stop" => {
                options.command = CliCommand::StopService;
                i += 1;
            }
            "--status" => {
                options.command = CliCommand::StatusService;
                i += 1;
            }
            "--service" => {
                options.command = CliCommand::RunAsService;
                i += 1;
            }
            "--set-password" => {
                if i + 1 < args_vec.len() {
                    options.command = CliCommand::SetPassword(args_vec[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!(
                        "O parâmetro '--set-password' requer o valor da nova senha permanente."
                    );
                }
            }
            "--server" | "-s" => {
                if i + 1 < args_vec.len() {
                    options.server_url = Some(args_vec[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!("O parâmetro '--server' requer a URL do servidor.");
                }
            }
            "--id" => {
                if i + 1 < args_vec.len() {
                    options.agent_id = Some(args_vec[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!("O parâmetro '--id' requer o identificador de 9 dígitos.");
                }
            }
            "--password" | "-p" => {
                if i + 1 < args_vec.len() {
                    options.password_hash = Some(args_vec[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!("O parâmetro '--password' requer o hash de senha.");
                }
            }
            "--fps" => {
                if i + 1 < args_vec.len() {
                    let fps = args_vec[i + 1]
                        .parse::<u32>()
                        .map_err(|_| anyhow::anyhow!("Valor inválido para --fps"))?;
                    options.target_fps = Some(fps);
                    i += 2;
                } else {
                    anyhow::bail!("O parâmetro '--fps' requer o número de quadros por segundo.");
                }
            }
            "--bitrate" => {
                if i + 1 < args_vec.len() {
                    let bitrate = args_vec[i + 1]
                        .parse::<u32>()
                        .map_err(|_| anyhow::anyhow!("Valor inválido para --bitrate"))?;
                    options.target_bitrate = Some(bitrate);
                    i += 2;
                } else {
                    anyhow::bail!("O parâmetro '--bitrate' requer o valor da taxa em bps.");
                }
            }
            "--desktop" => {
                if i + 1 < args_vec.len() {
                    options.desktop = Some(args_vec[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!(
                        "O parâmetro '--desktop' requer o identificador de desktop Win32."
                    );
                }
            }
            "--interactive" => {
                options.is_interactive = true;
                i += 1;
            }
            "--help" | "-h" => {
                options.command = CliCommand::PrintHelp;
                i += 1;
            }
            other if other.starts_with("--server=") => {
                options.server_url = Some(other.trim_start_matches("--server=").to_string());
                i += 1;
            }
            other if other.starts_with("--id=") => {
                options.agent_id = Some(other.trim_start_matches("--id=").to_string());
                i += 1;
            }
            other if other.starts_with("--password=") => {
                options.password_hash = Some(other.trim_start_matches("--password=").to_string());
                i += 1;
            }
            other if other.starts_with("--desktop=") => {
                options.desktop = Some(other.trim_start_matches("--desktop=").to_string());
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    Ok(options)
}

/// Exibe o manual de utilização e comandos disponíveis na CLI do VeloDesk Agent
pub fn print_help() {
    println!("VeloDesk Host Agent v1.0.0 — Controle e Suporte Remoto de Alta Performance");
    println!("Uso: velodesk-agent [comando] [opções]");
    println!();
    println!("Gestão do Windows Service (Requer Administrador):");
    println!("  --install-service       Instala o agente como Windows Service com inicialização automática");
    println!("  --uninstall-service     Remove o serviço do Windows Service Control Manager");
    println!("  --start                 Inicia a execução do serviço via SCM");
    println!("  --stop                  Envia sinal de parada ao serviço via SCM");
    println!("  --status                Consulta o estado operacional do serviço no Windows");
    println!();
    println!("Acesso Autônomo e Segurança:");
    println!("  --set-password <SENHA>  Configura a senha permanente com derivação Argon2id em %ProgramData%\\VeloDesk");
    println!();
    println!("Opções de Execução Direta / Interativa:");
    println!("  --server, -s <URL>      URL WebSocket do servidor de sinalização (padrão: ws://127.0.0.1:8080/ws)");
    println!("  --id <ID>               Identificador de 9 dígitos customizado (ex: 832-192-041)");
    println!("  --password, -p <HASH>   Hash SHA-256 de autenticação com o servidor");
    println!("  --fps <NUM>             Taxa de quadros por segundo alvo (padrão: 60)");
    println!("  --bitrate <NUM>         Taxa de bits alvo em bps (padrão: 4000000 = 4 Mbps)");
    println!(
        "  --desktop <NOME>        Desktop Win32 alvo (ex: winsta0\\default, winsta0\\winlogon)"
    );
    println!("  --interactive           Indica execução vinculada a sessão interativa do usuário");
    println!("  --help, -h              Exibe esta mensagem de ajuda");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_service_commands() {
        let args = vec!["velodesk-agent", "--install-service"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::InstallService);

        let args = vec!["velodesk-agent", "--uninstall-service"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::UninstallService);

        let args = vec!["velodesk-agent", "--start"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::StartService);

        let args = vec!["velodesk-agent", "--stop"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::StopService);

        let args = vec!["velodesk-agent", "--status"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::StatusService);

        let args = vec!["velodesk-agent", "--service"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::RunAsService);
    }

    #[test]
    fn test_parse_set_password() {
        let args = vec!["velodesk-agent", "--set-password", "MasterAdminPass@2026"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(
            opts.command,
            CliCommand::SetPassword("MasterAdminPass@2026".to_string())
        );
    }

    #[test]
    fn test_parse_parameters() {
        let args = vec![
            "velodesk-agent",
            "--server",
            "wss://signaling.velodesk.com/ws",
            "--id",
            "111-222-333",
            "--fps",
            "120",
            "--bitrate",
            "6000000",
            "--desktop",
            "winsta0\\winlogon",
            "--interactive",
        ];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::RunAgent);
        assert_eq!(
            opts.server_url,
            Some("wss://signaling.velodesk.com/ws".to_string())
        );
        assert_eq!(opts.agent_id, Some("111-222-333".to_string()));
        assert_eq!(opts.target_fps, Some(120));
        assert_eq!(opts.target_bitrate, Some(6_000_000));
        assert_eq!(opts.desktop, Some("winsta0\\winlogon".to_string()));
        assert!(opts.is_interactive);
    }

    #[test]
    fn test_parse_help_command() {
        let args = vec!["velodesk-agent", "--help"];
        let opts = parse_cli_args(args).unwrap();
        assert_eq!(opts.command, CliCommand::PrintHelp);
    }
}
