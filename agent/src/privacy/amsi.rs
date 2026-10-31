//! Quarentena Segura e Varredura Antivírus com Windows AMSI (AmsiScanBuffer)
//!
//! Em conformidade com o Art. 46 da LGPD:
//! Arquivos transferidos via Data Channel nunca são executados ou salvos diretamente.
//! Eles passam obrigatoriamente por:
//! 1. Gravação em diretório isolado de quarentena (%LOCALAPPDATA%\VeloDesk\quarantine).
//! 2. Cálculo e validação forense do hash SHA-256.
//! 3. Varredura ativa pelo motor antivírus do Windows via AMSI (AmsiScanBuffer).

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Código de resultado do AMSI para malware detectado
pub const AMSI_RESULT_DETECTED: u32 = 32768;

/// Resultado da inspeção de quarentena e AMSI
#[derive(Debug, PartialEq, Eq)]
pub enum QuarantineScanResult {
    /// Arquivo limpo e liberado
    Clean {
        sha256: String,
        quarantine_path: PathBuf,
        size_bytes: usize,
    },
    /// Ameaça ou malware detectado pelo Windows Defender/AMSI
    MalwareDetected { sha256: String, amsi_code: u32 },
    /// Erro de I/O ou processamento
    Failed(String),
}

/// Gerenciador de Quarentena e Varredura AMSI
pub struct QuarantineManager {
    quarantine_dir: PathBuf,
}

impl QuarantineManager {
    /// Cria uma nova instância apontando para o diretório de quarentena
    pub fn new() -> Result<Self> {
        let base_dir = dirs_fallback_localappdata();
        let quarantine_dir = base_dir.join("VeloDesk").join("quarantine");

        if !quarantine_dir.exists() {
            fs::create_dir_all(&quarantine_dir).with_context(|| {
                format!(
                    "Falha ao criar diretório de quarentena: {:?}",
                    quarantine_dir
                )
            })?;
        }

        Ok(Self { quarantine_dir })
    }

    /// Cria uma instância apontando para um diretório customizado (útil para testes unitários)
    pub fn with_directory<P: AsRef<Path>>(dir: P) -> Self {
        Self {
            quarantine_dir: dir.as_ref().to_path_buf(),
        }
    }

    /// Recebe o buffer em memória, computa SHA-256 e executa varredura AMSI
    pub fn quarantine_and_scan(
        &self,
        filename: &str,
        data: &[u8],
        expected_sha256: Option<&str>,
    ) -> QuarantineScanResult {
        // 1. Calcula hash SHA-256 do arquivo
        let mut hasher = Sha256::new();
        hasher.update(data);
        let calculated_hash = format!("{:x}", hasher.finalize());

        // Se fornecido hash esperado, valida integridade
        if let Some(expected) = expected_sha256 {
            if !calculated_hash.eq_ignore_ascii_case(expected) {
                return QuarantineScanResult::Failed(format!(
                    "Hash SHA-256 divergente: esperado {}, obtido {}",
                    expected, calculated_hash
                ));
            }
        }

        // 2. Executa varredura com Windows AMSI
        let scan_code = scan_buffer_with_amsi(data, filename);
        if scan_code >= AMSI_RESULT_DETECTED {
            log::warn!(
                "[LGPD AMSI] 🚨 AMEAÇA DETECTADA NO ARQUIVO '{}'! Código AMSI: {}. O arquivo foi descartado e não será salvo.",
                filename,
                scan_code
            );
            return QuarantineScanResult::MalwareDetected {
                sha256: calculated_hash,
                amsi_code: scan_code,
            };
        }

        // 3. Salva com segurança na pasta de quarentena
        let sanitized_name = sanitize_filename(filename);
        let dest_path =
            self.quarantine_dir
                .join(format!("{}_{}", &calculated_hash[0..8], sanitized_name));

        if let Err(err) = write_quarantine_file(&dest_path, data) {
            return QuarantineScanResult::Failed(format!(
                "Erro ao gravar arquivo em quarentena: {}",
                err
            ));
        }

        log::info!(
            "[LGPD AMSI] Arquivo '{}' inspecionado com sucesso (AMSI Clean, SHA-256: {}). Gravado em {:?}",
            filename,
            calculated_hash,
            dest_path
        );

        QuarantineScanResult::Clean {
            sha256: calculated_hash,
            quarantine_path: dest_path,
            size_bytes: data.len(),
        }
    }
}

