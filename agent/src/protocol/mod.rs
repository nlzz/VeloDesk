//! Módulo de Protocolos de Comunicação do VeloDesk
//!
//! Subdividido em:
//! - `signaling`: Mensagens trocadas via WebSocket com o velodesk-server.
//! - `input`: Eventos de entrada trocados via WebRTC Data Channel de baixa latência.

pub mod input;
pub mod signaling;
