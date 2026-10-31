// Serveur Citrouille : fichiers statiques + relais WebSocket entre le backoffice et les écrans de rendu.
// HTTPS automatique si certs/key.pem et certs/cert.pem existent (nécessaire pour caméra/micro depuis le téléphone).
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Face = require('./shared/face.js');
const Camera = require('./camera.js');
const Audio = require('./audio.js');
const Voice = require('./voice.js');
const Son = require('./son.js');
const Leds = require('./leds.js');

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
  if (pathname === '/cam.mjpg') { Camera.handle(req, res); return; }

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

// En HTTPS, le même port accepte aussi http:// et renvoie vers https:// (sinon Chrome coupe en
// ERR_TOO_MANY_RETRIES quand on oublie le « s »). Le premier octet trie : 0x16 = début d'une poignée TLS.
const redirect = http.createServer((req, res) => {
  const host = (req.headers.host || `localhost:${PORT}`).replace(/[^\w.:\[\]-]/g, '');
  res.writeHead(301, { Location: `https://${host}${req.url}` }).end();
});
// Échecs de poignée TLS journalisés (diagnostic : un appareil qui n'arrive pas à se connecter).
server.on('tlsClientError', (err, socket) => {
  console.log(`TLS refusé depuis ${socket.remoteAddress} : ${err.code || ''} ${err.message}`);
});
const front = useHttps
  ? net.createServer((socket) => {
      socket.once('readable', () => {
        const first = socket.read(1);
        if (!first) { socket.destroy(); return; }
        socket.unshift(first);
        (first[0] === 0x16 ? server : redirect).emit('connection', socket);
      });
      socket.on('error', () => {});
    })
  : server;

// --- État de la citrouille ---------------------------------------------------
let target = Face.normalize({}); // cible demandée par le backoffice (mode 'live')
let state = Face.normalize({});  // état affiché, produit par l'animateur (ressorts, clignements)
let mode = 'idle';               // 'idle' = sommeil généré ici, 'live' = cible envoyée par le backoffice, 'off' = éteinte
// Synchro labiale : le son arrive plus tard que l'image sur la citrouille ; on retarde donc l'image
// (le visage) de lipsyncMs. Réglable depuis le backoffice.
let lipsyncMs = 130;
let targetQueue = [];            // cibles reçues, horodatées, en attente de leur heure d'affichage
const animator = Face.createAnimator();
// Couleur des LED (bouton palette du backoffice), gardée dans couleur.json après un redémarrage.
const COLOR_FILE = path.join(__dirname, 'couleur.json');
try { Face.setColor(JSON.parse(fs.readFileSync(COLOR_FILE, 'utf8'))); } catch { /* pas de fichier : blanc */ }
// Image plein écran (pierre, feuille, ciseaux) affichée ICON_MS à la place du visage, quel que soit le mode.
// Le visage continue d'être calculé en dessous, et la voix n'est pas touchée.
const ICON_MS = 2000;
let icon = null, iconUntil = 0;

const wss = new WebSocketServer({ server, path: '/ws' });

function sendAll(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1 && c.role !== 'audio' && c.role !== 'voice') c.send(data);
}

function broadcastState() { sendAll({ type: 'state', state, mode, icon }); }

function broadcastInfo() {
  let renderers = 0;
  for (const c of wss.clients) if (c.role === 'render') renderers++;
  sendAll({ type: 'info', renderers, mode, lipsyncMs, voiceDebug: Voice.getDebug(), music: Son.getMusic(), color: Face.getColor(), ledBrightness: Leds.getBrightness(), ledTest: Leds.getTest() });
}

