// Matrice WS2812 16x16 : image du visage (Face.render) -> LED, via scripts/ws2812_spi.py (bus SPI).
// Câblage et activation du SPI : voir AGENTS.md (section « Matrice LED »).
//
// Réglages dans leds.json à la racine du projet (tous facultatifs) :
//   enabled       false pour couper complètement les LED
//   device        périphérique SPI (défaut /dev/spidev0.0)
//   width/height  taille de la matrice (16 x 16)
//   vertical      true si le ruban serpente par COLONNES plutôt que par lignes
//   serpentine    true si une ligne (ou colonne) sur deux est câblée à l'envers (cas habituel)
//   rotate        0, 90, 180 ou 270 : rotation de l'image (matrice montée de travers)
//   flipX, flipY  miroir horizontal / vertical
//   brightness    luminosité de 0 à 1 (défaut 1 ; réglable aussi depuis le backoffice)
//   maxMilliamps  courant maximal estimé ; au-delà, l'image est assombrie (défaut 2000 mA)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true, device: '/dev/spidev0.0', width: 16, height: 16,
  vertical: false, serpentine: true, rotate: 0, flipX: false, flipY: false,
  brightness: 1, maxMilliamps: 2000
};
const CONFIG_FILE = path.join(__dirname, 'leds.json');
const RETRY_DELAY = 10000;

let cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch { /* pas de fichier : valeurs par défaut */ }
const W = cfg.width, H = cfg.height, N = W * H;

let helper = null, retryTimer = null, warned = false, testPattern = false;

// Position (x, y) de l'image (0, 0 = coin haut gauche, vu de face) -> numéro de LED sur le ruban.
function indexOf(x, y) {
  for (let r = ((cfg.rotate % 360) + 360) % 360; r > 0; r -= 90) { const t = x; x = W - 1 - y; y = t; }
  if (cfg.flipX) x = W - 1 - x;
  if (cfg.flipY) y = H - 1 - y;
  if (cfg.vertical) return x * H + (cfg.serpentine && x % 2 ? H - 1 - y : y);
  return y * W + (cfg.serpentine && y % 2 ? W - 1 - x : x);
}
const MAP = new Uint16Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) MAP[y * W + x] = indexOf(x, y);

function start() {
  if (helper || retryTimer || !cfg.enabled) return;
  helper = spawn('python3', [path.join(__dirname, 'scripts', 'ws2812_spi.py'), cfg.device, String(N)],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  helper.stderr.on('data', (d) => { err += d; });
  helper.stdin.on('error', () => {});
  helper.on('error', (e) => { err += e.message; });
  helper.on('exit', (code) => {
    helper = null;
    if (!warned) {
      warned = true;
      console.log(`Matrice LED : pilote arrêté (${err.trim() || 'code ' + code}).`);
      if (/spidev|SPI/.test(err)) console.log('  -> SPI inactif : voir AGENTS.md, section « Matrice LED » (dtparam=spi=on).');
    }
    retryTimer = setTimeout(() => { retryTimer = null; start(); }, RETRY_DELAY);
  });
  if (!warned) console.log(`Matrice LED : ${W}x${H} sur ${cfg.device} (luminosité ${Math.round(cfg.brightness * 100)} %)`);
}

// Mire de test (pour vérifier le câblage et l'orientation) :
//  ligne du haut et colonne de gauche allumées, flèche au centre qui pointe vers le haut (tout en blanc).
function testImage() {
  const px = new Uint8Array(N * 3);
  const set = (x, y, c) => { const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  for (let x = 0; x < W; x++) set(x, 0, [255, 255, 255]);
  for (let y = 1; y < H; y++) set(0, y, [255, 255, 255]);
  const cx = W >> 1;
  for (let y = 4; y < 13; y++) set(cx, y, [255, 255, 255]);
  for (let k = 1; k <= 3; k++) { set(cx - k, 4 + k, [255, 255, 255]); set(cx + k, 4 + k, [255, 255, 255]); }
  return px;
}

// rgb : image RGB ligne par ligne (Face.render), W*H*3 octets.
function show(rgb) {
  if (!cfg.enabled) return;
  if (!helper) { start(); if (!helper) return; }
  if (helper.stdin.writableLength > 0) return;            // image précédente pas encore partie : on saute
  if (testPattern) rgb = testImage();
  const out = Buffer.alloc(N * 3);
  let sum = 0;
  for (let p = 0; p < N; p++) {
    const o = MAP[p] * 3, i = p * 3;
    // WS2812 : ordre Vert, Rouge, Bleu.
    out[o] = rgb[i + 1] * cfg.brightness;
    out[o + 1] = rgb[i] * cfg.brightness;
    out[o + 2] = rgb[i + 2] * cfg.brightness;
    sum += out[o] + out[o + 1] + out[o + 2];
  }
  // Courant estimé : ~20 mA par canal à fond (+ ~1 mA de repos par LED).
  const mA = sum / 255 * 20 + N;
  if (mA > cfg.maxMilliamps) {
    const k = Math.max(0, (cfg.maxMilliamps - N) / (mA - N));
    for (let i = 0; i < out.length; i++) out[i] = out[i] * k;
  }
  helper.stdin.write(out);
}

function setBrightness(b) { cfg.brightness = Math.max(0, Math.min(1, b)); }
function getBrightness() { return cfg.brightness; }
function setTest(on) { testPattern = !!on; }
function getTest() { return testPattern; }

module.exports = { show, setBrightness, getBrightness, setTest, getTest, enabled: () => cfg.enabled, indexOf };
