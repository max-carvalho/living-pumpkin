// Visage de la citrouille : état de mouvements -> image 16x16, plus l'animateur « cartoon ».
// Module partagé : chargé par les pages web (window.Face) et par le serveur Node.
// Le futur pilote de la vraie matrice (Pi) réutilisera render() tel quel.
//
// Principe :
//  - la BOUCHE reproduit la forme réelle des lèvres de l'opérateur (contours MediaPipe, champ `lips`),
//    dessinée en contour vide d'un seul pixel d'épaisseur. Sans contour (curseurs, micro, veille),
//    elle est reconstruite à partir des paramètres jaw / mouthW / smile... ;
//  - les YEUX et SOURCILS sont volontairement exagérés (cartoon) : ils regardent là où la tête de
//    l'opérateur indique, et changent de forme selon les sourcils, les paupières et les joues ;
//  - tout est allumé ou éteint : aucun dégradé.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Face = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var W = 16;

  // Bouche
  //  jaw      ouverture verticale : 0 = fermée .. 1 = grand ouverte (« AAAH »)
  //  mouthW   largeur : -1 = lèvres avancées (« OU ») .. 0 = neutre .. +1 = étirée (« I »)
  //  mouthX   bouche décalée : -1 = à gauche .. +1 = à droite
  //  smile    courbure des coins : -1 = vers le bas .. +1 = vers le haut
  //  skew     asymétrie du sourire : -1 = coin gauche plus haut .. +1 = coin droit plus haut
  // Yeux (L = œil à gauche de l'écran)
  //  blinkL/R paupière : 0 = ouverte .. 1 = fermée
  //  squintL/R joue qui remonte : 0 = œil rond .. 1 = œil plissé (sourire sincère)
  //  wide     yeux écarquillés : 0 .. 1
  //  lookX/Y  regard : -1 = gauche/haut .. +1 = droite/bas
  // Sourcils
  //  browL/R  hauteur : -1 = baissé .. +1 = levé
  //  tiltL/R  inclinaison : -1 = bout intérieur bas (colère) .. +1 = bout intérieur haut (tristesse)
  // Contour réel des lèvres (optionnel) : lips = { outer: [[x, y], ...], inner: [[x, y], ...] }
  //  en coordonnées de la matrice (0..16), polygones fermés ; inner vide = bouche fermée.
  var DEFAULT_STATE = {
    jaw: 0, mouthW: 0, mouthX: 0, smile: 0.3, skew: 0,
    blinkL: 0, blinkR: 0, squintL: 0, squintR: 0, wide: 0, lookX: 0, lookY: 0,
    browL: 0, browR: 0, tiltL: 0, tiltR: 0
  };
  var RANGES = {
    jaw: [0, 1], mouthW: [-1, 1], mouthX: [-1, 1], smile: [-1, 1], skew: [-1, 1],
    blinkL: [0, 1], blinkR: [0, 1], squintL: [0, 1], squintR: [0, 1], wide: [0, 1], lookX: [-1, 1], lookY: [-1, 1],
    browL: [-1, 1], browR: [-1, 1], tiltL: [-1, 1], tiltR: [-1, 1]
  };
  // Les ressorts de l'animateur dépassent un peu leur cible (effet cartoon) : le rendu tolère ce dépassement.
  var SLACK = { browL: 1.3, browR: 1.3, tiltL: 1.3, tiltR: 1.3, lookX: 1.4, lookY: 1.4 };

  // Une couleur par élément, jamais de dégradé.
  var COLORS = { eye: [255, 215, 100], brow: [200, 95, 10], mouth: [255, 140, 20] };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Complète avec les valeurs par défaut et borne chaque champ (entrée réseau non fiable).
  function normalize(s, slack) {
    var out = {};
    out.lips = normalizeLips(s && s.lips);
    for (var k in DEFAULT_STATE) {
      var v = s && typeof s[k] === 'number' && isFinite(s[k]) ? s[k] : DEFAULT_STATE[k];
      var m = slack && SLACK[k] ? SLACK[k] : 1;
      out[k] = clamp(v, RANGES[k][0] * m, RANGES[k][1] * m);
    }
    return out;
  }

  function lerpState(a, b, k) {
    var out = {};
    for (var key in DEFAULT_STATE) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  }

  function overlap(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }
  function sq(v) { return v * v; }
  function smooth(e0, e1, x) { var q = clamp((x - e0) / (e1 - e0), 0, 1); return q * q * (3 - 2 * q); }

  // --- Contours de lèvres -------------------------------------------------------------------

  // Contour reçu du réseau : tableaux de points valides, bornés, de taille raisonnable.
  function normalizePoly(p, min) {
    if (!Array.isArray(p) || p.length > 64 || p.length < min) return null;
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var q = p[i];
      if (!Array.isArray(q) || typeof q[0] !== 'number' || typeof q[1] !== 'number' || !isFinite(q[0]) || !isFinite(q[1])) return null;
      out.push([clamp(q[0], -4, 20), clamp(q[1], -4, 22)]);
    }
    return out;
  }
  function normalizeLips(l) {
    if (!l) return null;
    var outer = normalizePoly(l.outer, 3), inner = normalizePoly(l.inner, 0);
    return outer && inner ? { outer: outer, inner: inner } : null;
  }

  // Point dans un polygone (règle pair/impair).
  function inside(poly, x, y) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function bbox(poly) {
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (var i = 0; i < poly.length; i++) {
      x0 = Math.min(x0, poly[i][0]); x1 = Math.max(x1, poly[i][0]);
      y0 = Math.min(y0, poly[i][1]); y1 = Math.max(y1, poly[i][1]);
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }

  // Bouche reconstruite à partir des paramètres (curseurs, micro, veille), sous forme de contours.
  function lipsFromParams(s) {
    var a = (2.6 + (s.mouthW + 1) / 2 * 3.6) * (1 - 0.1 * s.jaw);   // demi-largeur
    var cx = 7.5 + s.mouthX * 2;
    var lift = s.smile >= 0 ? s.smile * 2.6 : s.smile * 2.2;
    var p = 2.5 + 0.7 * Math.max(s.mouthW, 0);                       // plus la bouche est étirée, plus l'ouverture est carrée
    var top = [], bot = [], upBot = [], lowTop = [], maxOpen = 0;
    var N = 14;
    for (var k = 0; k <= N; k++) {
      var u = -0.985 + 1.97 * k / N, au = Math.abs(u), side = u < 0 ? -1 : 1;
      var x = cx + u * a;
      var B = 10.5 - lift * (1 + s.skew * side * 0.45) * Math.pow(au, 2.6);
      var bow = (0.2 * Math.exp(-sq((au - 0.33) / 0.2)) - 0.12 * Math.exp(-sq(u / 0.14))) * (1 - 0.75 * s.jaw);
      var prof = Math.pow(1 - Math.pow(au, p), 0.45);
      var hh = 4.0 * s.jaw * prof;
      var arch = 0.6 * s.jaw * prof;
      var taper = 0.35 + 0.65 * (1 - au * au * au);
      var kk = clamp(hh / 1.5, 0, 1);
      var tUp = (0.6 + 0.4 * kk) * taper, tLow = (0.6 + 0.45 * kk) * taper;
      var yT = B - (tUp + tLow) / 2 - bow;
      var yUpBot = yT + tUp - arch, yLowTop = yT + tUp + hh;
      top.push([x, yT - arch * 0.5]);
      bot.push([x, yLowTop + tLow]);
      upBot.push([x, yUpBot]);
      lowTop.push([x, yLowTop]);
      maxOpen = Math.max(maxOpen, yLowTop - yUpBot);
    }
    var outer = top.concat(bot.slice().reverse());
    var inner = maxOpen > 0.15 ? upBot.concat(lowTop.slice().reverse()) : [];
    return { outer: outer, inner: inner };
  }

  // Niveau de « cartoon » de la bouche : 0 = fidèle à la mesure, 1 = accentué, 2 = très exagéré.
  var ACCENT = 1;

  // Accentue le contour réel des lèvres, juste ce qu'il faut pour que ça se lise sur 16 pixels :
  //  - le sourire s'élargit et ses coins remontent davantage ;
  //  - une bouche étroite (« OU », « O ») se resserre, une bouche étirée (« I ») s'étire ;
  //  - une bouche ouverte s'ouvre un peu plus (« A », « O » plus hauts) ;
  //  - la fermeture est nette : sous un seuil, les lèvres se rejoignent et s'amincissent.
  function accentuate(lips) {
    var A = ACCENT;
    if (!A) return lips;
    var ob = bbox(lips.outer), w = ob.x1 - ob.x0;
    if (w < 0.5) return lips;
    var ib = lips.inner.length >= 3 ? bbox(lips.inner) : null;
    var h = ib ? ib.y1 - ib.y0 : 0;
    var cx = (ob.x0 + ob.x1) / 2, halfW = w / 2;
    var NEUTRAL_W = 8.8;

    var fx = clamp(NEUTRAL_W + (w - NEUTRAL_W) * (1 + 0.5 * A), 3.5, 14.5) / w;

    var minP = lips.outer[0], maxP = lips.outer[0], sumY = 0, i;
    for (i = 0; i < lips.outer.length; i++) {
      var q = lips.outer[i];
      if (q[0] < minP[0]) minP = q;
      if (q[0] > maxP[0]) maxP = q;
      sumY += q[1];
    }
    var lift = sumY / lips.outer.length - (minP[1] + maxP[1]) / 2;     // > 0 : coins plus hauts que le centre
    var extra = clamp(lift * 0.9 * A, -1.5, 1.6);

    var round = clamp((NEUTRAL_W - w) / 4, 0, 1);
    var g = 1 + (0.3 + 0.35 * round) * A * smooth(0.6, 1.8, h);
    var h2 = h * smooth(0.3, 0.9, h) * g;
    var delta = h2 - h;
    var closed = 1 - smooth(0.3, 0.9, h);                               // 1 = bien fermée
    var yMid = (ob.y0 + ob.y1) / 2;
    var pinch = 1 - 0.3 * closed * A;

    function tf(p) {
      var x = p[0], y = p[1];
      if (ib) y += delta * smooth(ib.y0, ib.y1, p[1]);
      y = yMid + (y - yMid) * pinch;
      var u = Math.min(1, Math.abs(p[0] - cx) / halfW);
      y -= extra * Math.pow(u, 2.2);
      x = clamp(cx + (x - cx) * fx, 0.2, 15.8);
      y = clamp(y, 7.8, 15.9);
      return [x, y];
    }
    return { outer: lips.outer.map(tf), inner: h2 < 0.2 ? [] : lips.inner.map(tf) };
  }

  // --- Rendu --------------------------------------------------------------------------------

  // Image 16x16 : Uint8Array de 768 octets (RGB, ligne par ligne). Chaque LED est allumée ou éteinte.
  function render(state) {
    var s = normalize(state, true);
    var px = new Uint8Array(W * W * 3);

    // Les formes sont calculées au sous-pixel dans une couverture (0..1) puis binarisées :
    // une LED est allumée si elle est couverte à plus de moitié. Pour qu'un trait fin ne
    // disparaisse jamais, la LED la plus couverte de chaque colonne reste allumée.
    function layer() { return new Float32Array(W * W); }
    function add(buf, x, y, v) {
      if (x < 0 || x >= W || y < 0 || y >= W) return;
      if (v > buf[y * W + x]) buf[y * W + x] = v;
    }
    function binarize(buf, minLine) {
      var mask = new Uint8Array(W * W);
      for (var x = 0; x < W; x++) {
        var best = -1, bv = 0, y;
        for (y = 0; y < W; y++) if (buf[y * W + x] > bv) { bv = buf[y * W + x]; best = y; }
        for (y = 0; y < W; y++) {
          var v = buf[y * W + x];
          if (v >= 0.5 || (y === best && v >= minLine)) mask[y * W + x] = 1;
        }
      }
      return mask;
    }
    function put(mask, c) {
      for (var i = 0; i < W * W; i++) {
        if (!mask[i]) continue;
        px[i * 3] = Math.max(px[i * 3], c[0]);
        px[i * 3 + 1] = Math.max(px[i * 3 + 1], c[1]);
        px[i * 3 + 2] = Math.max(px[i * 3 + 2], c[2]);
      }
    }

    // --- Yeux : deux blocs simples, très mobiles et très expressifs -----------------------
    //  - le regard les fait glisser de ±2 px, s'étirer vers le haut et s'écraser vers le bas ;
    //  - sourcils baissés vers l'intérieur (colère) : le coin intérieur du haut est coupé ;
    //  - sourcils relevés vers l'intérieur (tristesse) : le coin extérieur du haut est coupé ;
    //  - joues qui remontent (sourire sincère) : le bas de l'œil se relève en croissant ;
    //  - yeux écarquillés : plus grands ; paupières : écrasent l'œil jusqu'au trait.
    var EYE_W = 4, EYE_H = 3;
    var eyeBuf = layer(), browBuf = layer();
    function eye(xBase, blink, squint, tilt, innerOnRight) {
      var w = EYE_W + Math.abs(s.lookX) * 0.8 + s.wide * 0.6;
      var hOpen = EYE_H - s.lookY * 0.75 + s.wide * 0.9;
      var h = Math.max(0.7, hOpen * (1 - blink));
      var cx = xBase + EYE_W / 2 + s.lookX * 2.2;
      var cy = 5.5 + s.lookY * 2;
      var xl = cx - w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      var open = 1 - blink;
      var tops = {};                                                   // haut de l'œil par colonne (pour les sourcils)
      for (var x = Math.floor(xl); x < Math.ceil(xl + w); x++) {
        if (overlap(x, x + 1, xl, xl + w) < 0.5) continue;             // pas de demi-colonne : tout ou rien
        var tt = clamp((x + 0.5 - xl) / w, 0, 1);
        var tin = innerOnRight ? tt : 1 - tt;                          // 0 = extérieur, 1 = intérieur
        var cut = tilt < 0 ? -tilt * 1.4 * tin : tilt * 1.1 * (1 - tin);
        var arch = squint * 1.6 * (1 - Math.abs(tt - 0.5) * 2);        // yeux plissés : croissant « ∩ »
        var top = y0 + cut * open - arch * open;
        var bot = Math.max(top + 0.35, y1 - arch * open - squint * 0.6 * open);
        tops[x] = top;
        for (var y = Math.floor(top); y < Math.ceil(bot); y++) add(eyeBuf, x, y, overlap(y, y + 1, top, bot));
      }
      return { xl: xl, y0: y0, tops: tops };
    }
    var eL = eye(2, s.blinkL, s.squintL, s.tiltL, true);
    var eR = eye(10, s.blinkR, s.squintR, s.tiltR, false);

    // Sourcils : barre de 4 px posée sur la paupière, colonne par colonne. Hauteur et inclinaison
    // indépendantes ; ils ne recouvrent jamais l'œil.
    function brow(e, v, tilt, innerOnRight) {
      var col0 = Math.round(e.xl);
      for (var i = 0; i < 4; i++) {
        var tin = innerOnRight ? i / 3 : 1 - i / 3;
        var top = e.tops[col0 + i] !== undefined ? e.tops[col0 + i] : e.y0;
        var gap = v >= 0 ? 1.8 + v * 2.2 : 1.8 + v * 0.9;
        var y = top - gap - tilt * 1.0 * tin;                          // intérieur plus haut (triste) ou plus bas (colère)
        if (tilt > 0) y += tilt * 0.9 * (1 - tin);                     // extérieur qui tombe
        y = Math.max(0, Math.min(y, top - 1));
        var f = Math.floor(y);
        add(browBuf, col0 + i, f, 1 - (y - f));
        add(browBuf, col0 + i, f + 1, y - f);
      }
    }
    brow(eL, s.browL, s.tiltL, true);
    brow(eR, s.browR, s.tiltR, false);
    put(binarize(eyeBuf, 0.25), COLORS.eye);
    put(binarize(browBuf, 0.25), COLORS.brow);

    // --- Bouche : contour vide d'un pixel, un seul ton ---------------------------------------
    var lips = accentuate(s.lips || lipsFromParams(s));
    var ob = bbox(lips.outer);
    var cov = layer(), SS = 4;
    for (var py = Math.max(0, Math.floor(ob.y0)); py <= Math.min(W - 1, Math.floor(ob.y1)); py++) {
      for (var pxl = Math.max(0, Math.floor(ob.x0)); pxl <= Math.min(W - 1, Math.floor(ob.x1)); pxl++) {
        var n = 0;
        for (var ix = 0; ix < SS; ix++) {
          for (var iy = 0; iy < SS; iy++) {
            if (inside(lips.outer, pxl + (ix + 0.5) / SS, py + (iy + 0.5) / SS)) n++;
          }
        }
        cov[py * W + pxl] = n / (SS * SS);
      }
    }
    var mouth;
    if (lips.inner.length < 3) {
      // Fermée : un trait d'une LED d'épaisseur.
      mouth = new Uint8Array(W * W);
      for (var cx0 = 0; cx0 < W; cx0++) {
        var by = -1, bv = 0.15;
        for (var cy0 = 0; cy0 < W; cy0++) if (cov[cy0 * W + cx0] > bv) { bv = cov[cy0 * W + cx0]; by = cy0; }
        if (by >= 0) mouth[by * W + cx0] = 1;
      }
    } else {
      // Ouverte : on ne garde que le bord de la forme, l'intérieur reste éteint.
      var fill = binarize(cov, 0.15);
      mouth = new Uint8Array(W * W);
      for (var my = 0; my < W; my++) {
        for (var mx = 0; mx < W; mx++) {
          if (!fill[my * W + mx]) continue;
          var edge = mx === 0 || mx === W - 1 || my === 0 || my === W - 1 ||
            !fill[my * W + mx - 1] || !fill[my * W + mx + 1] || !fill[(my - 1) * W + mx] || !fill[(my + 1) * W + mx];
          if (edge) mouth[my * W + mx] = 1;
        }
      }
    }
    put(mouth, COLORS.mouth);
    return px;
  }

  // --- Animateur : donne vie à l'état cible (ressorts pour les yeux, clignements, veille) ---
  // step(cible, maintenantMs) renvoie l'état à afficher. À appeler ~30-40 fois par seconde.
  function createAnimator() {
    var D = normalize({});
    var V = { lookX: 0, lookY: 0, browL: 0, browR: 0, tiltL: 0, tiltR: 0 }; // vitesses des ressorts
    var last = null;
    var blinkStart = -1, nextBlink = 0, doubleBlink = false;
    var idleNext = 0, idleTarget = normalize({});
    var Dl = null; // contour des lèvres affiché (suit le contour cible, quasi sans retard)

    function followLips(target, dt) {
      if (!target) { Dl = null; return; }
      var ok = Dl && Dl.outer.length === target.outer.length && Dl.inner.length === target.inner.length;
      if (!ok) { Dl = { outer: target.outer.map(function (p) { return p.slice(); }), inner: target.inner.map(function (p) { return p.slice(); }) }; return; }
      var f = 1 - Math.exp(-dt / 0.022);
      ['outer', 'inner'].forEach(function (key) {
        for (var i = 0; i < Dl[key].length; i++) {
          Dl[key][i][0] += (target[key][i][0] - Dl[key][i][0]) * f;
          Dl[key][i][1] += (target[key][i][1] - Dl[key][i][1]) * f;
        }
      });
    }

    function spring(key, target, omega, zeta, dt) {
      var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
      for (var i = 0; i < n; i++) {
        var acc = omega * omega * (target - D[key]) - 2 * zeta * omega * V[key];
        V[key] += acc * h;
        D[key] += V[key] * h;
      }
    }
    function follow(key, target, tau, dt) { D[key] += (target - D[key]) * (1 - Math.exp(-dt / tau)); }

    function autoBlink(now) {
      if (blinkStart < 0 && now >= nextBlink) {
        blinkStart = now;
        doubleBlink = Math.random() < 0.15;
        nextBlink = now + 2500 + Math.random() * 3500;
      }
      if (blinkStart < 0) return 0;
      var p = (now - blinkStart) / 170;
      if (p >= 1) {
        blinkStart = -1;
        if (doubleBlink) { doubleBlink = false; nextBlink = now + 90; }
        return 0;
      }
      return Math.sin(Math.PI * p);
    }

    return {
      // Cible de veille : regard qui saute d'un point à l'autre, humeurs qui passent sur le visage.
      idleTarget: function (now) {
        if (now >= idleNext) {
          idleNext = now + 900 + Math.random() * 2200;
          var still = Math.random() < 0.25, m = Math.random();
          var t = {
            lookX: still ? 0 : Math.random() * 2 - 1,
            lookY: still ? 0 : Math.random() * 1.4 - 0.7,
            smile: 0.3
          };
          if (m > 0.5 && m <= 0.65) { t.browL = t.browR = 0.9; t.wide = 0.8; }                                   // surpris
          else if (m > 0.65 && m <= 0.8) { t.browL = t.browR = -0.4; t.tiltL = t.tiltR = -0.9; t.smile = -0.5; } // fâché
          else if (m > 0.8 && m <= 0.9) { t.tiltL = t.tiltR = 0.9; t.browL = t.browR = 0.2; t.smile = -0.4; }    // triste
          else if (m > 0.9) { t.squintL = t.squintR = 0.8; t.smile = 0.9; }                                       // content
          idleTarget = normalize(t);
        }
        return idleTarget;
      },
      step: function (target, now) {
        var T = normalize(target);
        var dt = last === null ? 0.033 : clamp((now - last) / 1000, 0.001, 0.1);
        last = now;
        follow('jaw', T.jaw, 0.02, dt);          // bouche : quasi sans retard, pour le réalisme
        follow('mouthW', T.mouthW, 0.035, dt);
        follow('mouthX', T.mouthX, 0.05, dt);
        follow('smile', T.smile, 0.05, dt);
        follow('skew', T.skew, 0.05, dt);
        var ab = autoBlink(now);
        follow('blinkL', Math.max(T.blinkL, ab), 0.025, dt);
        follow('blinkR', Math.max(T.blinkR, ab), 0.025, dt);
        follow('squintL', T.squintL, 0.04, dt);
        follow('squintR', T.squintR, 0.04, dt);
        follow('wide', T.wide, 0.04, dt);
        spring('lookX', T.lookX, 24, 0.42, dt);  // yeux : ressorts sous-amortis = dépassement cartoon
        spring('lookY', T.lookY, 24, 0.42, dt);
        spring('browL', T.browL, 20, 0.5, dt);
        spring('browR', T.browR, 20, 0.5, dt);
        spring('tiltL', T.tiltL, 20, 0.5, dt);
        spring('tiltR', T.tiltR, 20, 0.5, dt);
        followLips(T.lips, dt);
        var out = {};
        for (var k in D) out[k] = D[k];
        out.lips = Dl;
        return out;
      }
    };
  }

  return {
    W: W, DEFAULT_STATE: DEFAULT_STATE, RANGES: RANGES,
    normalize: normalize, lerpState: lerpState, render: render, createAnimator: createAnimator,
    setAccent: function (v) { ACCENT = v; }
  };
});
