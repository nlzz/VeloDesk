# MACRO.MD — VeloDesk: Sistema de Acesso e Suporte Remoto de Alta Performance

> **Documento Mestre de Arquitetura, Especificação Técnica e Guia de Execução Autônoma**  
> *Este documento foi estruturado para que qualquer agente de IA ou desenvolvedor possa iniciar um repositório limpo e construir o VeloDesk de ponta a ponta sem ambiguidades.*

---

## 1. Visão Geral e Filosofia do Projeto

**VeloDesk** é uma solução moderna, proprietária e ultraleve de controle e suporte remoto (estilo RustDesk / AnyDesk), projetada para:
1. **Latência "Glass-to-Glass" Mínima (15 a 40 ms a 60 FPS):** Captura direta na VRAM da GPU via **Windows Graphics Capture (WGC)** e codificação por hardware **H.264**, com zero cópias desnecessárias na memória RAM.
2. **Conectividade P2P Direta com Fallback Seguro:** Uso nativo de **WebRTC (DTLS-SRTP)** com descoberta de IP via STUN (80% das sessões conectam direto P2P sem gastar tráfego do servidor). Fallback automático para **TURN Relay** na VPS Staycloud quando houver NAT simétrico.
3. **Pegada Mínima de Recursos na VPS (2 vCPUs e 4GB RAM):** O servidor de sinalização e relay opera estritamente como *Packet Forwarder* (zero-copy), suportando dezenas de milhares de agentes e centenas de conexões simultâneas consumindo < 25% de CPU e < 400MB de RAM.
4. **Agente Host Leve e Resiliente:** Construído em **Rust**, binário único (< 15 MB), consumo de ~20 MB de RAM em repouso e sem pausas de Garbage Collection.

---

## 2. Topologia do Sistema e Componentes

O projeto é dividido em quatro subprojetos independentes:

```
                                +---------------------------------------------+
                                |          VPS Staycloud (2 vCPU / 4GB)       |
                                |                                             |
                                |  [velodesk-server] (Go / Signaling WSS)     |
                                |  [coturn] (STUN/TURN UDP:3478 & TLS:443)    |
                                +----------------------+----------------------+
                                                       |
                             Troca de SDP / ICE        |      Troca de SDP / ICE
                         +-----------------------------+-----------------------------+
                         |                                                           |
                         v                                                           v
+-----------------------------------------------+           +-----------------------------------------------+
|         Host Remoto (velodesk-agent)          |           |          Operador (velodesk-viewer)           |
|                                               |           |                                               |
| • Windows Service (Session 0 - SYSTEM)        |           | • Desktop: Tauri v2 (Rust + Svelte/React)     |
| • Interactive Agent (Sessão do Usuário)       |  == P2P = | • Web: PWA Zero-Install no Navegador          |
| • Captura WGC (GPU D3D11 Surface)             |  (80%)    | • Player <video> acelerado por Hardware       |
| • Encoder H.264 (Media Foundation MFT)        |           | • Normalizador de Mouse e ScanCodes           |
| • Injeção Win32 SendInput                     |           |                                               |
+-----------------------------------------------+           +-----------------------------------------------+
                         \                                                           /
                          \========= Fallback Relay: Tráfego Cifrado (20%) =========/
```

### 2.1 `velodesk-agent` (Host Remoto - Rust)
* **Local:** `agent/`
* **Função:** Capturar a tela a 60 FPS, comprimir em H.264, transmitir via WebRTC, receber comandos de entrada do operador e injetar eventos de mouse/teclado.
* **Arquitetura Dual para UAC/Secure Desktop:**
  * **Serviço Windows (`velodesk-service`):** Roda na `Session 0` como `SYSTEM`. Monitora eventos de logon/logoff e telas administrativas via `WTSRegisterSessionNotification`.
  * **Processo Gráfico (`velodesk-agent`):** Injetado na sessão ativa do usuário com permissão `uiAccess="true"` para garantir que o mouse/teclado funcione mesmo em caixas de diálogo do UAC e telas de bloqueio.

### 2.2 `velodesk-server` (Sinalização e Autenticação - Go)
* **Local:** `server/`
* **Função:** 
  * Manter conexões WebSocket com os agentes online (Heartbeats periódicos).
  * Gerenciar IDs únicos de pareamento (ex: `123-456-789`) e senhas descartáveis / permanentes.
  * Intermediar a troca de mensagens WebRTC (`offer`, `answer`, `candidate`).
  * Gerar credenciais efêmeras de acesso ao servidor TURN (HMAC-SHA1).
  * Servir a interface Web do visualizador (Web Client PWA).

