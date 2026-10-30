# VeloDesk Signaling Server (Go)

Servidor de sinalização e mediação de sessões WebRTC em Go com multiplexação assíncrona, geração de credenciais efêmeras TURN via HMAC-SHA1 e suporte a clientes Web e Desktop.

---

## 1. Estrutura do Projeto

* `cmd/server/main.go`: Ponto de entrada do serviço, setup de rotas e shutdown graceful.
* `internal/config/`: Carregamento de variáveis de ambiente.
* `internal/auth/`: Geração e validação de credenciais efêmeras STUN/TURN (RFC 5766).
* `internal/signaling/`: Hub de conexões, gerenciador de sessões, roteamento zero-copy de mensagens WebRTC (`offer`, `answer`, `candidate`, `disconnect`).
* `internal/handler/`: Handlers HTTP e Upgrader de WebSockets.
* `web/`: Painel de controle web para testes em tempo real de presença de agentes e conexões de técnicos.

---

## 2. Como Executar Localmente

### Pré-requisitos
* Go 1.22+

### Comandos

```bash
# Baixar dependências
go mod tidy

# Rodar os testes unitários e de integração
go test -v ./...

# Iniciar o servidor de desenvolvimento
go run cmd/server/main.go
```

O servidor iniciará em `http://localhost:8080`.  
Acesse o navegador para ver a interface gráfica de teste de sinalização e o console de depuração em tempo real.
