// Micro du Pi -> téléphone : son brut (PCM 16 bits, mono, 16 kHz) envoyé en binaire par WebSocket.
// Capture avec arecord (alsa-utils, déjà présent sur Raspberry Pi OS), lancée seulement
// lorsqu'au moins un téléphone écoute. Pas d'encodage : ~32 Ko/s, latence minimale.
const { spawn, execFileSync } = require('child_process');

const RATE = 16000;
const STOP_DELAY = 5000;
const RETRY_DELAY = 2000;
const MAX_BUFFERED = 32000;   // ~1 s de son en attente : au-delà, le client est trop lent, on saute

// Premier périphérique de capture trouvé (le micro de la carte son USB), sauf si AUDIO_DEVICE est fourni.
function findDevice() {
  if (process.env.AUDIO_DEVICE) return process.env.AUDIO_DEVICE;
  try {
    const m = execFileSync('arecord', ['-l'], { encoding: 'utf8' }).match(/^card (\d+):.*device (\d+):/m);
    if (m) return `plughw:${m[1]},${m[2]}`;
  } catch { /* pas d'ALSA (PC de dev) */ }
  return null;
}

const listeners = new Set();
let rec = null, stopTimer = null, retryTimer = null, lastError = '';

function start() {
  if (rec || retryTimer) return;
  const dev = findDevice();
  if (!dev) { lastError = 'aucun micro trouvé'; scheduleRetry(); return; }
  // Petites périodes (20 ms) pour limiter la latence.
  rec = spawn('arecord', ['-q', '-D', dev, '-f', 'S16_LE', '-r', String(RATE), '-c', '1', '-t', 'raw',
    '--period-time=20000', '--buffer-time=100000'], { stdio: ['ignore', 'pipe', 'pipe'] });
  rec.stdout.on('data', (chunk) => {
    for (const ws of listeners) {
      if (ws.readyState === 1 && ws.bufferedAmount < MAX_BUFFERED) ws.send(chunk);
    }
  });
  rec.stderr.on('data', (d) => { const m = d.toString().trim(); if (m) lastError = m.split('\n').pop(); });
  rec.on('error', (e) => { lastError = e.message; });
  rec.on('exit', () => {
    rec = null;
    if (listeners.size) {
      console.log(`Micro : capture interrompue (${lastError || 'raison inconnue'}), nouvelle tentative…`);
      scheduleRetry();
    }
  });
  console.log(`Micro : capture ${dev} ${RATE} Hz -> téléphone`);
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; if (listeners.size) start(); }, RETRY_DELAY);
}

function stop() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (rec) { rec.removeAllListeners('exit'); rec.kill(); rec = null; }
}

// Un client WebSocket (rôle « audio ») qui veut écouter.
function add(ws) {
  ws.send(JSON.stringify({ type: 'audio', rate: RATE, format: 's16le' }));
  listeners.add(ws);
  clearTimeout(stopTimer);
  start();
  ws.on('close', () => {
    listeners.delete(ws);
    if (listeners.size === 0) {
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (listeners.size === 0) stop(); }, STOP_DELAY);
    }
  });
}

process.on('exit', stop);

module.exports = { add };
