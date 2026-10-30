# Infraestrutura VeloDesk (VPS Staycloud)

Este diretório contém os manifestos e arquivos de configuração para provisionamento do servidor de sinalização WebRTC (`velodesk-server`) e do servidor STUN/TURN Relay (`coturn`) na VPS da Staycloud.

---

## 1. Topologia de Rede & Portas

| Porta | Protocolo | Serviço | Descrição |
| :--- | :--- | :--- | :--- |
| `3478` | UDP & TCP | Coturn (STUN/TURN) | Descoberta de IP público e relay P2P |
| `443` | TCP | Coturn (TURN TLS) | Conexões de relay seguras através de firewalls restritivos |
| `49152-65535` | UDP | Coturn Dynamic Relay | Faixa de portas dinâmicas para encaminhamento RTP |
| `8080` | TCP (HTTP/WS) | Signaling Server | Negociação de SDP, ICE Candidates e PWA de controle |

---

## 2. Deploy Rápido na VPS Staycloud

### Pré-requisitos
* Docker e Docker Compose instalados no host Linux.
* Hostname apontando para o IP da VPS (ex: `turn.velodesk.staycloud.com`).

### Passo a Passo

1. **Configuração de Otimização de Kernel (sysctl):**
   ```bash
   sudo cat <<EOF >> /etc/sysctl.conf
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
   sudo sysctl -p
   ```

2. **Configuração do `.env`:**
   ```bash
   cp .env.example .env
   # Edite o arquivo .env definindo um TURN_SECRET seguro e o domínio da VPS
   nano .env
   ```
   *Certifique-se de definir a mesma chave secreta em `turnserver.conf` (`static-auth-secret`) e no `.env` (`TURN_SECRET`).*

3. **Subir os containers:**
   ```bash
   docker compose up -d --build
   ```

4. **Verificar os logs:**
   ```bash
   docker compose logs -f
   ```

---

## 3. Validação STUN/TURN com Trickle ICE

Para validar se o STUN e o TURN Relay estão operando corretamente e passando por firewalls:

1. Acesse a ferramenta oficial do consórcio WebRTC:  
   👉 [https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
2. Obtenha credenciais efêmeras atualizadas via curl ou pelo navegador:
   ```bash
   curl http://IP_DA_VPS:8080/api/v1/turn-credentials?client_id=trickle-test
   ```
3. No Trickle ICE:
   * **STUN Server:** adicione `stun:IP_DA_VPS:3478` e clique em *Gather candidates*. Deve aparecer o candidato do tipo `srflx` (indica descoberta bem-sucedida do seu IP externo).
   * **TURN Server:** adicione `turn:IP_DA_VPS:3478?transport=udp`, preencha o `username` e a `credential` (gerados pela API) e clique em *Gather candidates*. Deve aparecer o candidato do tipo `relay` (indica que a VPS está pronta para contornar redes com NAT simétrico).
