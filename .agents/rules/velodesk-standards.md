---
trigger: always_on
---

# VeloDesk: Padrões de Código, Segurança, Testes e Versionamento

Esta regra define os padrões inegociáveis de engenharia de software para o desenvolvimento de todos os componentes do **VeloDesk** (`velodesk-agent`, `velodesk-server`, `velodesk-viewer`, `infra`).

O agente deve seguir rigorosamente estas diretrizes ao escrever, refatorar, testar e versionar código.

---

## 1. Segurança e Integridade

1. **Rust (Host Agent):**
   * **Isolamento de `unsafe`:** O código `unsafe` (necessário para APIs Win32, DirectX e ponteiros COM) deve ser estritamente contido em funções ou módulos encapsulados (ex: `src/capture/win32_interop.rs`).
   * Toda chamada `unsafe` DEVE conter um comentário de invariante `// SAFETY:` justificando por que o ponteiro é válido e por que não há risco de corrida ou estouro de memória.
   * Não utilizar `.unwrap()` em código de produção ou caminhos críticos de rede; utilizar o operador `?` com tratamento idiomático de erros (`thiserror` para bibliotecas e `anyhow` para binários).
2. **Go (Signaling Server):**
   * Prevenção de vazamento de Goroutines: toda Goroutine instanciada para gerenciar WebSockets DEVE estar vinculada a um `context.Context` com cancelamento automático quando a conexão fechar.
   * Concorrência Segura: utilizar `sync.RWMutex` ou tipos atômicos (`sync/atomic`) para gerenciar mapas de sessões e IDs de agentes conectados.
3. **Criptografia e Validação de Entrada:**
   * Validar o tamanho e formato de qualquer mensagem recebida via WebSocket ou Data Channel antes de deserializar.
   * Senhas de acesso nunca trafegam em texto puro; senhas permanentes devem ser derivadas com **Argon2id** e tokens TURN devem usar HMAC-SHA1 com expiração temporária (Time-Window).

---

## 2. Legibilidade e Padrões de Código

1. **Documentação de Símbolos:**
   * Todas as structs públicas, enums e funções devem conter docstrings claras explicando seu propósito, entradas e erros possíveis.
2. **Modularidade e Responsabilidade Única:**
   * Cada arquivo deve ter no máximo 350-400 linhas. Módulos complexos (como captura WGC ou handshake WebRTC) devem ser decompostos em sub-módulos coesos.
3. **Imutabilidade e Tipagem Estrita:**
   * Preferir referências imutáveis (`&T`) e evitar clones desnecessários de buffers de vídeo ou áudio.

---

## 3. Checklist Obrigatório ao Finalizar Qualquer Código

Antes de dar uma tarefa como concluída, o agente DEVE executar o seguinte pipeline de validação local:

### Em Projetos Rust (`agent/`):
```powershell
# 1. Checagem de sintaxe e tipos
cargo check

# 2. Formatação oficial
cargo fmt --check

# 3. Linter estrito com bloqueio de warnings
cargo clippy --all-targets --all-features -- -D warnings

# 4. Suíte de testes unitários
cargo test
```

### Em Projetos Go (`server/`):
```powershell
# 1. Formatação
gofmt -l -w .

# 2. Análise estática do compilador
go vet ./...

# 3. Execução de testes com detecção de concorrência (Race Detector)
go test -v -race -cover ./...
```

> [!CAUTION]
> Nenhum código deve ser considerado concluído ou versionado se houver qualquer aviso (*warning*) do compilador ou linter ativo.

---

## 4. Rotina de Versionamento Automático (Git)

O agente deve manter o histórico do Git limpo, semântico e rastreável:

1. **Padrão Conventional Commits:**
   * `feat: <descrição>` (Nova funcionalidade)
   * `fix: <descrição>` (Correção de bug)
   * `refactor: <descrição>` (Refatoração de código sem alteração de comportamento)
   * `test: <descrição>` (Adição ou ajuste de testes)
   * `docs: <descrição>` (Atualização de documentação ou macro)
   * `chore: <descrição>` (Ajustes de build, dependências ou configs)
2. **Regra de Ouro do Commit:**
   * Só realizar o commit após o checklist de linters e testes do item 3 passar com 100% de sucesso.
   * Manter commits atômicos (uma responsabilidade clara por commit).
3. **Comando Padrão de Commit:**
   ```bash
   git add <arquivos-modificados>
   git commit -m "feat(server): implementar gerador de credenciais efêmeras TURN"
   ```
4. **Tagging por Fases:**
   * Ao finalizar uma fase completa descrita no `macro.md`, criar uma tag Git correspondente:
   ```bash
   git tag -a v0.1.0-phase1 -m "Conclusão da Fase 1: Signaling Server e Infraestrutura VPS"
   ```
