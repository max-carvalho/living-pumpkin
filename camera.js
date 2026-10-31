// Caméra IR du Pi (nappe CSI, OV5647) -> flux MJPEG (multipart/x-mixed-replace), affichable dans une balise <img>.
// rpicam-vid (libcamera) fournit directement du MJPEG sur sa sortie standard, en noir et blanc :
// une caméra IR sans filtre donne des couleurs fausses (teinte rose), inutiles de nuit.
// La capture ne tourne que lorsqu'au moins un navigateur regarde le flux.
const { spawn } = require('child_process');

const WIDTH = Number(process.env.CAM_WIDTH) || 640;
const HEIGHT = Number(process.env.CAM_HEIGHT) || 480;
const FPS = Number(process.env.CAM_FPS) || 20;
const CAM_ARGS = process.env.CAM_ARGS ? process.env.CAM_ARGS.split(' ') : []; // options rpicam-vid en plus (ex. --hflip --vflip)
const STOP_DELAY = 5000;    // arrêt de la capture 5 s après le départ du dernier spectateur
const RETRY_DELAY = 2000;   // nouvelle tentative si la caméra est débranchée ou plante
const BOUNDARY = 'cadre';

const clients = new Set();
let capture = null;
let pending = Buffer.alloc(0);
let lastFrame = null;
let stopTimer = null, retryTimer = null;
let lastError = '';

// Découpe le flux en images JPEG complètes. On parcourt les segments d'en-tête (longueur connue)
// jusqu'à SOS, puis on cherche FFD9 : dans les données compressées, un octet FF est toujours suivi
// de 00 ou d'un marqueur RST, donc FFD9 y marque forcément la fin d'image.
function extractFrames(chunk) {
  pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  const n = pending.length;
  let pos = 0;
  for (;;) {
    // Début d'image : FFD8
    let start = -1;
    for (let k = pos; k + 1 < n; k++) if (pending[k] === 0xff && pending[k + 1] === 0xd8) { start = k; break; }
    if (start === -1) { pos = Math.max(pos, n - 1); break; }
    pos = start;
    // En-têtes jusqu'à SOS
    let i = start + 2, sos = false, broken = false;
    while (i + 4 <= n) {
      if (pending[i] !== 0xff) { broken = true; break; }
      const marker = pending[i + 1];
      i += 2 + pending.readUInt16BE(i + 2);
      if (marker === 0xda) { sos = true; break; }
    }
    if (broken) { pos = start + 2; continue; } // flux désynchronisé : on cherche l'image suivante
    if (!sos || i > n) break;                  // en-têtes incomplets : attendre la suite
    // Fin d'image : FFD9
    let end = -1;
    for (let j = i; j + 1 < n; j++) if (pending[j] === 0xff && pending[j + 1] === 0xd9) { end = j + 2; break; }
    if (end === -1) break;
    broadcast(pending.subarray(start, end));
    pos = end;
  }
  pending = Buffer.from(pending.subarray(pos));
  if (pending.length > 4 * 1024 * 1024) pending = Buffer.alloc(0); // garde-fou
}

function writeFrame(res, jpeg) {
  res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
  res.write(jpeg);
  res.write('\r\n');
}

function broadcast(jpeg) {
  lastFrame = Buffer.from(jpeg);
  for (const res of clients) {
    // Client lent (Wi-Fi faible) : on saute des images plutôt que d'accumuler du retard.
    if (res.writableLength > 2 * lastFrame.length) continue;
    writeFrame(res, lastFrame);
  }
}

function start() {
  if (capture || retryTimer) return;
  capture = spawn('rpicam-vid', ['-n', '-t', '0', '--codec', 'mjpeg', '--quality', '70', '--saturation', '0',
    '--width', String(WIDTH), '--height', String(HEIGHT), '--framerate', String(FPS), ...CAM_ARGS, '-o', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  capture.stdout.on('data', extractFrames);
  capture.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (/ERROR|error|failed|no cameras/i.test(msg)) lastError = msg.split('\n').pop();
  });
  capture.on('error', (e) => { lastError = e.message; });
  capture.on('exit', onExit);
  console.log(`Caméra : rpicam-vid ${WIDTH}x${HEIGHT} à ${FPS} images/s`);
}

function onExit() {
  if (!capture) return;
  const wanted = clients.size > 0;
  stop();
  if (wanted) {
    console.log(`Caméra : flux interrompu (${lastError || 'raison inconnue'}), nouvelle tentative…`);
    scheduleRetry();
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; if (clients.size) start(); }, RETRY_DELAY);
}

function stop() {
  const p = capture;
  capture = null;
  if (p) { p.removeAllListeners('exit'); p.kill(); }
  pending = Buffer.alloc(0);
  lastFrame = null;
}

// GET /cam.mjpg
function handle(req, res) {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store',
    'Pragma': 'no-cache'
  });
  res.socket.setNoDelay(true);
  clients.add(res);
  clearTimeout(stopTimer);
  if (lastFrame) writeFrame(res, lastFrame);
  start();
  res.on('close', () => {
    clients.delete(res);
    if (clients.size === 0) {
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (clients.size === 0) { clearTimeout(retryTimer); retryTimer = null; stop(); } }, STOP_DELAY);
    }
  });
}

// Ne pas laisser de rpicam-vid orphelin à l'arrêt du serveur.
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

module.exports = { handle };
