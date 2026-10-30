# Arquitetura Detalhada do Sistema de Acesso Remoto

Este documento documenta os fluxos de mensagens, protocolos de segurança e técnicas de captura do sistema.

---

## 1. Fluxo de Sinalização (Handshake WebRTC)

```
Host (Agent)                Signaling Server (Go)              Viewer (Técnico)
     |                               |                                |
     |-- Register ID (ex: 832-192) ->|                                |
     |<- Registration ACK -----------|                                |
     |                               |                                |
     |                               |<- Connect Request (ID: 832-192)|
     |<- Incoming Session Request ---|                                |
     |-- Accept Session ------------>|                                |
     |                               |-- Session Accepted ----------->|
     |                               |                                |
     |-- SDP Offer (H.264 + Data) -->|                                |
     |                               |-- SDP Offer ------------------>|
     |                               |<- SDP Answer ------------------|
     |<- SDP Answer -----------------|                                |
     |                               |                                |
     |-- ICE Candidate 1 ----------->|                                |
     |                               |-- ICE Candidate 1 ------------>|
     |                               |<- ICE Candidate A -------------|
     |<- ICE Candidate A ------------|                                |
     |                               |                                |
     |============== WebRTC P2P Conectado (DTLS-SRTP) ===============|
```

---

## 2. Captura Windows Graphics Capture (WGC)

```cpp
// Pseudocódigo do pipeline WGC em Rust (windows-rs)
let interop = capture_item_statics.cast::<IGraphicsCaptureItemInterop>()?;
let item: GraphicsCaptureItem = interop.CreateForMonitor(hmonitor)?;

let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
    &d3d_device,
    DirectXPixelFormat::B8G8R8A8UIntNormalized,
    2, // Double buffering para baixa latência
    item.Size()?
)?;

let session = frame_pool.CreateCaptureSession(&item)?;
session.SetIsBorderRequired(false)?; // Desativa borda amarela
session.SetIsCursorCaptureEnabled(true)?; // Inclui ponteiro do mouse
session.StartCapture()?;
```

---

## 3. Segurança e Criptografia Fim-a-Fim (E2EE)

1. **DTLS 1.3 & SRTP:** Todo o fluxo de vídeo e áudio é criptografado ponto a ponto. Mesmo quando os pacotes passam pelo servidor TURN da VPS (Relay), a VPS é cega para o conteúdo (apenas repassa os pacotes IP criptografados sem possuir as chaves de sessão).
2. **Autenticação de Agentes:**
   * Senha aleatória descartável de 6 dígitos gerada a cada reinício de sessão.
   * Senha mestre criptografada em hash Argon2id para acesso autônomo (*unattended access*).
   * Suporte a 2FA e lista de permissões de IP no painel do técnico.
