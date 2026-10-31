// Voix de l'opérateur -> haut-parleur du Pi (F3), transformée en voix de « lutin » (F9).
// Le téléphone envoie son micro en PCM 16 bits, mono, 16 kHz (WebSocket /ws?role=voice) ; le Pi
// applique l'effet ci-dessous puis l'envoie à son.js (mélange avec la musique, sortie aplay).
//
// Public visé : de jeunes enfants, la voix doit faire rire plutôt que peur (2026-10-31). Effet fixe :
//  - voix un peu plus aiguë (+3,3 demi-tons, formants compris), elle reste naturelle ;
//  - présence (+dB vers 3 kHz) pour garder les consonnes bien nettes ;
//  - porte de bruit : on n'amplifie pas le souffle quand personne ne parle.
// Décaleur de hauteur à ligne à retard, avec raccords calés sur la forme d'onde (voir makeShifter) :
// sans eux, les deux têtes se déphasent et la voix sonne « témoin anonyme » / robot.
// Essayés puis retirés : voix de monstre grave (sous-octave, voix rauque, grognement : trop flippante),
// voix d'hélium (+8 demi-tons), curseur de déformation, modulation en anneau, doublage, formants par LPC,
// vibrato (robotique). Pas d'écho : la citrouille résonne déjà.
const Son = require('./son.js');

const RATE = 16000;
const FX = {
  pitch: 1.21,                   // ≈ +3,3 demi-tons (l'ancien style « lutin » à 70 %)
  presenceDb: 3.4,               // consonnes plus nettes
  lowpassHz: 7600,               // coupe juste le haut du spectre
  gateLevel: 0.012,              // niveau RMS en dessous duquel on coupe progressivement
  gateHoldMs: 350,               // porte gardée ouverte après la parole (fins de mots, consonnes finales)
  gateReleaseMs: 150,            // puis fermeture en douceur
  gain: 0.9
};

// Décalage de hauteur par ligne à retard : deux têtes de lecture décalées d'une demi-fenêtre,
// fondues en sin² / cos² (la somme des gains vaut toujours 1). Quand une tête saute (gain nul), on
// décale son point de reprise de 0 à MAX_LAG échantillons pour que sa forme d'onde coïncide avec celle
// de l'autre tête (meilleure corrélation) : plus de déphasage entre les têtes, donc plus de son métallique.
const MAX_LAG = 200;   // 12,5 ms : une période de voix grave (80 Hz)
const CORR_LEN = 240;  // 15 ms comparées
function makeShifter(ratio, win) {
  const N = 8192, buf = new Float32Array(N);
  const inc = (1 - ratio) / win;
  const off = [0, 0], last = [0, 0];
  let w = 0, phase = 0;
  const at = (pos) => buf[((Math.round(pos) % N) + N) % N];
  // Meilleur décalage pour la tête k qui reprend à la position r, d'après l'autre tête en rO.
  function bestLag(r, rO) {
    let best = 0, bestC = -Infinity;
    for (let lag = 0; lag <= MAX_LAG; lag += 2) {
      let c = 0, e = 1e-9;
      for (let j = 0; j < CORR_LEN; j += 3) {
        const v = at(r - lag + j * ratio - CORR_LEN * ratio);
        c += v * at(rO + j * ratio - CORR_LEN * ratio);
        e += v * v;
      }
      c /= Math.sqrt(e);
      if (c > bestC) { bestC = c; best = lag; }
    }
    return best;
  }
  return function (x) {
    buf[w] = x;
    let y = 0;
    for (let k = 0; k < 2; k++) {
      const p = (phase + k * 0.5) % 1;
      if (Math.abs(p - last[k]) > 0.5) {                            // la tête vient de sauter
        const pO = (phase + (1 - k) * 0.5) % 1;
        off[k] = bestLag(w - p * win - 1, w - pO * win - 1 - off[1 - k]);
      }
      last[k] = p;
      const d = p * win + 1 + off[k];
      let r = w - d; if (r < 0) r += N;
      const i = Math.floor(r) % N, f = r - Math.floor(r);              // % N : r peut valoir N à l'arrondi près
      const s = buf[i] * (1 - f) + buf[(i + 1) % N] * f;
      const g = Math.sin(Math.PI * p);
      y += s * g * g;
    }
    phase = (phase + inc + 1) % 1;
    w = (w + 1) % N;
    return y;
  };
}