### 2.3 `velodesk-viewer` (Interface do Técnico - Tauri v2 & Web)
* **Local:** `viewer/`
* **Função:** 
  * Conectar ao agente pelo ID e senha.
  * Renderizar o fluxo de vídeo H.264 diretamente em uma tag `<video>` utilizando a aceleração nativa da GPU pelo WebView2 (Windows) ou WebKit (Linux/macOS).
  * Capturar movimento de mouse normalizado (coordenadas percentuais de `0.0` a `1.0`), cliques e eventos de teclado físico (ScanCodes), enviando via Data Channel de baixa latência.

### 2.4 `infra` (Deploy na VPS Staycloud)
* **Local:** `infra/`
* **Serviços:** Docker Compose contendo o **Coturn** (STUN/TURN) e o **velodesk-server** com certificados SSL/TLS provisionados para o hostname fornecido pela Staycloud.

---

## 3. Especificação do Protocolo de Comunicação

### 3.1 Mensagens de Sinalização (WebSockets)

Formato JSON trafegado sobre WebSocket seguro (`wss://`):

```json
// 1. Agente registra presença ao iniciar
{ "type": "register", "agent_id": "832-192-041", "version": "1.0.0", "hostname": "Sim-SRV" }

// 2. Operador solicita conexão
{ "type": "connect_request", "target_id": "832-192-041", "password_hash": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3" }

// 3. Servidor envia solicitação ao agente (se senha válida)
{ "type": "incoming_connection", "session_id": "sess_uuid_xyz", "operator_info": "Suporte SimContábil" }

// 4. Troca de Oferta SDP (Host para Viewer)
{ "type": "webrtc_offer", "session_id": "sess_uuid_xyz", "sdp": "v=0\r\no=- 12345 2 IN IP4 127.0.0.1..." }

// 5. Troca de Resposta SDP (Viewer para Host)
{ "type": "webrtc_answer", "session_id": "sess_uuid_xyz", "sdp": "v=0\r\no=- 67890 2 IN IP4 127.0.0.1..." }

// 6. Candidatos ICE (Troca bidirecional)
{ "type": "ice_candidate", "session_id": "sess_uuid_xyz", "candidate": "candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host..." }
```

### 3.2 Protocolo do WebRTC Data Channel (Input de Baixa Latência)

Canal: `velodesk-input` (Configuração: `ordered: false`, `maxRetransmits: 0`):

| Tipo (`t`) | Descrição | Payload Exemplo |
| :--- | :--- | :--- |
| `mm` | Mouse Move (normalizado 0.0 a 1.0) | `{"t":"mm","x":0.4512,"y":0.8931}` |
| `md` | Mouse Down (botão: 0=Esq, 1=Meio, 2=Dir) | `{"t":"md","b":0}` |
| `mu` | Mouse Up | `{"t":"mu","b":0}` |
| `kd` | Key Down (código físico + Virtual Key) | `{"t":"kd","c":"KeyA","v":65}` |
| `ku` | Key Up | `{"t":"ku","c":"KeyA","v":65}` |
| `wh` | Mouse Wheel (scroll vertical/horizontal) | `{"t":"wh","dx":0,"dy":-120}` |

Canal: `velodesk-control` (Configuração: `ordered: true`, confiável):
* Utilizado para sincronização de área de transferência (Clipboard text/image), solicitação de troca de monitor (`switch_monitor`) e transferência de arquivos em blocos de 64 KB com validação de checksum.

---

## 4. Roteiro de Implementação em Novo Repositório

Ao criar o repositório `velodesk`, a execução deve seguir rigorosamente as etapas:

### Fase 1: Infraestrutura e Servidor de Sinalização (Go + Docker)
1. Criar o diretório `server/` e inicializar o módulo Go (`go mod init velodesk-server`).
2. Implementar o servidor WebSocket com gestão de salas, roteamento de IDs e geração de credenciais TURN via HMAC.
3. Criar `infra/docker-compose.yml` e `infra/turnserver.conf` para subir na VPS Staycloud:
   * Portas: `3478/udp`, `3478/tcp`, `443/tcp` (TURN TLS), faixa dinâmica `49152-65535/udp`.
4. Validar o STUN/TURN com a ferramenta online Trickle ICE.

### Fase 2: Agent em Rust (Captura de Vídeo e WebRTC)
1. Criar `agent/` e inicializar o projeto Cargo (`cargo init --bin`).
2. Configurar dependências: `windows` (DirectX/Win32), `webrtc-rs` ou `libdatachannel-rs`, `tokio`, `tokio-tungstenite`.
3. Implementar módulo de captura:
   * Prioridade 1: **Windows Graphics Capture (WGC)** via `Direct3D11CaptureFramePool`.
   * Desativar borda: `SetIsBorderRequired(false)`.
   * Fallback: DXGI Desktop Duplication API.
4. Conectar a superfície D3D11 ao encoder H.264 do Windows Media Foundation (MFT).
5. Enviar a faixa H.264 pelo WebRTC PeerConnection e escutar o canal `velodesk-input` executando chamadas Win32 `SendInput()`.

