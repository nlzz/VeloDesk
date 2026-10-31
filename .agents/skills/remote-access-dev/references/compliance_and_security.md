# VeloDesk: Guia de Compliance, LGPD e Blindagem Jurídica

> **Referência Técnica e Jurídica de Segurança Forense e Conformidade LGPD (Lei 13.709/2018)**

---

## 1. Princípios e Requisitos da LGPD no Acesso Remoto

O acesso remoto corporativo lida com dados pessoais e dados corporativos sensíveis trafegando em tempo real. O VeloDesk v2.0 implementa garantias técnicas e administrativas para satisfazer os artigos 6º (Princípios da Segurança, Transparência e Não Discriminação), 46º (Medidas de Segurança) e 48º (Notificação e Rastreabilidade) da LGPD.

### 1.1 Salvaguardas Mandatórias na Sessão
1. **Transparência Visual Ativa:**
   - **Moldura Perimetral Colorida (4px):** Uma borda visual visível e contrastante na tela inteira durante toda a transmissão WebRTC, garantindo que o usuário remoto sempre saiba que sua tela está sendo transmitida.
   - **Banner TopMost Flutuante Irremovível:** Janela fixa no topo da tela (`WS_EX_TOPMOST | WS_EX_TOOLWINDOW`) indicando:
     - Identificação e nome do técnico responsável.
     - Cronômetro decorrido da sessão.
     - Botão de Pânico (*Kill Switch*) vermelho de alta visibilidade.
2. **Botão de Pânico (Kill Switch):**
   - Ação de um clique que encerra imediatamente os streams WebRTC, reseta a injeção de periféricos e notifica o servidor e o técnico sobre o cancelamento pelo cliente.
3. **Preempção do Periférico Físico (Local Mouse Override):**
   - Prioridade absoluta do operador local. Caso o usuário na máquina host movimente o mouse físico ou pressione uma tecla, a injeção remota é bloqueada instantaneamente por **3 segundos**, permitindo reassumir o controle imediato de sua estação.
4. **Privacy Masking (Mascaramento de Credenciais):**
   - Interceptação e mascaramento de campos de senha identificados via Windows UI Automation (`IsPasswordPropertyId == TRUE`).
5. **Quarentena e Análise com Windows AMSI:**
   - Arquivos recebidos via Data Channel nunca são salvos diretamente em pastas de trabalho.
   - Todo arquivo transferido é armazenado inicialmente em uma pasta de quarentena (`%LOCALAPPDATA%\VeloDesk\quarantine\`), tem seu hash SHA-256 computado e registrado no log de auditoria, e é submetido à varredura ativa pelo motor antivírus do Windows via **AMSI (`AmsiScanBuffer`)**. Se infectado ou suspeito, o arquivo é deletado imediatamente.

---

## 2. Multi-Tenancy Seguro com Row-Level Security (RLS)

1. **Isolamento Criptográfico e Lógico:**
   - Todas as tabelas sensíveis no PostgreSQL contêm a coluna `tenant_id UUID NOT NULL`.
   - As tabelas possuem RLS habilitado e forçado:
     ```sql
     ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
     ALTER TABLE users ENABLE ROW LEVEL SECURITY;
     ALTER TABLE users FORCE ROW LEVEL SECURITY;
     ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
     ALTER TABLE devices FORCE ROW LEVEL SECURITY;
     ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
     ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
     ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
     ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
     ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
     ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
     ```
2. **Políticas RLS Estritas:**
   ```sql
   CREATE POLICY tenant_isolation_policy ON <table>
   AS RESTRICTIVE
   USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   ```
3. **Injeção Transacional no Go:**
   - O middleware de API e conexões de pool injetam:
     ```sql
     SET LOCAL app.current_tenant_id = '<tenant-uuid>';
     ```
   - O uso de `SET LOCAL` garante que a variável de sessão expire automaticamente ao final da transação, impossibilitando vazamento entre conexões reutilizadas pelo pool `pgx` ou `database/sql`.

---

## 3. Cadeia de Auditoria Forense Imutável (Tamper-Evident Hash Chain)

Para fins periciais e conformidade jurídica, a tabela `audit_events` opera em formato de cadeia criptográfica irreversível:

```
[ Evento 0: Gênese ] ──> Hash(E0)
                              │
[ Evento 1 ] ──> Hash(E1 + Hash(E0)) + HMAC-SHA256
                              │
[ Evento 2 ] ──> Hash(E2 + Hash(E1)) + HMAC-SHA256
```

1. **Campos do Evento:**
   - `sequence_number`: Inteiro monotônico incremental por tenant.
   - `previous_event_hash`: Hash SHA-256 do registro anterior.
   - `payload_hash`: SHA-256 dos dados brutos do evento (tipo, agente, usuário, timestamp).
   - `hmac_sha256`: Assinatura criptográfica calculada com a chave mestra de auditoria do servidor.
   - `created_at`: Carimbo temporal sincronizado via Chrony (NTP Stratum 1).

2. **Detecção de Fraude:**
   - Qualquer inserção, deleção ou modificação manual no banco de dados quebra a sequência matemática da cadeia de hashes, sendo imediatamente sinalizada pelo verificador de integridade.

---

## 4. Distribuição com Metadados em PE Overlay

Para permitir distribuição White-Label sem recompilar o binário em Rust para cada cliente:
- O instalador PE (`velodesk-agent.exe`) lê dados customizados anexados após a tabela de seções do arquivo PE (Overlay).
- Estrutura do Overlay:
  - Assinatura mágica: `VD_OVERLAY_V1` (14 bytes)
  - Comprimento dos metadados (4 bytes Little Endian)
  - Carga JSON codificada: `{ "tenant_id": "...", "tenant_slug": "alfa", "server_url": "wss://..." }`
  - Checksum CRC32/SHA256 de validação de integridade.
