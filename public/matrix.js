// Affichage simulé de la matrice 16x16.
//  mode 'led'      : grille de LED sur fond noir
//  mode 'pumpkin'  : même image diffusée à travers une chair de citrouille (flou + teinte orange)
function MatrixView(canvas) {
  var ctx = canvas.getContext('2d');
  var N = Face.W;
  var mode = 'led';
  var last = new Uint8Array(N * N * 3);
  var layer = document.createElement('canvas');
  var lctx = layer.getContext('2d');

  function size() {
    var s = canvas.width;
    if (layer.width !== s) { layer.width = s; layer.height = s; }
    return s;
  }

  function drawLeds(px) {
    var s = size();
    ctx.fillStyle = '#060504';
    ctx.fillRect(0, 0, s, s);
    var cell = s / N;
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = (y * N + x) * 3;
        var on = px[i] + px[i + 1] + px[i + 2] > 0;
        ctx.beginPath();
        ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
        ctx.fillStyle = on ? 'rgb(' + px[i] + ',' + px[i + 1] + ',' + px[i + 2] + ')' : '#14110e';
        ctx.fill();
      }
    }
  }

  function drawPumpkin(px) {
    var s = size();
    ctx.fillStyle = '#0b0805';
    ctx.fillRect(0, 0, s, s);

    // Corps de la citrouille.
    var g = ctx.createRadialGradient(s * 0.5, s * 0.55, s * 0.05, s * 0.5, s * 0.55, s * 0.5);
    g.addColorStop(0, '#7a3208');
    g.addColorStop(1, '#2e1203');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.56, s * 0.48, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a0c';
    ctx.fillRect(s * 0.46, s * 0.08, s * 0.08, s * 0.1);

    // Les LED, plus petites, dessinées sur un calque puis diffusées par la chair.
    lctx.clearRect(0, 0, s, s);
    var area = s * 0.66, ox = (s - area) / 2, oy = s * 0.24, cell = area / N;
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = (y * N + x) * 3;
        if (px[i] + px[i + 1] + px[i + 2] === 0) continue;
        lctx.fillStyle = 'rgb(' + px[i] + ',' + px[i + 1] + ',' + px[i + 2] + ')';
        lctx.fillRect(ox + x * cell, oy + y * cell, cell * 0.92, cell * 0.92);
      }
    }
    var blur = Math.max(2, Math.round(s / 70));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(' + blur * 2 + 'px)';
    ctx.drawImage(layer, 0, 0);
    ctx.filter = 'blur(' + blur + 'px)';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  function draw(px) {
    last = px || last;
    if (mode === 'pumpkin') drawPumpkin(last); else drawLeds(last);
  }

  return {
    draw: draw,
    setMode: function (m) { mode = m; draw(); },
    getMode: function () { return mode; }
  };
}