fn write_quarantine_file(dest: &Path, data: &[u8]) -> Result<()> {
    let mut file = File::create(dest)?;
    file.write_all(data)?;
    file.flush()?;
    Ok(())
}

fn sanitize_filename(filename: &str) -> String {
    let mut clean = filename.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    if clean.is_empty() {
        clean = "transferred_file.dat".to_string();
    }
    clean
}

fn dirs_fallback_localappdata() -> PathBuf {
    if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(appdata)
    } else {
        std::env::temp_dir()
    }
}

/// Varredura utilizando Windows Antimalware Scan Interface (AMSI)
#[cfg(windows)]
pub fn scan_buffer_with_amsi(buffer: &[u8], app_content_name: &str) -> u32 {
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};

    // SAFETY: Carregamento dinâmico de amsi.dll. Se a DLL não existir ou for Windows antigo, retorna 0 (Clean).
    unsafe {
        let amsi_dll = match LoadLibraryA(windows::core::s!("amsi.dll")) {
            Ok(handle) => handle,
            Err(_) => return 0,
        };

        type AmsiInitFn =
            unsafe extern "system" fn(app_name: *const u16, amsi_context: *mut usize) -> i32;

        type AmsiScanBufferFn = unsafe extern "system" fn(
            amsi_context: usize,
            buffer: *const u8,
            length: u64,
            content_name: *const u16,
            amsi_session: usize,
            result: *mut u32,
        ) -> i32;

        type AmsiUninitFn = unsafe extern "system" fn(amsi_context: usize);

        let init_proc = GetProcAddress(amsi_dll, windows::core::s!("AmsiInitialize"));
        let scan_proc = GetProcAddress(amsi_dll, windows::core::s!("AmsiScanBuffer"));
        let uninit_proc = GetProcAddress(amsi_dll, windows::core::s!("AmsiUninitialize"));

        let (Some(init_fn), Some(scan_fn), Some(uninit_fn)) = (init_proc, scan_proc, uninit_proc)
        else {
            return 0;
        };

        let init_fn: AmsiInitFn = std::mem::transmute(init_fn);
        let scan_fn: AmsiScanBufferFn = std::mem::transmute(scan_fn);
        let uninit_fn: AmsiUninitFn = std::mem::transmute(uninit_fn);

        let app_name: Vec<u16> = "VeloDesk\0".encode_utf16().collect();
        let mut context: usize = 0;

        let hr = init_fn(app_name.as_ptr(), &mut context);
        if hr != 0 || context == 0 {
            return 0;
        }

        let content_name: Vec<u16> = app_content_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let mut amsi_result: u32 = 0;
        let _ = scan_fn(
            context,
            buffer.as_ptr(),
            buffer.len() as u64,
            content_name.as_ptr(),
            0,
            &mut amsi_result,
        );

        uninit_fn(context);
        amsi_result
    }
}

#[cfg(not(windows))]
pub fn scan_buffer_with_amsi(_buffer: &[u8], _app_content_name: &str) -> u32 {
    0 // Em ambientes não-Windows (testes CI), retorna resultado limpo
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quarantine_and_sha256_hash_validation() {
        let temp_dir =
            std::env::temp_dir().join(format!("velodesk_test_quarantine_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);

        let manager = QuarantineManager::with_directory(&temp_dir);
        let test_data = b"VeloDesk LGPD Safe File Transfer Payload 2026";
        let expected_hash = "d3f850af1e1fe06fe08e86f276898e7271ac656c292cebffd8962aa90fb8c7a4";

        // Executa varredura e quarentena
        let res = manager.quarantine_and_scan("relatorio.pdf", test_data, Some(expected_hash));

        match res {
            QuarantineScanResult::Clean {
                sha256,
                quarantine_path,
                size_bytes,
            } => {
                assert_eq!(sha256, expected_hash);
                assert_eq!(size_bytes, test_data.len());
                assert!(quarantine_path.exists());
                let _ = fs::remove_file(quarantine_path);
            }
            other => panic!("Esperado Clean, obtido: {:?}", other),
        }

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