### Fase 3: Visualizador (Viewer) Web e Tauri
1. Criar `viewer/` utilizando Vite + Svelte (ou React) com TypeScript.
2. Implementar cliente WebRTC em Javascript nativo (`RTCPeerConnection`).
3. Vincular a `MediaStreamTrack` ao elemento `<video autoplay playsinline muted>`.
4. Capturar listeners de `mousemove`, `mousedown`, `mouseup`, `keydown` e enviar mensagens compactadas no Data Channel.
5. Empacotar com Tauri v2 (`npm run tauri init`) para gerar o executável nativo do técnico.

### Fase 4: Autonomia e UAC (Windows Service)
1. Implementar o wrapper de Serviço do Windows no crate do Rust (`windows-service`).
2. Adicionar listener para `WTSRegisterSessionNotification`.
3. Injetar o processo de captura na sessão de console quando o desktop alternar para `Winlogon` ou `Consent.exe` (UAC).

---

## 5. Diretrizes de Qualidade, Segurança e Código Limpo

Para garantir robustez de nível industrial e ausência de travamentos:

1. **Rust (`velodesk-agent`):**
   * **Contenção estrita de `unsafe`:** APIs Win32 e DirectX COM devem ser encapsuladas em sub-módulos dedicados com comentário explicativo `// SAFETY:`.
   * **Proibido `.unwrap()`:** Usar propagação de erros `?` com `thiserror` / `anyhow`.
   * **Zero cópias de textura:** O frame deve ir do D3D11 Capture Pool direto para a memória do hardware encoder MFT sem passar por buffers intermediários na RAM da CPU.
2. **Go (`velodesk-server`):**
   * **Prevenção de vazamento de Goroutines:** Toda Goroutine associada a conexões WebSocket deve ser cancelada quando a conexão encerrar usando `context.WithCancel`.
   * **Concorrência Protegida:** Utilizar `sync.RWMutex` para o registro de salas e agentes.
3. **Segurança de Rede:**
   * Validação estrita de tamanho e schema de payloads JSON antes de deserializar.
   * Credenciais efêmeras TURN geradas via HMAC-SHA1 com expiração fixa de 24 horas.

---

## 6. Rotina de Testes e Validação Contínua

Ao finalizar qualquer alteração de código ou módulo, o agente DEVE executar e aprovar 100% dos comandos abaixo:

### Validação do Agent (Rust):
```powershell
# 1. Compilação estática
cargo check

# 2. Formatação oficial
cargo fmt --check

# 3. Linter sem warnings tolerados
cargo clippy --all-targets --all-features -- -D warnings

# 4. Testes unitários
cargo test
```

### Validação do Servidor (Go):
```powershell
# 1. Análise estática do compilador
go vet ./...

# 2. Testes unitários com detector de condições de corrida (Race Detector)
go test -v -race -cover ./...
```

---

## 7. Rotina de Versionamento e Gestão do Git

O agente deve versionar o código de forma atômica e padronizada:

1. **Padrão Conventional Commits:**
   * `feat: <descrição>` (Nova funcionalidade)
   * `fix: <descrição>` (Correção de bug)
   * `refactor: <descrição>` (Refatoração sem mudança funcional)
   * `test: <descrição>` (Adição ou modificação de testes)
   * `docs: <descrição>` (Documentação ou ajustes no macro)
   * `chore: <descrição>` (Dependências, configurações ou build)
2. **Critério de Commit:**
   * O commit só é permitido se a rotina de testes da Seção 6 passar sem nenhum erro ou aviso.
3. **Tags de Versão por Fase:**
   * Ao concluir cada fase do projeto:
     * Fase 1: `git tag -a v0.1.0-phase1 -m "Conclusão da Fase 1: Signaling e Infraestrutura VPS"`
     * Fase 2: `git tag -a v0.2.0-phase2 -m "Conclusão da Fase 2: Agent em Rust e Captura WGC"`
     * Fase 3: `git tag -a v0.3.0-phase3 -m "Conclusão da Fase 3: Viewer Web e Tauri"`
     * Fase 4: `git tag -a v1.0.0 -m "VeloDesk v1.0.0: Suporte Completo com UAC e Serviço Windows"`

---

## 8. Como Transferir a Estrutura para o Novo Repositório

Quando criar a pasta do novo projeto (ex: `D:\Code\VeloDesk`):
1. Copie o arquivo `macro.md` para a raiz: `VeloDesk/macro.md`.
2. Copie a pasta de regras `.agents/rules/` para: `VeloDesk/.agents/rules/`.
3. Copie a pasta de skill `.agents/skills/remote-access-dev/` para: `VeloDesk/.agents/skills/remote-access-dev/`.
4. Inicialize o repositório Git:
   ```bash
   cd D:\Code\VeloDesk
   git init
   git add .
   git commit -m "chore: inicializar estrutura de engenharia, skill e macro do VeloDesk"
   ```
5. O agente carregará todas as regras e o roteiro automaticamente e seguirá para a Fase 2!
