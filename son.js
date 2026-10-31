// Sortie son du Pi : une seule enceinte, donc un seul aplay qui joue le mélange voix + musique.
// - voix de l'opérateur (16 kHz, déjà transformée par voice.js), rééchantillonnée à 44,1 kHz ;
// - musique d'ambiance en boucle sans fin (sons/musique.wav, mono 16 bits 44,1 kHz), baissée quand la voix parle ;
//   allumée ou non et volume gardés dans son.json, donc repris après un redémarrage.
// Le rythme est donné par la carte son : scripts/sortie_son.py écrit chaque morceau dans un tube de 4 Ko
// vers aplay et répond « . » quand c'est fait ; on garde au plus CREDITS morceaux en route.
// Retard total ≈ 4 Ko (46 ms) + tampon d'aplay (80 ms) + morceaux en route, au lieu de 0,7 s avec un tube normal.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT_RATE = 44100;
const CHUNK = Math.round(OUT_RATE * 0.02);      // morceaux de 20 ms
const CREDITS = 2;                              // morceaux envoyés au relais sans attendre sa réponse
const VOICE_PREBUF = 0.06;                      // s : réserve avant de jouer la voix (à-coups du Wi-Fi)
const VOICE_MAX = 0.3;                          // s : au-delà, on jette le plus vieux pour ne pas accumuler de retard
const DUCK = 0.3;                               // musique à 30 % de son volume quand la voix parle
const DUCK_HOLD = 0.6;                          // s : musique gardée basse après la parole
const STOP_DELAY = 5000;                        // ms : aplay arrêté quand plus rien à jouer
const MUSIC_FILE = path.join(__dirname, 'sons', 'musique.wav');
const STATE_FILE = path.join(__dirname, 'son.json');   // musique allumée et volume, gardés après un redémarrage

// Musique : chargée une fois en mémoire (7 Mo pour 83 s).
let music = null;
function loadMusic() {
  if (music) return music;
  try {
    const buf = fs.readFileSync(MUSIC_FILE);
    const data = buf.indexOf('data', 12);                       // en-tête WAV simple (44 octets en général)
    const start = data + 8, len = buf.readUInt32LE(data + 4);
    const pcm = Buffer.from(buf.subarray(start, start + len));  // copie alignée
    music = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  } catch (e) {
    console.log(`Musique : ${MUSIC_FILE} illisible (${e.message})`);
  }
  return music;
}

let musicOn = false, musicVolume = 0.25, musicPos = 0, musicGain = 0, duckUntil = 0;
function saveState() {
  fs.writeFile(STATE_FILE, JSON.stringify({ musicOn, musicVolume }), () => {});
}

// Voix : file de morceaux à 44,1 kHz.
let voiceQ = [], voiceQLen = 0, voicePlaying = false, voiceUsers = 0;
// Rééchantillonnage 16 kHz -> 44,1 kHz par interpolation linéaire, phase continue d'un morceau à l'autre.
let rsPrev = 0, rsPos = 0;

// Sortie : VOICE_DEVICE, sinon une carte son USB si elle existe, sinon la prise jack du Pi.
function findDevice() {
  if (process.env.VOICE_DEVICE) return process.env.VOICE_DEVICE;
  try {
    const cards = [...execFileSync('aplay', ['-l'], { encoding: 'utf8' }).matchAll(/^card (\d+): (\S+) \[([^\]]*)\], device (\d+):/gm)];
    const usb = cards.find((c) => !/bcm2835|vc4|hdmi/i.test(c[2] + c[3]));
    const jack = cards.find((c) => /Headphones/i.test(c[2]));
    const c = usb || jack || cards[0];
    if (c) return `plughw:${c[1]},${c[4]}`;
  } catch { /* pas d'ALSA (PC de dev) */ }
  return null;
}

let player = null, credits = 0, stopTimer = null;

// Page d'observation : copie du mélange réellement envoyé à l'enceinte, ramenée à 22,05 kHz
// (moyenne de deux échantillons) pour diviser le débit par deux (~44 Ko/s par auditeur).
const TAP_RATE = OUT_RATE / 2;
const TAP_MAX_BUFFERED = 44100;   // ~1 s en attente : client trop lent, on saute
const listeners = new Set();
function tap(buf) {
  if (!listeners.size) return;
  const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
  const out = new Int16Array(src.length >> 1);
  for (let k = 0; k < out.length; k++) out[k] = (src[2 * k] + src[2 * k + 1]) >> 1;
  const data = Buffer.from(out.buffer);
  for (const ws of listeners) if (ws.readyState === 1 && ws.bufferedAmount < TAP_MAX_BUFFERED) ws.send(data);
}
// Un client WebSocket (rôle « sortie ») qui écoute ce que joue l'enceinte. Rien n'est envoyé
// quand l'enceinte est muette (aplay arrêté).
function addListener(ws) {
  ws.send(JSON.stringify({ type: 'audio', rate: TAP_RATE, format: 's16le' }));
  listeners.add(ws);
  ws.on('close', () => listeners.delete(ws));
}

