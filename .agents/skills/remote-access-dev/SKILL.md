---
name: remote-access-dev
description: >-
  Guia técnico e padrões de desenvolvimento para o sistema de acesso remoto VeloDesk (WebRTC, Rust Agent com WGC/DXGI, Signaling Server em Go, STUN/TURN Coturn e Viewer em Tauri/Web). Ative esta skill ao desenvolver, compilar, testar, debugar ou implantar componentes do VeloDesk.
---

# VeloDesk Development Skill (Playbook do Sistema)

Este guia padroniza a arquitetura, práticas de código, comandos de build e procedimentos operacionais para o desenvolvimento do **VeloDesk**, sistema proprietário de acesso e suporte remoto de alta performance.

Para a visão macro do projeto, consulte o arquivo mestre: [`macro.md`](../../macro.md).

---

## 1. Visão Geral da Arquitetura

O sistema é composto por 4 blocos fundamentais:

```
[ velodesk-agent (Rust) ] <== P2P WebRTC (80%) ==> [ velodesk-viewer (Tauri / Web) ]
          \                                                              /
           \=== Fallback: TURN Relay na VPS Staycloud (Coturn - 20%) ===/
                                         |
                       [ velodesk-server (Go / Fiber) ]
                            VPS (2 vCPUs / 4GB RAM)
```

1. **Host Agent (`velodesk-agent` em Rust):** Serviço Windows / Daemon Linux que realiza captura de tela acelerada por GPU, codifica em H.264 e transmite via WebRTC.
2. **Client Viewer (`velodesk-viewer` em Tauri v2 / Web PWA):** Interface gráfica do técnico para visualização com aceleração por hardware e envio de comandos de mouse/teclado.
3. **Signaling Server (`velodesk-server` em Go):** Mediação de sessões, autenticação (ID/Senha/Tokens) e troca de ofertas SDP e ICE Candidates via WebSockets.
4. **STUN/TURN Relay (`coturn`):** Servidor RFC 5389 / RFC 8656 na VPS Staycloud para descoberta de IP público (STUN) e retransmissão de pacotes cifrados fim-a-fim quando houver NAT simétrico.

---

## 2. Padrões de Implementação por Componente

### 2.1 Host Agent (Rust)

* **Diretório:** `agent/`
* **Crates Principais Recomendadas:**
  * `windows` (APIs Win32, D3D11, WGC, Session Management).
  * `libdatachannel-rs` ou `webrtc-rs` (transporte WebRTC sem dependência do libWebRTC Google).
  * `tokio` (runtime assíncrono).
  * `tokio-tungstenite` (comunicação WebSocket com o servidor de sinalização).
  * `serde` / `serde_json` (serialização de mensagens).
* **Pipeline de Captura no Windows:**
  1. Utilizar **Windows Graphics Capture (WGC)** como padrão prioritário (Windows 10/11).
  2. Inicializar `Direct3D11CaptureFramePool` associado ao monitor ativo.
  3. Desativar borda amarela: `capture_item.CreateCaptureSession()?.SetIsBorderRequired(false)`.
  4. Handoff zero-copy: passar a textura `ID3D11Texture2D` capturada diretamente para a Media Foundation Transform (MFT) H.264.
  5. Fallback: DXGI Desktop Duplication API (`IDXGIOutputDuplication`).
* **Tratamento de UAC / Secure Desktop:**
  * Rodar como serviço Windows (`NT AUTHORITY\SYSTEM`).
  * Monitorar transições de sessão com `WTSRegisterSessionNotification`.
  * Instanciar o processo de captura na sessão do console com o token do usuário logado e flag `uiAccess="true"` (exige assinatura de código).

### 2.2 Signaling Server (Go)

* **Diretório:** `server/`
* **Framework:** Go com **Fiber v2** ou **Echo** + `fasthttp/websocket` (ou `gorilla/websocket`).
* **Regras de Negócio:**
  * Cadastro e autenticação de agentes (ID numérico de 9 dígitos + hash de senha temporária ou token permanente).
  * Registro de presença (Heartbeat via WebSocket a cada 15s).
  * Roteamento de mensagens de sinalização:
    * `offer` (SDP)
    * `answer` (SDP)
    * `candidate` (ICE Candidate)
    * `disconnect`
  * Geração dinâmica de credenciais efêmeras TURN (Time-Window HMAC-SHA1).

### 2.3 Infraestrutura VPS (Coturn & Docker Compose na Staycloud)

* **Diretório:** `infra/`
* **Portas Obrigatórias na VPS:**
  * `3478` (UDP & TCP) -> STUN / TURN
  * `443` (TLS/TCP) -> TURN sobre TLS (evita bloqueio em firewalls restritivos)
  * `49152-65535` (UDP) -> Faixa de portas dinâmicas de relay do Coturn
  * `8080` ou `443` -> Signaling Server (WSS e Web PWA)
* **Regra de Ouro da VPS:** Nunca decodificar nem transcodificar vídeo na VPS. Manter consumo de CPU < 25%.

---

## 3. Protocolo de Comunicação WebRTC Data Channel

Para controle e interação remota, abrir dois canais SCTP:

1. **Canal de Input (`velodesk-input`):**
   * Configuração: `ordered: false, maxRetransmits: 0` (baixa latência, não bloqueante).
   * Formato das Mensagens (JSON binário ou MsgPack):
     ```json
     { "t": "mm", "x": 0.542, "y": 0.231 }       // Mouse Move (coordenadas normalizadas 0.0 - 1.0)
     { "t": "md", "b": 0 }                       // Mouse Down (0: Esquerdo, 1: Meio, 2: Direito)
     { "t": "mu", "b": 0 }                       // Mouse Up
     { "t": "kd", "c": "KeyA", "v": 65 }        // Key Down (ScanCode + Virtual Key)
     { "t": "ku", "c": "KeyA", "v": 65 }        // Key Up
     { "t": "wh", "dx": 0, "dy": -120 }          // Mouse Wheel
     ```

2. **Canal de Controle & Arquivos (`velodesk-control`):**
   * Configuração: `ordered: true` (confiável).
   * Uso: Clipboard sync, solicitação de chaveamento de monitores, transferência de arquivos fragmentados em chunks de 64KB com hash SHA-256.

---

## 4. Runbook de Comandos e Compilação

### Compilar o Host Agent (Windows):
```powershell
cd agent
cargo build --release
```

### Rodar o Signaling Server localmente (Go):
```powershell
cd server
go run cmd/server/main.go
```

### Iniciar a VPS com Docker Compose:
```bash
cd infra
docker compose up -d
```

### Testar Conectividade STUN/TURN:
Utilize ferramentas como o Trickle ICE do WebRTC (`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`) inserindo a URL `turn:HOST_DA_STAYCLOUD:3478` com as credenciais do Coturn.

---

## 5. Referências Adicionais

* Para o plano mestre do projeto: consulte [macro.md](../../macro.md).
* Para detalhes de fluxos e handshake WebRTC: consulte [architecture.md](./references/architecture.md).
* Para o passo a passo de configuração da VPS e hardening do Linux: consulte [vps_deployment.md](./references/vps_deployment.md).