// Filtre biquad en cloche (formules RBJ) : +gainDb autour de f.
function makePeak(f, q, gainDb) {
  const w0 = 2 * Math.PI * f / RATE, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1 + al * A; b1 = -2 * cs, b2 = 1 - al * A, a0 = 1 + al / A, a1 = -2 * cs, a2 = 1 - al / A;
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return function (x) {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function createFx(fx = FX) {
  const shift = makeShifter(fx.pitch, 800);
  const presence = makePeak(3000, 0.8, fx.presenceDb);
  let lp = 0, gate = 0, hold = 0;
  const holdLen = Math.round(fx.gateHoldMs * RATE / 1000);
  const release = 1 / (fx.gateReleaseMs * RATE / 1000);
  const lpA = 1 - Math.exp(-2 * Math.PI * fx.lowpassHz / RATE);
  const norm = Math.tanh(1);
  return function process(int16) {
    // Porte de bruit sur le niveau du morceau (20 ms environ).
    let e = 0;
    for (let i = 0; i < int16.length; i++) e += int16[i] * int16[i];
    const rms = Math.sqrt(e / Math.max(1, int16.length)) / 32768;
    if (rms > fx.gateLevel) hold = holdLen; else hold = Math.max(0, hold - int16.length);
    const gateTarget = hold > 0 ? 1 : 0;
    const out = new Int16Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      gate += (gateTarget - gate) * (gateTarget > gate ? 0.02 : release);
      let y = shift(int16[i] / 32768 * gate);
      y = Math.tanh(y) / norm;                                      // saturation très douce (crêtes)
      lp += lpA * (y - lp);
      y = presence(lp) * fx.gain;
      out[i] = Math.max(-32767, Math.min(32767, Math.round(y * 32767)));
    }
    return out;
  };
}

let process_ = createFx(), speaker = null;
// Mode debug : la voix sort DEBUG_DELAY plus tard, pour que l'opérateur s'écoute après avoir parlé.
const DEBUG_DELAY = 2000;
let debug = false, debugGen = 0;   // debugGen : invalide les morceaux en attente quand on change de mode

function play(chunk) {
  // L'effet est appliqué tout de suite (son état reste continu) ; seule la sortie est retardée.
  const pcm = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length >> 1);
  const out = process_(pcm);
  if (!debug) { Son.voice(out); return; }
  const gen = debugGen;
  setTimeout(() => { if (gen === debugGen) Son.voice(out); }, DEBUG_DELAY);
}

// Un seul opérateur parle à la fois : une nouvelle connexion remplace l'ancienne.
function add(ws) {
  if (speaker && speaker !== ws) speaker.close();
  speaker = ws;
  Son.voiceUser(true);
  console.log('Voix : téléphone connecté');
  ws.send(JSON.stringify({ type: 'voice', rate: RATE }));
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { console.log('Voix : téléphone ->', String(data).slice(0, 200)); return; }   // diagnostic
    if (speaker !== ws) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data);
    // Copie alignée (Int16Array exige un décalage pair).
    play(buf.byteOffset % 2 ? Buffer.from(buf) : buf);
  });
  ws.on('close', () => {
    Son.voiceUser(false);
    if (speaker === ws) speaker = null;
  });
}

function setDebug(on) {
  if (on === debug) return;
  debug = on;
  debugGen++;
}
function getDebug() { return debug; }
// Retard ajouté au visage pour qu'il reste synchrone avec la voix retardée.
function debugDelay() { return debug ? DEBUG_DELAY : 0; }

module.exports = { add, createFx, FX, setDebug, getDebug, debugDelay, RATE };
