//! Módulo de leitura de metadados embutidos via PE Overlay (VeloDesk v2.0)
//!
//! Permite distribuir executáveis customizados para cada Tenant (White-Label)
//! anexando metadados após o final da imagem PE sem necessidade de recompilar o binário.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Assinatura mágica de 14 bytes para identificar o bloco de metadados do VeloDesk
pub const OVERLAY_MAGIC: &[u8; 14] = b"VD_OVERLAY_V1\0";

/// Metadados de configuração do Tenant injetados no final do instalador PE
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TenantOverlayMetadata {
    pub tenant_id: String,
    pub tenant_slug: String,
    pub tenant_name: String,
    pub server_url: String,
    #[serde(default)]
    pub primary_color: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub preassigned_tags: Vec<String>,
}

/// Lê e valida os metadados do PE Overlay a partir de um leitor com Seek
pub fn read_overlay_from_reader<R: Read + Seek>(
    mut reader: R,
) -> Result<Option<TenantOverlayMetadata>> {
    // 1. Valida cabeçalho DOS (MZ)
    let mut dos_header = [0u8; 64];
    if reader.read_exact(&mut dos_header).is_err() {
        return Ok(None);
    }

    if &dos_header[0..2] != b"MZ" {
        return Ok(None);
    }

    // Offset do cabeçalho PE (e_lfanew na posição 0x3C, little-endian 32-bit)
    let e_lfanew = u32::from_le_bytes([
        dos_header[0x3C],
        dos_header[0x3D],
        dos_header[0x3E],
        dos_header[0x3F],
    ]) as u64;

    reader
        .seek(SeekFrom::Start(e_lfanew))
        .context("Falha ao navegar para o cabeçalho PE")?;

    // Assinatura PE\0\0
    let mut pe_sig = [0u8; 4];
    reader
        .read_exact(&mut pe_sig)
        .context("Falha ao ler assinatura PE")?;
    if &pe_sig != b"PE\0\0" {
        return Ok(None);
    }

    // COFF Header (20 bytes)
    let mut coff_header = [0u8; 20];
    reader
        .read_exact(&mut coff_header)
        .context("Falha ao ler cabeçalho COFF")?;

    let number_of_sections = u16::from_le_bytes([coff_header[2], coff_header[3]]) as usize;
    let size_of_optional_header = u16::from_le_bytes([coff_header[16], coff_header[17]]) as u64;

    // Pula o Optional Header para chegar na tabela de seções
    reader
        .seek(SeekFrom::Current(size_of_optional_header as i64))
        .context("Falha ao navegar para Section Table")?;

    // Percorre as seções para encontrar a última em disco (maior PointerToRawData + SizeOfRawData)
    let mut max_raw_end: u64 = 0;
    for _ in 0..number_of_sections {
        let mut section_header = [0u8; 40];
        reader
            .read_exact(&mut section_header)
            .context("Falha ao ler cabeçalho de seção PE")?;

        let size_of_raw_data = u32::from_le_bytes([
            section_header[16],
            section_header[17],
            section_header[18],
            section_header[19],
        ]) as u64;

        let pointer_to_raw_data = u32::from_le_bytes([
            section_header[20],
            section_header[21],
            section_header[22],
            section_header[23],
        ]) as u64;

        let section_end = pointer_to_raw_data + size_of_raw_data;
        if section_end > max_raw_end {
            max_raw_end = section_end;
        }
    }

    // Tamanho total do arquivo
    let file_len = reader
        .seek(SeekFrom::End(0))
        .context("Falha ao obter tamanho do binário")?;

    // Se o arquivo for maior que o fim da última seção PE, existe um Overlay
    if file_len <= max_raw_end {
        return Ok(None);
    }

    let overlay_size = file_len - max_raw_end;
    if overlay_size < OVERLAY_MAGIC.len() as u64 + 4 {
        return Ok(None);
    }

    // Lê os dados do Overlay
    reader
        .seek(SeekFrom::Start(max_raw_end))
        .context("Falha ao posicionar início do overlay")?;
    let mut overlay_bytes = Vec::with_capacity(overlay_size as usize);
    reader
        .read_to_end(&mut overlay_bytes)
        .context("Falha ao ler bytes do overlay")?;

    // Verifica assinatura mágica no início do overlay
    if !overlay_bytes.starts_with(OVERLAY_MAGIC) {
        return Ok(None);
    }

    let payload_offset = OVERLAY_MAGIC.len();
    if overlay_bytes.len() < payload_offset + 4 {
        return Ok(None);
    }

    // Tamanho do JSON (4 bytes Little Endian)
    let payload_len = u32::from_le_bytes([
        overlay_bytes[payload_offset],
        overlay_bytes[payload_offset + 1],
        overlay_bytes[payload_offset + 2],
        overlay_bytes[payload_offset + 3],
    ]) as usize;

    let json_start = payload_offset + 4;
    let json_end = json_start + payload_len;
    if overlay_bytes.len() < json_end {
        bail!("Tamanho do payload de overlay excede os bytes disponíveis no arquivo");
    }

    let json_slice = &overlay_bytes[json_start..json_end];
    let metadata: TenantOverlayMetadata = serde_json::from_slice(json_slice)
        .context("Falha ao deserializar metadados JSON do PE Overlay")?;

    Ok(Some(metadata))
}

