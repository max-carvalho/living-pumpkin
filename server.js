// Serveur Citrouille : fichiers statiques + relais WebSocket entre le backoffice et les écrans de rendu.
// HTTPS automatique si certs/key.pem et certs/cert.pem existent (nécessaire pour caméra/micro depuis le téléphone).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Face = require('./shared/face.js');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_DIR = path.join(__dirname, 'shared');
const KEY = path.join(__dirname, 'certs', 'key.pem');
const CERT = path.join(__dirname, 'certs', 'cert.pem');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { pathname = ''; }
  if (pathname === '/') pathname = '/index.html';

  let base = PUBLIC_DIR;
  let rel = pathname;
  if (pathname.startsWith('/shared/')) { base = SHARED_DIR; rel = pathname.slice('/shared'.length); }

  const full = path.join(base, rel);
  if (!full.startsWith(base + path.sep)) { res.writeHead(403).end('Interdit'); return; }

  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404).end('Introuvable'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const useHttps = fs.existsSync(KEY) && fs.existsSync(CERT);
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, serveStatic)
  : http.createServer(serveStatic);

// --- État de la citrouille ---------------------------------------------------
let target = Face.normalize({}); // cible demandée par le backoffice (mode 'live')
let state = Face.normalize({});  // état affiché, produit par l'animateur (ressorts, clignements)
let mode = 'idle';               // 'idle' = veille générée ici, 'live' = cible envoyée par le backoffice
const animator = Face.createAnimator();

const wss = new WebSocketServer({ server, path: '/ws' });

function sendAll(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

function broadcastState() { sendAll({ type: 'state', state, mode }); }

function broadcastInfo() {
  let renderers = 0;
  for (const c of wss.clients) if (c.role === 'render') renderers++;
  sendAll({ type: 'info', renderers, mode });
}

wss.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://x').searchParams.get('role');
  ws.role = role === 'control' || role === 'render' ? role : 'render';

  ws.send(JSON.stringify({ type: 'state', state, mode }));
  broadcastInfo();

  ws.on('message', (raw) => {
    if (ws.role !== 'control') return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'state') {
      target = Face.normalize(msg.state);
    } else if (msg.type === 'mode' && (msg.mode === 'idle' || msg.mode === 'live')) {
      mode = msg.mode;
      broadcastInfo();
      broadcastState();
    }
  });

  ws.on('close', broadcastInfo);
});

// Boucle d'animation : 40 images/s, que le mode soit « veille » ou « live ».
setInterval(() => {
  if (wss.clients.size === 0) return;
  const now = Date.now();
  state = animator.step(mode === 'idle' ? animator.idleTarget(now) : target, now);
  broadcastState();
}, 25);

server.listen(PORT, () => {
  const proto = useHttps ? 'https' : 'http';
  console.log(`Citrouille prête sur ${proto}://localhost:${PORT}`);
  console.log(`  rendu      : ${proto}://localhost:${PORT}/render.html`);
  console.log(`  backoffice : ${proto}://localhost:${PORT}/backoffice.html`);
  const lan = Object.values(require('os').networkInterfaces()).flat()
    .filter((n) => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'));
  for (const n of lan) console.log(`  depuis le téléphone : ${proto}://${n.address}:${PORT}/backoffice.html`);
  if (!useHttps) console.log('  (HTTP : caméra/micro du téléphone indisponibles, lance "npm run cert" pour activer HTTPS)');
});