wss.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://x').searchParams.get('role');
  // Rôle « audio » : le téléphone écoute le micro du Pi (flux binaire, voir audio.js).
  if (role === 'audio') { ws.role = 'audio'; Audio.add(ws); return; }
  // Rôle « voice » : la voix de l'opérateur part vers le haut-parleur du Pi (voir voice.js).
  if (role === 'voice') { ws.role = 'voice'; Voice.add(ws); return; }
  ws.role = role === 'control' || role === 'render' ? role : 'render';

  ws.send(JSON.stringify({ type: 'state', state, mode, icon }));
  broadcastInfo();

  ws.on('message', (raw) => {
    if (ws.role !== 'control') return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'state') {
      targetQueue.push({ t: Date.now(), state: Face.normalize(msg.state) });
    } else if (msg.type === 'lipsync' && typeof msg.ms === 'number' && isFinite(msg.ms)) {
      lipsyncMs = Math.max(0, Math.min(1000, Math.round(msg.ms)));
      broadcastInfo();
    } else if (msg.type === 'leds') {
      if (typeof msg.brightness === 'number' && isFinite(msg.brightness)) Leds.setBrightness(msg.brightness);
      if (typeof msg.test === 'boolean') Leds.setTest(msg.test);
      broadcastInfo();
    } else if (msg.type === 'icon' && typeof msg.name === 'string' && Face.icon(msg.name)) {
      icon = msg.name;
      iconUntil = Date.now() + ICON_MS;
    } else if (msg.type === 'color' && Array.isArray(msg.rgb) && msg.rgb.length === 3 && msg.rgb.every((v) => typeof v === 'number' && isFinite(v))) {
      Face.setColor(msg.rgb);
      fs.writeFile(COLOR_FILE, JSON.stringify(Face.getColor()), () => {});
      broadcastInfo();
      broadcastState();
    } else if (msg.type === 'music') {
      Son.setMusic(msg);
      broadcastInfo();
    } else if (msg.type === 'voiceDebug' && typeof msg.on === 'boolean') {
      Voice.setDebug(msg.on);
      targetQueue = [];   // le retard du visage change d'un coup
      broadcastInfo();
    } else if (msg.type === 'mode' && (msg.mode === 'idle' || msg.mode === 'live' || msg.mode === 'off')) {
      if (msg.mode !== mode) targetQueue = [];   // pas d'expressions périmées au changement de mode
      mode = msg.mode;
      broadcastInfo();
      broadcastState();
    }
  });

  ws.on('close', broadcastInfo);
});

const BLACK = new Uint8Array(Face.W * Face.W * 3);
// Boucle d'animation : 40 images/s, que le mode soit « veille » ou « live ».
setInterval(() => {
  if (wss.clients.size === 0 && !Leds.enabled()) return;   // la matrice s'anime même sans navigateur
  const now = Date.now();
  // Cible la plus récente dont l'heure d'affichage (réception + retard) est arrivée.
  // En mode debug de la voix, le visage est retardé d'autant que la voix.
  const delay = lipsyncMs + Voice.debugDelay();
  while (targetQueue.length && targetQueue[0].t + delay <= now) target = targetQueue.shift().state;
  if (targetQueue.length > 200) targetQueue = targetQueue.slice(-200);   // garde-fou (~6 s à 30 envois/s)
  // Sommeil = tête classique de citrouille ; mode manuel = on suit uniquement le comédien. Jamais de
  // clignement automatique. Éteinte : toutes les LED noires (l'animateur continue vers le sommeil).
  state = animator.step(mode === 'live' ? target : animator.idleTarget(now), now, { autoBlink: false });
  if (icon && now >= iconUntil) icon = null;
  Leds.show(icon ? Face.icon(icon) : mode === 'off' ? BLACK : Face.render(state));
  if (wss.clients.size) broadcastState();
}, 25);

front.listen(PORT, () => {
  const proto = useHttps ? 'https' : 'http';
  console.log(`Citrouille prête sur ${proto}://localhost:${PORT}`);
  console.log(`  rendu      : ${proto}://localhost:${PORT}/render.html`);
  console.log(`  backoffice : ${proto}://localhost:${PORT}/backoffice.html`);
  const lan = Object.values(require('os').networkInterfaces()).flat()
    .filter((n) => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'));
  for (const n of lan) console.log(`  depuis le téléphone : ${proto}://${n.address}:${PORT}/backoffice.html`);
  if (!useHttps) console.log('  (HTTP : caméra/micro du téléphone indisponibles, lance "npm run cert" pour activer HTTPS)');
});
