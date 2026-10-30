//! Parser e manipulador de NAL Units (H.264 / Annex B).
//!
//! Segmenta e extrai conjuntos de parâmetros SPS, PPS e fatias de vídeo IDR / Non-IDR.

/// Tipos de NAL Unit do padrão H.264 (ITU-T H.264 / ISO/IEC 14496-10)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NaluType {
    /// Fatia não-IDR (P-Frame ou B-Frame)
    SliceNonIdr,
    /// Fatia IDR (Keyframe / I-Frame)
    SliceIdr,
    /// Informações adicionais (Supplemental Enhancement Information)
    Sei,
    /// Sequence Parameter Set (SPS)
    Sps,
    /// Picture Parameter Set (PPS)
    Pps,
    /// Outros tipos não discriminados
    Other(u8),
}

impl From<u8> for NaluType {
    fn from(b: u8) -> Self {
        match b & 0x1F {
            1 => NaluType::SliceNonIdr,
            5 => NaluType::SliceIdr,
            6 => NaluType::Sei,
            7 => NaluType::Sps,
            8 => NaluType::Pps,
            other => NaluType::Other(other),
        }
    }
}

/// Representa uma NAL Unit individual extraída de um fluxo Annex B
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Nalu {
    /// Tipo da NAL Unit
    pub nalu_type: NaluType,
    /// Dados binários brutos da NAL Unit (sem o start code)
    pub data: Vec<u8>,
}

impl Nalu {
    /// Indica se esta NALU é um keyframe ou parâmetro de decodificação crítico
    pub fn is_keyframe(&self) -> bool {
        matches!(
            self.nalu_type,
            NaluType::SliceIdr | NaluType::Sps | NaluType::Pps
        )
    }
}

/// Analisador e particionador de fluxos de vídeo no formato Annex B
#[derive(Debug, Default)]
pub struct NaluParser {
    cached_sps: Option<Vec<u8>>,
    cached_pps: Option<Vec<u8>>,
}

impl NaluParser {
    /// Cria uma nova instância do analisador
    pub fn new() -> Self {
        Self::default()
    }

    /// Analisa um buffer Annex B e retorna a lista de NAL Units encontradas
    pub fn parse_annex_b(&mut self, data: &[u8]) -> Vec<Nalu> {
        let mut nalus = Vec::new();
        let starts = find_annex_b_start_codes(data);

        for i in 0..starts.len() {
            let (start_idx, code_len) = starts[i];
            let nalu_start = start_idx + code_len;
            let nalu_end = if i + 1 < starts.len() {
                starts[i + 1].0
            } else {
                data.len()
            };

            if nalu_start < nalu_end && nalu_start < data.len() {
                let nalu_data = &data[nalu_start..nalu_end];
                if !nalu_data.is_empty() {
                    let nalu_type = NaluType::from(nalu_data[0]);

                    match nalu_type {
                        NaluType::Sps => self.cached_sps = Some(nalu_data.to_vec()),
                        NaluType::Pps => self.cached_pps = Some(nalu_data.to_vec()),
                        _ => {}
                    }

                    nalus.push(Nalu {
                        nalu_type,
                        data: nalu_data.to_vec(),
                    });
                }
            }
        }

        nalus
    }

    /// Retorna o SPS em cache (se houver)
    pub fn sps(&self) -> Option<&[u8]> {
        self.cached_sps.as_deref()
    }

    /// Retorna o PPS em cache (se houver)
    pub fn pps(&self) -> Option<&[u8]> {
        self.cached_pps.as_deref()
    }
}

/// Localiza os índices de início e comprimentos de todos os start codes (3 ou 4 bytes)
fn find_annex_b_start_codes(data: &[u8]) -> Vec<(usize, usize)> {
    let mut starts = Vec::new();
    let len = data.len();
    let mut i = 0;

    while i + 2 < len {
        if data[i] == 0x00 && data[i + 1] == 0x00 {
            if data[i + 2] == 0x01 {
                starts.push((i, 3));
                i += 3;
                continue;
            } else if i + 3 < len && data[i + 2] == 0x00 && data[i + 3] == 0x01 {
                starts.push((i, 4));
                i += 4;
                continue;
            }
        }
        i += 1;
    }

    starts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_start_codes() {
        let stream = [
            0x00, 0x00, 0x00, 0x01, 0x67, 0x42, // SPS (4 bytes start code)
            0x00, 0x00, 0x01, 0x68, 0xCE, // PPS (3 bytes start code)
            0x00, 0x00, 0x00, 0x01, 0x65, 0x88, // IDR (4 bytes start code)
        ];

        let mut parser = NaluParser::new();
        let nalus = parser.parse_annex_b(&stream);

        assert_eq!(nalus.len(), 3);
        assert_eq!(nalus[0].nalu_type, NaluType::Sps);
        assert_eq!(nalus[1].nalu_type, NaluType::Pps);
        assert_eq!(nalus[2].nalu_type, NaluType::SliceIdr);

        assert!(parser.sps().is_some());
        assert!(parser.pps().is_some());
    }

    #[test]
    fn test_nalu_is_keyframe() {
        let idr = Nalu {
            nalu_type: NaluType::SliceIdr,
            data: vec![0x65],
        };
        let non_idr = Nalu {
            nalu_type: NaluType::SliceNonIdr,
            data: vec![0x41],
        };

        assert!(idr.is_keyframe());
        assert!(!non_idr.is_keyframe());
    }
}
