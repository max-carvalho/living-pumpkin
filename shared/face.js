// Visage de la citrouille : état de mouvements -> image 16x16, plus l'animateur « cartoon ».
// Module partagé : chargé par les pages web (window.Face) et par le serveur Node.
// Le futur pilote de la vraie matrice (Pi) réutilisera render() tel quel.
//
// Principe :
//  - la BOUCHE reproduit la forme réelle des lèvres de l'opérateur (contours MediaPipe, champ `lips`),
//    dessinée en contour vide d'un seul pixel d'épaisseur. Sans contour (curseurs, micro, veille),
//    elle est reconstruite à partir des paramètres jaw / mouthW / smile... ;
//    Seul le bruit de symétrie (< 0,15 px) est corrigé, et l'axe est calé sur la grille de LED ;
//  - les YEUX sont des triangles de citrouille de forme fixe : ils regardent là où la tête de
//    l'opérateur indique et se ferment, c'est tout. Les SOURCILS portent les émotions ;
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
  //  squintL/R joue qui remonte : sans effet depuis les yeux en triangle (gardé pour compatibilité)
  //  wide     yeux écarquillés : 0 .. 1 (fait monter les sourcils)
  //  lookX/Y  regard : -1 = gauche/haut .. +1 = droite/bas
  // Sourcils
  //  browL/R  hauteur : -1 = baissé .. +1 = levé
  //  tiltL/R  inclinaison : -1 = bout intérieur bas (colère) .. +1 = bout intérieur haut (tristesse)
  // Contour réel des lèvres (optionnel) : lips = { outer: [[x, y], ...], inner: [[x, y], ...] }
  //  en coordonnées de la matrice (0..16), polygones fermés ; inner vide = bouche fermée.
  //  Pour la symétrie légère (symmetrizeNoise), coins aux indices 0 et N/2, le point i ayant pour reflet N/2 - i.
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

  // Blanc pur à pleine puissance pour tout : la chair de la citrouille teinte déjà la lumière en orange.
  // Couleur unique des LED, changeable depuis le backoffice (setColor) : le tableau est modifié sur place.
  var WHITE = [255, 255, 255];
  var COLORS = { eye: WHITE, brow: WHITE, mouth: WHITE };

  // Images plein écran (boutons pierre / feuille / ciseaux du backoffice), '#' = LED allumée.
  // Glyphes ✊ ✋ ✌ (U+270A à U+270C) de GNU Unifont 16.0.04 (unifoundry.com, licence SIL OFL 1.1 / GPL
  // avec exception pour les polices) : un même jeu de dessins 16x16, au lieu de dessins faits main.
  var ICONS = {
    pierre: [
      '................',
      '................',
      '................',
      '................',
      '......##.##.....',
      '....##..#..#....',
      '...#.#..#..#....',
      '..##.#.######...',
      '.#.#.#.#.....#..',
      '.#.#.#..###..#..',
      '.#.#.#..##...#..',
      '..##.###.....#..',
      '..#.#.......#...',
      '...#.......#....',
      '....#######.....',
      '................'
    ],
    feuille: [
      '................',
      '....#.#.#.......',
      '...#.#.#.#......',
      '...#.#.#.#......',
      '..##.#.#.#......',
      '.#.#.#.#.#......',
      '.#.#.#.#.#..##..',
      '.#.#.#.#.#.#..#.',
      '.#........#...#.',
      '.#...........#..',
      '.#..........#...',
      '..#........#....',
      '...#.......#....',
      '....#######.....',
      '................',
      '................'
    ],
    ciseaux: [
      '...##.....##....',
      '..#..#...#..#...',
      '..#...#.#...#...',
      '...#..#.#..#....',
      '...#...#...#....',
      '....#..#..#.....',
      '....#.....#.....',
      '.#####..######..',
      '#..#..#.#.....#.',
      '#..#..#..###..#.',
      '#..#..#...#...#.',
      '#..#..#..#....#.',
      '.#####.......#..',
      '..#.........#...',
      '...#########....',
      '................'
    ],
    // Blagues (2026-10-31) : texte en chiffres de 3x7 pixels faits main.
    prix: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '###...##.#.#.###',
      '..#..#...#.#.#.#',
      '..#.####.#.#.#.#',
      '###..#...###.#.#',
      '#...####...#.#.#',
      '#....#.....#.#.#',
      '###...##...#.###',
      '................',
      '................',
      '................',
      '................'
    ]
  };

  // Image RGB (même format que render) d'une des ICONS ; null si le nom est inconnu.
  function icon(name) {
    var rows = ICONS.hasOwnProperty(name) ? ICONS[name] : null;
    if (!rows) return null;
    var img = new Uint8Array(W * W * 3);
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) {
      if (rows[y].charAt(x) !== '#') continue;
      img.set(WHITE, (y * W + x) * 3);
    }
    return img;
  }

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

    // Largeur : étirée x1,5 autour du neutre, mais resserrée bien plus fort (x2,4) : les lèvres réelles ne
    // rétrécissent que de 20 à 25 % (« OU »), il faut ça pour voir les variations de la bouche étroite (2026-10-31).
    var gainW = w < NEUTRAL_W ? 1 + 1.4 * A : 1 + 0.5 * A;
    var fx = clamp(NEUTRAL_W + (w - NEUTRAL_W) * gainW, 3, 14.5) / w;

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

  // Symétrie légère du contour mesuré : chaque point est rapproché de son reflet UNIQUEMENT quand
  // l'écart est minuscule (< 0,15 px : bruit de mesure). Toute asymétrie réelle (sourire en coin,
  // lèvre qui bouge d'un côté) passe intacte, et aucun mouvement n'est lissé ni retardé.
  // Convention des anneaux (backoffice) : coins aux indices 0 et N/2, reflet du point i = N/2 - i.
  var SYM_NOISE = 0.15;
  var SYM_PIX = 0.35;  // rendu : bouche rendue symétrique si ça change au plus 2 pixels ou 35 % de ses pixels (un pixel déplacé compte 2)
  function symmetrizeNoise(l) {
    var N = l.outer.length;
    if (N % 2 || (l.inner.length && l.inner.length !== N)) return l;
    var cx = (l.outer[0][0] + l.outer[N / 2][0]) / 2;
    function ring(r) {
      return r.map(function (p, i) {
        var m = r[(N / 2 - i + N) % N];
        var mx = 2 * cx - m[0], my = m[1];
        var d = Math.sqrt(sq(p[0] - mx) + sq(p[1] - my));
        var k = 0.5 * (1 - smooth(SYM_NOISE * 0.5, SYM_NOISE, d));     // 0,5 = moyenne exacte ; 0 = intact
        return [p[0] + (mx - p[0]) * k, p[1] + (my - p[1]) * k];
      });
    }
    return { outer: ring(l.outer), inner: l.inner.length ? ring(l.inner) : [] };
  }

  // Cale l'axe de la bouche sur la grille de LED (décalage < 0,25 px) : une forme symétrique
  // donne alors des pixels symétriques.
  function snapAxis(l) {
    var b = bbox(l.outer), cx = (b.x0 + b.x1) / 2, d = Math.round(cx * 2) / 2 - cx;
    function sh(p) { return [p[0] + d, p[1]]; }
    return { outer: l.outer.map(sh), inner: l.inner.map(sh) };
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

    // --- Yeux : triangles de citrouille MÉCHANTE ---------------------------------------
    // Triangles rectangles « ◣ ◢ » : coin extérieur haut, pente qui plonge vers le nez = regard mauvais.
    // Forme fixe : les yeux bougent (regard) et se ferment, mais ne changent pas de forme avec
    // l'humeur. Ce sont les SOURCILS qui portent les émotions.
    //  - regard : le triangle glisse d'un bloc, aligné sur la grille de LED ;
    //  - clignement : la paupière efface le triangle par le haut, puis il ne reste
    //    qu'une petite barre horizontale.
    var EYE = ['##...', '####.', '#####'];                             // œil gauche ; l'œil droit en est le reflet
    var EYE_W = 5, EYE_H = 3, EYE_TOP = 4, BAR = 3;
    var eyeMask = new Uint8Array(W * W);
    function eye(xBase, blink, mirror) {
      var xl = xBase + Math.round(s.lookX * 2);
      var top = EYE_TOP + Math.round(s.lookY * 1.2);
      var hidden = blink >= 0.85 ? EYE_H : Math.floor(blink / 0.85 * EYE_H); // rangées effacées par la paupière
      for (var r = 0; r < EYE_H; r++) {
        for (var c = 0; c < EYE_W; c++) {
          var on = r < hidden ? false : EYE[r][mirror ? EYE_W - 1 - c : c] === '#';
          if (blink >= 0.85) on = r === EYE_H - 1 && Math.abs(c - (EYE_W - 1) / 2) <= (BAR - 1) / 2;
          var x = xl + c, y = top + r;
          if (on && x >= 0 && x < W && y >= 0 && y < W) eyeMask[y * W + x] = 1;
        }
      }
      // Le sourcil se place par rapport à l'œil OUVERT : il ne bouge pas quand la paupière se ferme.
      var openTop = [];
      for (c = 0; c < EYE_W; c++) {
        for (r = 0; r < EYE_H && EYE[r][mirror ? EYE_W - 1 - c : c] !== '#'; r++);
        openTop.push(top + r);
      }
      return { xl: xl, top: top, openTop: openTop };
    }
    var eL = eye(2, s.blinkL, false);
    var eR = eye(9, s.blinkR, true);
    put(eyeMask, COLORS.eye);

    // --- Sourcils : toute l'émotion passe par eux -----------------------------------------
    // Au repos, ils sont froncés vers le nez (EVIL) : la citrouille a l'air mauvaise même sans rien faire.
    // Un trait d'un pixel, de la largeur de l'œil :
    //  - hauteur : levé (surprise, joie) ou baissé (concentration, méfiance) ;
    //  - inclinaison : bout intérieur bas = colère « \ / », bout intérieur haut = tristesse « / \ » ;
    //  - sourcil levé et droit : il s'arrondit en arc ; yeux écarquillés : il monte encore.
    // Il épouse la pente du triangle et reste toujours séparé de l'œil par une LED éteinte (sinon il se confond avec lui).
    // Course (2026-10-31, l'opérateur trouvait le suivi trop faible) : levé jusqu'à 2 rangées (3 écarquillé),
    // pente de -2 à +2 ; baissé, il n'a pas la place de descendre : il fronce davantage. Un petit mouvement
    // suffit à bouger d'un pixel.
    var browMask = new Uint8Array(W * W);
    var EVIL = 1;                                                      // pente de repos (froncé), en rangées
    function brow(e, v, tilt, innerOnRight) {
      v = clamp(v + s.wide * 0.6, -1.3, 1.5);
      // Pente en nombre entier de rangées, tracée par paliers réguliers (pixel art) :
      // D > 0 : bout intérieur plus bas (méchant, colère) ; D < 0 : bout intérieur plus haut (tristesse).
      var D = clamp(Math.round(EVIL - tilt * 2 - Math.min(0, v) * 1.5), -2, 2);
      var lift = v > 0 ? Math.round(v * 2) : 0;                        // 0, 1, 2 (3 avec les yeux écarquillés)
      var outerRow = e.top - 2 - lift;
      if (D < 0) outerRow -= D;                                        // tristesse : l'extérieur tombe
      var arc = D === 0 && v > 0.5;                                    // sourcil levé et droit : arc
      var ys = [], lift2 = 0, i;
      for (i = 0; i < EYE_W; i++) {
        var j = innerOnRight ? i : EYE_W - 1 - i;                      // 0 = extérieur .. 4 = intérieur
        var step = Math.floor(j * (Math.abs(D) + 1) / EYE_W);         // 0,0,0,1,1 ou 0,0,1,1,2
        ys.push(outerRow + (D >= 0 ? step : -step) + (arc && (j === 0 || j === EYE_W - 1) ? 1 : 0));
        lift2 = Math.max(lift2, ys[i] - (e.openTop[i] - 2));       // trop près de l'œil : on remonte tout le sourcil
      }
      for (i = 0; i < EYE_W; i++) {
        var col = e.xl + i, row = Math.max(0, ys[i] - lift2);
        if (col >= 0 && col < W && row < e.openTop[i]) browMask[row * W + col] = 1;
      }
    }
    brow(eL, s.browL, s.tiltL, true);
    brow(eR, s.browR, s.tiltR, false);
    put(browMask, COLORS.brow);

    // --- Bouche : contour vide d'un pixel, un seul ton ---------------------------------------
    var lips = snapAxis(accentuate(s.lips ? symmetrizeNoise(s.lips) : lipsFromParams(s)));
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
    var closed = lips.inner.length < 3;
    function mouthMask(c) {
      var m = new Uint8Array(W * W), x, y;
      if (closed) {
        // Fermée : un trait d'une LED d'épaisseur.
        var rows = [];
        for (x = 0; x < W; x++) {
          var by = -1, bv = 0.15;
          for (y = 0; y < W; y++) if (c[y * W + x] > bv) { bv = c[y * W + x]; by = y; }
          rows.push(by);
        }
        // Pixel isolé d'une rangée au-dessus ou en dessous de ses deux voisins (alignés) : recalé sur eux.
        for (x = 1; x < W - 1; x++) {
          var l = rows[x - 1], r = rows[x + 1];
          if (l >= 0 && l === r && rows[x] >= 0 && Math.abs(rows[x] - l) === 1) rows[x] = l;
        }
        for (x = 0; x < W; x++) if (rows[x] >= 0) m[rows[x] * W + x] = 1;
      } else {
        // Ouverte : on ne garde que le bord de la forme, l'intérieur reste éteint.
        var fill = binarize(c, 0.15);
        for (y = 0; y < W; y++) {
          for (x = 0; x < W; x++) {
            if (!fill[y * W + x]) continue;
            var edge = x === 0 || x === W - 1 || y === 0 || y === W - 1 ||
              !fill[y * W + x - 1] || !fill[y * W + x + 1] || !fill[(y - 1) * W + x] || !fill[(y + 1) * W + x];
            if (edge) m[y * W + x] = 1;
          }
        }
      }
      return m;
    }
    var mouth = mouthMask(cov);
    // Presque symétrique au pixel près (ouverte ou fermée) : on la rend symétrique, c'est plus propre.
    // Couverture moyennée avec son reflet par rapport à l'axe (calé sur la grille par snapAxis), puis
    // on garde cette version si elle change peu de pixels (SYM_PIX) : une vraie asymétrie
    // (sourire en coin franc, bouche de côté) reste intacte.
    var M = Math.round(ob.x0 + ob.x1);                                 // reflet de la colonne x : M - 1 - x
    var covS = layer();
    for (var sy = 0; sy < W; sy++) {
      for (var sx = 0; sx < W; sx++) {
        var mxr = M - 1 - sx, v = cov[sy * W + sx];
        covS[sy * W + sx] = mxr >= 0 && mxr < W ? (v + cov[sy * W + mxr]) / 2 : v;
      }
    }
    var sym = mouthMask(covS), diff = 0, on = 0;
    for (var si = 0; si < W * W; si++) { diff += mouth[si] !== sym[si]; on += mouth[si]; }
    if (diff <= Math.max(2, on * SYM_PIX)) mouth = sym;
    put(mouth, COLORS.mouth);

    return px;
  }

  // Bouche en demi-lune du mode sommeil : bord haut plat de x = 2,5 à 13,5, arc de 4 de profondeur,
  // centrée sur l'axe du visage (x = 8, entre les colonnes 7 et 8). Coins aux indices 0 et N.
  var MOON = (function () {
    var cx = 8, y0 = 9.5, rx = 5.5, ry = 4, N = 12, outer = [], k;
    for (k = 0; k <= N; k++) outer.push([cx + (-1 + 2 * k / N) * rx, y0]);
    for (k = 1; k < N; k++) outer.push([cx + rx * Math.cos(Math.PI * k / N), y0 + ry * Math.sin(Math.PI * k / N)]);
    var inner = outer.map(function (p) { return [cx + (p[0] - cx) * 0.6, y0 + 0.4 + (p[1] - y0) * 0.5]; });
    return { outer: outer, inner: inner };
  })();

  // --- Animateur : donne vie à l'état cible (ressorts pour les yeux, clignements, veille) ---
  // step(cible, maintenantMs) renvoie l'état à afficher. À appeler ~30-40 fois par seconde.
  function createAnimator() {
    var D = normalize({});
    var V = { lookX: 0, lookY: 0, browL: 0, browR: 0, tiltL: 0, tiltR: 0 }; // vitesses des ressorts
    var last = null;
    var blinkStart = -1, nextBlink = 0, doubleBlink = false;
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
      // Sommeil : tête classique de citrouille, immobile. Yeux ouverts, sourcils froncés (froncement
      // de repos EVIL) et bouche en demi-lune (haut plat, de la largeur des yeux, 4 rangées).
      // (Avant le 2026-10-30, la veille montrait une citrouille endormie, yeux fermés.)
      idleTarget: function () {
        return normalize({ lips: MOON });
      },
      // opts.autoBlink = false : pas de clignement automatique (mode manuel, on suit le comédien).
      step: function (target, now, opts) {
        var T = normalize(target);
        var dt = last === null ? 0.033 : clamp((now - last) / 1000, 0.001, 0.1);
        last = now;
        follow('jaw', T.jaw, 0.02, dt);          // bouche : quasi sans retard, pour le réalisme
        follow('mouthW', T.mouthW, 0.035, dt);
        follow('mouthX', T.mouthX, 0.05, dt);
        follow('smile', T.smile, 0.05, dt);
        follow('skew', T.skew, 0.05, dt);
        var ab = opts && opts.autoBlink === false ? 0 : autoBlink(now);
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
    ICONS: ICONS, icon: icon,
    setAccent: function (v) { ACCENT = v; },
    // Couleur de toutes les LED allumées (visage et images), [r, g, b] de 0 à 255.
    setColor: function (c) {
      if (!c || c.length !== 3) return;
      for (var i = 0; i < 3; i++) WHITE[i] = clamp(Math.round(+c[i] || 0), 0, 255);
    },
    getColor: function () { return WHITE.slice(); }
  };
});