/// Helper para ler overlay a partir de um arquivo em disco
pub fn read_overlay_from_file<P: AsRef<Path>>(path: P) -> Result<Option<TenantOverlayMetadata>> {
    let file = File::open(path)?;
    read_overlay_from_reader(file)
}

/// Helper para anexar overlay a um binário PE existente (utilizado por ferramentas de empacotamento)
pub fn append_overlay_bytes(pe_bytes: &[u8], metadata: &TenantOverlayMetadata) -> Result<Vec<u8>> {
    let mut output = pe_bytes.to_vec();
    let json_data = serde_json::to_vec(metadata)?;
    let json_len = json_data.len() as u32;

    output.extend_from_slice(OVERLAY_MAGIC);
    output.extend_from_slice(&json_len.to_le_bytes());
    output.extend_from_slice(&json_data);

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_pe_overlay_detection_and_parsing() {
        // Constrói um PE mínimo sintético válido para teste
        let mut fake_pe = Vec::new();
        // DOS Header
        fake_pe.extend_from_slice(b"MZ");
        fake_pe.resize(0x3C, 0);
        fake_pe.extend_from_slice(&(0x80u32).to_le_bytes()); // e_lfanew = 128
        fake_pe.resize(0x80, 0);

        // PE Header
        fake_pe.extend_from_slice(b"PE\0\0");
        // COFF Header (20 bytes): 1 seção, size_of_optional_header = 0
        fake_pe.extend_from_slice(&[
            0x4C, 0x01, // Machine x86
            0x01, 0x00, // NumberOfSections = 1
            0, 0, 0, 0, // TimeDateStamp
            0, 0, 0, 0, // PointerToSymbolTable
            0, 0, 0, 0, // NumberOfSymbols
            0x00, 0x00, // SizeOfOptionalHeader = 0
            0x02, 0x01, // Characteristics
        ]);

        // Section Header (40 bytes)
        let mut section = [0u8; 40];
        section[0..5].copy_from_slice(b".text");
        // SizeOfRawData = 512
        section[16..20].copy_from_slice(&(512u32).to_le_bytes());
        // PointerToRawData = 1024
        section[20..24].copy_from_slice(&(1024u32).to_le_bytes());
        fake_pe.extend_from_slice(&section);

        // Preenche até 1024 + 512 = 1536
        fake_pe.resize(1536, 0x90);

        let original_meta = TenantOverlayMetadata {
            tenant_id: "tenant-uuid-1234".to_string(),
            tenant_slug: "escritorio-alfa".to_string(),
            tenant_name: "Escritório Alfa".to_string(),
            server_url: "wss://relay.alfa.velodesk.com".to_string(),
            primary_color: Some("#10B981".to_string()),
            group_id: None,
            preassigned_tags: vec!["Contábil".to_string(), "VIP".to_string()],
        };

        // Anexa o Overlay
        let executable_with_overlay = append_overlay_bytes(&fake_pe, &original_meta).unwrap();

        // Lê de volta usando o cursor
        let cursor = Cursor::new(executable_with_overlay);
        let extracted_meta = read_overlay_from_reader(cursor)
            .unwrap()
            .expect("Overlay não detectado");

        assert_eq!(extracted_meta, original_meta);
    }
}
