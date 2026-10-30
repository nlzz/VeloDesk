# Guia de Implantação na VPS (2 vCPUs / 4GB RAM)

Instruções para provisionar e subir o servidor de sinalização e relay Coturn em uma VPS Linux (Ubuntu / Debian).

---

## 1. Ajustes de Kernel do Linux (sysctl.conf)

Como o Coturn lida com grande volume de conexões UDP/TCP simultâneas em relay, ajuste os limites de buffers de socket para evitar perdas de pacotes:

```bash
cat <<EOF >> /etc/sysctl.conf
# Otimização de rede para WebRTC e TURN Relay
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.core.netdev_max_backlog = 100000
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192
net.ipv4.ip_local_port_range = 1024 65535
fs.file-max = 1000000
EOF

sysctl -p
```

---

## 2. Docker Compose (Coturn + Signaling)

Arquivo `docker-compose.yml`:

```yaml
version: '3.8'

services:
  coturn:
    image: coturn/coturn:latest
    restart: always
    network_mode: "host"
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
    environment:
      - DETECT_EXTERNAL_IP=yes

  signaling:
    build:
      context: ../
      dockerfile: Dockerfile
    restart: always
    ports:
      - "8080:8080"
      - "8443:8443"
    environment:
      - PORT=8080
      - TURN_SECRET=SUA_CHAVE_SECRETA_ALEATORIA_AQUI
      - TURN_REALM=turn.seudominio.com.br
```

---

## 3. Configuração do Coturn (`turnserver.conf`)

```ini
# Portas de escuta
listening-port=3478
tls-listening-port=443

# Faixa de portas para Relay UDP
min-port=49152
max-port=65535

# Autenticação por segredo compartilhado (Time-Window HMAC)
use-auth-secret
static-auth-secret=SUA_CHAVE_SECRETA_ALEATORIA_AQUI
realm=turn.seudominio.com.br

# Segurança
no-tcp-relay
stale-nonce=600
no-multicast-peers
no-cli
log-file=stdout
```
