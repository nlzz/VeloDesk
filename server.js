import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
const DIST_DIR = path.join(__dirname, 'dist');

// Configuração do backend Go interno (velodesk-server)
const GO_PORT = process.env.GO_PORT || '8081';
const BACKEND_URL = process.env.BACKEND_URL || `http://127.0.0.1:${GO_PORT}`;

// Inicialização automática do binário nativo Go (se em ambiente Linux PaaS)
if (process.platform === 'linux') {
  const goBinary = path.join(__dirname, 'bin', 'velodesk-server-linux');
  if (fs.existsSync(goBinary)) {
    try {
      fs.chmodSync(goBinary, '755');
      console.log(`[VeloDesk PaaS] Inicializando servidor Go nativo em :${GO_PORT}...`);
      const proc = spawn(goBinary, [], {
        env: {
          ...process.env,
          PORT: GO_PORT,
          STATIC_DIR: DIST_DIR,
          ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || 'VeloDeskAdmin2026!',
          SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD || 'VeloDeskAdmin2026!',
        },
        stdio: 'inherit',
      });

      proc.on('error', (err) => {
        console.error('[VeloDesk PaaS] Falha ao executar processo Go:', err.message);
      });
      proc.on('exit', (code, sig) => {
        console.warn(`[VeloDesk PaaS] Processo Go finalizou com código ${code} e sinal ${sig}`);
      });
    } catch (err) {
      console.error('[VeloDesk PaaS] Erro ao provisionar binário Go:', err.message);
    }
  } else {
    console.log(`[VeloDesk PaaS] Binário ${goBinary} não encontrado; proxy configurado para ${BACKEND_URL}`);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Healthcheck dedicado para StayCloud PaaS
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'velodesk-proxy', port: PORT }));
    return;
  }

  // 2. Encaminhamento Proxy para API REST do backend Go (/api/*)
  if (pathname.startsWith('/api/')) {
    const backendTarget = new URL(req.url, BACKEND_URL);
    const proxyReq = http.request(
      backendTarget,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: backendTarget.host,
          'x-forwarded-for': req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          'x-forwarded-proto': 'https',
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error(`[Proxy REST] Erro ao conectar ao backend Go (${BACKEND_URL}):`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: true,
          message: 'Servidor de sinalização e autenticação (velodesk-server) indisponível',
          backend: BACKEND_URL,
        })
      );
    });

    req.pipe(proxyReq);
    return;
  }

  // 3. Servidor de Arquivos Estáticos com Fallback SPA
  let normalizedPath = pathname;
  if (normalizedPath === '/') {
    normalizedPath = '/index.html';
  }

  const filePath = path.join(DIST_DIR, normalizedPath);

  // Impede Directory Traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Acesso Negado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // Fallback SPA: qualquer rota de página (/login, /admin, /dashboard, etc.) recebe index.html
      const indexPath = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 - index.html não encontrado no build.');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
    }
  });
});

// 4. Encaminhamento Proxy para WebSockets (/ws e /ws/*)
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsedUrl.pathname.startsWith('/ws')) {
    const backendTarget = new URL(req.url, BACKEND_URL);
    const proxyReq = http.request(backendTarget, {
      method: 'GET',
      headers: {
        ...req.headers,
        host: backendTarget.host,
        'x-forwarded-for': req.headers['x-forwarded-for'] || socket.remoteAddress,
        'x-forwarded-proto': 'wss',
      },
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      let rawHeaders = `HTTP/1.1 101 Switching Protocols\r\n`;
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (Array.isArray(value)) {
          for (const v of value) rawHeaders += `${key}: ${v}\r\n`;
        } else {
          rawHeaders += `${key}: ${value}\r\n`;
        }
      }
      rawHeaders += '\r\n';
      socket.write(rawHeaders);
      if (proxyHead && proxyHead.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on('response', (proxyRes) => {
      // Se o backend responder com HTTP normal (ex: 401 Unauthorized por falta de token JWT)
      let rawHeaders = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}\r\n`;
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        rawHeaders += `${key}: ${value}\r\n`;
      }
      rawHeaders += '\r\n';
      socket.write(rawHeaders);
      proxyRes.pipe(socket);
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy WS] Falha no upgrade WebSocket para ${BACKEND_URL}:`, err.message);
      socket.destroy();
    });

    proxyReq.end();
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`  VeloDesk Web Hub & Reverse Proxy`);
  console.log(`  Listening on : http://${HOST}:${PORT}`);
  console.log(`  Backend Go   : ${BACKEND_URL}`);
  console.log(`  Serving from : ${DIST_DIR}`);
  console.log(`====================================================`);
});