function start() {
  clearTimeout(stopTimer);
  if (player) return;
  const dev = findDevice();
  if (!dev) { console.log('Son : aucune sortie trouvée'); return; }
  const aplay = ['aplay', '-q', '-D', dev, '-f', 'S16_LE', '-r', String(OUT_RATE), '-c', '1', '-t', 'raw',
    '--period-time=20000', '--buffer-time=80000'];
  const p = player = spawn('python3', [path.join(__dirname, 'scripts', 'sortie_son.py'), String(CHUNK * 2), ...aplay],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  credits = CREDITS;
  p.stdin.on('error', () => {});
  p.stdout.on('data', (d) => { if (player === p) { credits += d.length; pump(); } });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-300); }); // « underrun » occasionnels : aplay se rattrape seul
  p.on('exit', (code) => {
    if (code) console.log(`Son : aplay arrêté (${code}) ${err.trim()}`);
    if (player !== p) return;                                   // arrêt voulu (stop)
    player = null;
    // Arrêt inattendu (carte son débranchée...) : on relance tant qu'il y a quelque chose à jouer.
    setTimeout(() => { if (!player && (musicOn || voiceUsers > 0)) start(); }, 1000);
  });
  pump();
  console.log(`Son : sortie ${dev}`);
}

function stop() {
  if (player) { player.stdin.end(); player.kill(); player = null; }
}

// Arrête aplay après STOP_DELAY si plus personne ne parle et que la musique est coupée.
function maybeStop() {
  clearTimeout(stopTimer);
  if (voiceUsers > 0 || musicOn) return;
  stopTimer = setTimeout(() => { if (voiceUsers === 0 && !musicOn) stop(); }, STOP_DELAY);
}

// Envoie des morceaux de 20 ms tant qu'il reste des crédits (rendus un par un par le relais).
function pump() {
  while (player && credits > 0) { credits--; const b = mix(); player.stdin.write(b); tap(b); }
}

// Prépare le morceau suivant : voix + musique.
function mix() {
  const out = new Int16Array(CHUNK);
  const now = Date.now() / 1000;

  // Voix
  if (voiceQLen > VOICE_MAX * OUT_RATE) {                      // trop de retard : on jette le plus vieux
    while (voiceQLen > VOICE_PREBUF * OUT_RATE) { voiceQLen -= voiceQ[0].length; voiceQ.shift(); }
  }
  if (!voicePlaying && voiceQLen >= VOICE_PREBUF * OUT_RATE) voicePlaying = true;
  const voice = new Float32Array(CHUNK);
  let energy = 0;
  if (voicePlaying) {
    let i = 0;
    while (i < CHUNK && voiceQ.length) {
      const head = voiceQ[0], n = Math.min(CHUNK - i, head.length);
      voice.set(head.subarray(0, n), i);
      i += n;
      if (n === head.length) voiceQ.shift(); else voiceQ[0] = head.subarray(n);
      voiceQLen -= n;
    }
    if (!voiceQ.length) voicePlaying = false;                   // file vide : on refait une réserve
    for (let k = 0; k < CHUNK; k++) energy += voice[k] * voice[k];
  }
  if (Math.sqrt(energy / CHUNK) > 0.01) duckUntil = now + DUCK_HOLD;

  // Musique (gain lissé : pas de clic à l'allumage, à l'extinction ni quand la voix la baisse)
  const m = musicOn ? loadMusic() : null;
  const target = m ? musicVolume * (now < duckUntil ? DUCK : 1) : 0;
  for (let k = 0; k < CHUNK; k++) {
    musicGain += (target - musicGain) * (target < musicGain ? 0.0005 : 0.0001);
    let y = voice[k];
    if (music && musicGain > 1e-4) {
      y += musicGain * music[musicPos] / 32768;
      if (++musicPos >= music.length) musicPos = 0;
    }
    out[k] = Math.max(-32767, Math.min(32767, Math.round(y * 32767)));
  }
  return Buffer.from(out.buffer);
}

// Morceau de voix (Int16Array à 16 kHz) à jouer dès que possible.
function voice(pcm16k) {
  start();
  const ratio = 16000 / OUT_RATE;
  const n = Math.ceil((pcm16k.length - rsPos) / ratio);
  if (n <= 0) return;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    // Position p : 0 = dernier échantillon du morceau d'avant, i + 1 = pcm16k[i].
    const p = rsPos + k * ratio, i = Math.floor(p), f = p - i;
    const a = i === 0 ? rsPrev : pcm16k[i - 1] / 32768;
    const b = pcm16k[i] / 32768;
    out[k] = a + (b - a) * f;
  }
  rsPos = rsPos + n * ratio - pcm16k.length;
  rsPrev = pcm16k[pcm16k.length - 1] / 32768;
  voiceQ.push(out);
  voiceQLen += n;
}

// Un téléphone qui envoie sa voix est branché / débranché (garde la sortie ouverte entre-temps).
function voiceUser(on) {
  voiceUsers = Math.max(0, voiceUsers + (on ? 1 : -1));
  if (on) start(); else maybeStop();
}

function setMusic(o) {
  if (typeof o.on === 'boolean') {
    musicOn = o.on;
    if (musicOn) { loadMusic(); start(); }
    maybeStop();
  }
  if (typeof o.volume === 'number' && isFinite(o.volume)) musicVolume = Math.max(0, Math.min(1, o.volume));
  saveState();
}
function getMusic() { return { on: musicOn, volume: musicVolume }; }
// État de la sortie pour la page d'observation.
function getStatus() { return { playing: !!player, voiceUsers, voiceActive: Date.now() / 1000 < duckUntil }; }

process.on('exit', stop);

// État d'avant le redémarrage : la musique reprend toute seule (en boucle, sans fin).
try {
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (typeof st.musicVolume === 'number') musicVolume = Math.max(0, Math.min(1, st.musicVolume));
  if (st.musicOn === true) setMusic({ on: true });
} catch { /* pas de fichier : musique coupée */ }

module.exports = { voice, voiceUser, setMusic, getMusic, getStatus, addListener, OUT_RATE };
