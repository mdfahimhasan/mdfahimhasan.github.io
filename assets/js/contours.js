/*
  Hero map. Layers, bottom to top:
    1. Groundwater contours (a slowly drifting water table)
    2. Irrigated farmland: center pivots and strip fields on a section grid
    3. Satellite passes: the swath turns fields into a pixel map of
       machine-learning water-use estimates, which fades after the pass
    4. A drone flying a survey pattern over one field at finer resolution
    5. The cursor: a pumping well that pulls down a cone of depression
  No settings to edit here; colors come from the CSS variables.
*/
(function () {
  var canvas = document.querySelector('.hero-map');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 3D simplex noise (after Stefan Gustavson, public domain) ---------- */
  var grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  var perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  (function seed(s) {
    var p = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; var j = s % (i + 1); var t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  })(20231106);
  var F3 = 1 / 3, G3 = 1 / 6;
  function noise3(x, y, z) {
    var n0, n1, n2, n3, s = (x + y + z) * F3;
    var i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    var t = (i + j + k) * G3, x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    var i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
      else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
      else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
      else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
    }
    var x1=x0-i1+G3, y1=y0-j1+G3, z1=z0-k1+G3, x2=x0-i2+2*G3, y2=y0-j2+2*G3, z2=z0-k2+2*G3, x3=x0-1+3*G3, y3=y0-1+3*G3, z3=z0-1+3*G3;
    var ii=i&255, jj=j&255, kk=k&255, g;
    var t0=0.6-x0*x0-y0*y0-z0*z0; if (t0<0) n0=0; else { g=grad3[permMod12[ii+perm[jj+perm[kk]]]]; t0*=t0; n0=t0*t0*(g[0]*x0+g[1]*y0+g[2]*z0); }
    var t1=0.6-x1*x1-y1*y1-z1*z1; if (t1<0) n1=0; else { g=grad3[permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]]]; t1*=t1; n1=t1*t1*(g[0]*x1+g[1]*y1+g[2]*z1); }
    var t2=0.6-x2*x2-y2*y2-z2*z2; if (t2<0) n2=0; else { g=grad3[permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]]]; t2*=t2; n2=t2*t2*(g[0]*x2+g[1]*y2+g[2]*z2); }
    var t3=0.6-x3*x3-y3*y3-z3*z3; if (t3<0) n3=0; else { g=grad3[permMod12[ii+1+perm[jj+1+perm[kk+1]]]]; t3*=t3; n3=t3*t3*(g[0]*x3+g[1]*y3+g[2]*z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
  function hash(i, j) { var h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); }
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /* ---------- colors ---------- */
  var C = {};
  function rgb(hex) { hex = hex.replace('#', ''); return [parseInt(hex.substr(0,2),16), parseInt(hex.substr(2,2),16), parseInt(hex.substr(4,2),16)]; }
  function mix(a, b, t) { return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
  var NB = 8; // number of color steps in the water-use pixel map
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { return (cs.getPropertyValue(n).trim() || d); }
    C.line = v('--contour-strong', '#7FA0A6'); C.river = v('--river', '#2B7BB9'); C.index = v('--aquifer', '#1D5A70');
    C.field = v('--field', '#6F8526'); C.ink = v('--ink', '#15232C'); C.paper = v('--paper', '#F2F4F1');
    var dry = rgb(v('--px-dry', '#D9C374')), mid = rgb(v('--px-mid', '#8EA73C')), wet = rgb(v('--px-wet', '#1D5A70'));
    var pap = rgb(C.paper), aq = rgb(C.index), fl = rgb(C.field);
    function css(c) { return 'rgb(' + (c[0]|0) + ',' + (c[1]|0) + ',' + (c[2]|0) + ')'; }
    C.mlBg = css(mix(pap, aq, 0.16)); C.waterBg = css(mix(pap, rgb(C.river), 0.16)); C.phBg = css(mix(pap, fl, 0.2));
    C.px = [];
    for (var b = 0; b < NB; b++) {
      var t = b / (NB - 1), c = t < 0.5 ? mix(dry, mid, t * 2) : mix(mid, wet, (t - 0.5) * 2);
      C.px.push('rgb(' + (c[0]|0) + ',' + (c[1]|0) + ',' + (c[2]|0) + ')');
    }
  }
  window.refreshContourColors = function () { readColors(); if (reduce) draw(); };

  /* ---------- state ---------- */
  var W = 0, H = 0, dpr = 1, cell = 10, cols = 0, rows = 0, field = null;
  var drift = Math.random() * 10, clock = 0;
  var well = { x: 0, y: 0, tx: 0, ty: 0, depth: 0, target: 0 };
  var STEP = 0.075, INDEX_EVERY = 5;
  var farms = [], roads = null, fieldEdges = null, P = 8, pixels = [];
  var sat = {}, drone = {};
  var small = false, banner = !!window.HERO_BANNER;

  /* ---------- farmland layout ---------- */
  function buildFarms() {
    farms = []; pixels = [];
    roads = new Path2D(); fieldEdges = new Path2D();
    var S = small ? 74 : Math.max(92, Math.min(128, W / 12));
    P = small ? 7 : 8;
    var ox = -S * 0.35, oy = -S * 0.2;
    var nx = Math.ceil((W - ox) / S), ny = Math.ceil((H - oy) / S);
    buildRiver();
    for (var gi = 0; gi < nx; gi++) for (var gj = 0; gj < ny; gj++) {
      var x0 = ox + gi * S, y0 = oy + gj * S, cx = x0 + S / 2, cy = y0 + S / 2;
      roads.rect(x0, y0, S, S);
      if (nearRiver(cx, cy).d < S * 0.62) continue;   // leave the river corridor open
      // fade farmland behind the text block (bottom-left)
      var fade = banner
        ? 1 - 0.8 * smooth(W * 0.3, W * 0.14, cx)
        : small
        ? 1 - 0.75 * smooth(H * 0.28, H * 0.42, cy)
        : 1 - 0.85 * smooth(W * 0.62, W * 0.34, cx) * smooth(H * 0.26, H * 0.46, cy);
      var r = hash(gi, gj), vigor = 0.35 + 0.65 * hash(gi + 7, gj + 3);
      if (r < 0.46) {
        var rad = S / 2 - 5;
        var f = { kind: 'pivot', cx: cx, cy: cy, r: rad, vigor: vigor, fade: fade, x0: x0, y0: y0, S: S };
        fieldEdges.moveTo(cx + rad, cy); fieldEdges.arc(cx, cy, rad, 0, Math.PI * 2);
        farms.push(f); addPixels(f);
      } else if (r < 0.7) {
        var n = 2 + Math.floor(hash(gi + 2, gj + 9) * 3), vert = hash(gi, gj + 5) > 0.5, gap = 4, pad = 5;
        for (var k = 0; k < n; k++) {
          var len = (S - 2 * pad - (n - 1) * gap) / n;
          var rx = vert ? x0 + pad + k * (len + gap) : x0 + pad, ry = vert ? y0 + pad : y0 + pad + k * (len + gap);
          var rw = vert ? len : S - 2 * pad, rh = vert ? S - 2 * pad : len;
          var fs = { kind: 'strip', x: rx, y: ry, w: rw, h: rh, vigor: 0.3 + 0.7 * hash(gi * 3 + k, gj), fade: fade };
          fieldEdges.rect(rx, ry, rw, rh);
          farms.push(fs); addPixels(fs);
        }
      }
    }
    pickWaterSources(S);
  }

  /* ---------- surface water (river + canals) and groundwater pumps ---------- */
  var river = [], canals = [], pumps = [];
  function buildRiver() {
    var c = banner ? [[0.4, -0.06], [0.36, 0.22], [0.43, 0.48], [0.39, 0.76], [0.46, 1.06]]
          : small ? [[0.97, -0.02], [0.88, 0.12], [0.95, 0.26], [0.9, 0.38], [1.06, 0.5]]
          : [[0.41, -0.04], [0.37, 0.14], [0.44, 0.31], [0.4, 0.49], [0.48, 0.65], [0.44, 0.83], [0.5, 1.04]];
    var pts = c.map(function (q) { return [q[0] * W, q[1] * H]; });
    river = [];
    for (var i = 0; i < pts.length - 1; i++) {          // Catmull-Rom through the control points
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (var t = 0; t < 1; t += 0.04) {
        var t2 = t * t, t3 = t2 * t;
        river.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    river.push(pts[pts.length - 1]);
  }
  function nearRiver(x, y) {
    var best = { d: 1e9, p: null };
    for (var i = 0; i < river.length; i++) { var d = Math.hypot(river[i][0] - x, river[i][1] - y); if (d < best.d) best = { d: d, p: river[i] }; }
    return best;
  }
  function centerOf(f) { return f.kind === 'pivot' ? [f.cx, f.cy] : [f.x + f.w / 2, f.y + f.h / 2]; }
  function pickWaterSources(S) {
    canals = []; pumps = [];
    var box = banner ? [W * 0.3, 24, W - 430, H - 24]
            : small ? [W * 0.08, 230, W * 0.92, H * 0.48]
            : [W * 0.4, 100, W - 60, H - 280];
    var visible = function (c) { return c[0] > box[0] && c[0] < box[2] && c[1] > box[1] && c[1] < box[3]; };
    // canals: fields just beside the river, on either bank
    var cand = farms.filter(function (f) {
      var c = centerOf(f), n = nearRiver(c[0], c[1]);
      return !f.pump && f.fade > 0.5 && visible(c) && n.d < S * 1.7 && (small || banner || c[0] < W - 300);
    });
    cand.sort(function (a, b) { return centerOf(a)[1] - centerOf(b)[1]; });
    var step = Math.max(1, Math.floor(cand.length / 3));
    for (var i = 0; i < cand.length && canals.length < (small ? 2 : 3); i += step) {
      var c = centerOf(cand[i]); cand[i].surface = true;
      canals.push({ from: nearRiver(c[0], c[1]).p, to: c });
    }
    // pumps: center pivots well away from the river draw on groundwater
    var piv = farms.filter(function (f) {
      return f.kind === 'pivot' && !f.surface && f.fade > 0.6 && visible([f.cx, f.cy]) &&
        nearRiver(f.cx, f.cy).d > S * 0.75 && (small || banner || !(f.cx > W - 330 && f.cy < H * 0.44 + 100));
    });
    piv.sort(function (a, b) { return hash(a.cx, a.cy) - hash(b.cx, b.cy); });
    piv.slice(0, small ? 1 : 3).forEach(function (f) { f.pump = true; pumps.push([f.cx, f.cy]); });
  }
  function drawRiver() {
    if (river.length < 2) return;
    var path = new Path2D(); path.moveTo(river[0][0], river[0][1]);
    for (var i = 1; i < river.length; i++) path.lineTo(river[i][0], river[i][1]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.3; ctx.strokeStyle = C.river; ctx.lineWidth = small ? 16 : 22; ctx.stroke(path);
    ctx.globalAlpha = 0.75; ctx.lineWidth = small ? 9 : 12; ctx.stroke(path);
    ctx.globalAlpha = 0.7; ctx.strokeStyle = C.paper; ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 16]); ctx.lineDashOffset = -clock * 28; ctx.stroke(path);
    // canals carrying water to fields
    canals.forEach(function (cn) {
      ctx.setLineDash([]); ctx.globalAlpha = 0.8; ctx.strokeStyle = C.river; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cn.from[0], cn.from[1]); ctx.lineTo(cn.to[0], cn.to[1]); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = C.paper; ctx.lineWidth = 1.2; ctx.setLineDash([4, 7]); ctx.lineDashOffset = -clock * 22;
      ctx.beginPath(); ctx.moveTo(cn.from[0], cn.from[1]); ctx.lineTo(cn.to[0], cn.to[1]); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = C.river;
      ctx.beginPath(); ctx.arc(cn.to[0], cn.to[1], 3.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
  }
  function drawPump(x, y) {
    // spreading ripple: water pulled up from the aquifer
    var rr = 14 + ((clock * 10) % 14);
    ctx.globalAlpha = Math.max(0, 0.6 * (1 - (rr - 14) / 14)); ctx.strokeStyle = C.river; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    // badge
    ctx.globalAlpha = 0.97; ctx.fillStyle = C.waterBg; ctx.strokeStyle = C.river; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // pump: base, standpipe, spout and handle
    ctx.globalAlpha = 1; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 8); ctx.lineTo(x + 5, y + 8);
    ctx.moveTo(x - 2, y + 8); ctx.lineTo(x - 2, y - 6);
    ctx.moveTo(x - 2, y - 3); ctx.lineTo(x + 6, y - 3); ctx.lineTo(x + 6, y);
    ctx.moveTo(x - 2, y - 6); ctx.lineTo(x - 8, y - 9);
    ctx.stroke();
    // drops falling from the spout
    var t = (clock * 1.4) % 1;
    ctx.fillStyle = C.river; ctx.globalAlpha = 1 - t;
    ctx.beginPath(); ctx.arc(x + 6, y + 2 + t * 6, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function inside(f, x, y) {
    if (f.kind === 'pivot') { var dx = x - f.cx, dy = y - f.cy; return dx * dx + dy * dy <= f.r * f.r; }
    return x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h;
  }
  function addPixels(f) {
    var bx = f.kind === 'pivot' ? f.cx - f.r : f.x, by = f.kind === 'pivot' ? f.cy - f.r : f.y;
    var bw = f.kind === 'pivot' ? f.r * 2 : f.w, bh = f.kind === 'pivot' ? f.r * 2 : f.h;
    for (var x = Math.floor(bx / P) * P; x < bx + bw; x += P) for (var y = Math.floor(by / P) * P; y < by + bh; y += P) {
      var px = x + P / 2, py = y + P / 2;
      if (!inside(f, px, py)) continue;
      var v = f.vigor * 0.6 + 0.6 * (noise3(px / 45, py / 45, 9) * 0.5 + 0.5) - 0.15;
      pixels.push({ x: x, y: y, cx: px, cy: py, b: Math.max(0, Math.min(NB - 1, Math.round(v * (NB - 1)))), fade: f.fade });
    }
  }

  /* ---------- satellite ---------- */
  var PASS = 10, GAP = 2.5, FADE = 7;
  function setupSat() {
    var a = 0.2;                                // track tilt (radians)
    sat.u = [-Math.sin(a), Math.cos(a)];        // along-track (moving down, slightly left)
    sat.n = [sat.u[1], -sat.u[0]];              // cross-track
    sat.sw = small ? Math.max(150, W * 0.42) : Math.max(220, Math.min(320, W * 0.22));
    sat.speed = (H + 260) / PASS;
    if (banner) { var hb = (W - 214 - PW - sat.sw / 2 - 30) / W; sat.paths = [0.6, 0.85, 0.42, 1].map(function (f) { return 0.36 + (hb - 0.36) * f; }); }
    else if (small) { sat.paths = [0.62, 0.3, 0.85]; }
    else {
      // keep every pass clear of the model boxes in the right-hand column
      var colX = W - Math.max(16, Math.min(48, W * 0.04)) - 70;
      var hi = (colX + 70 - PW - sat.sw / 2 - 24 - Math.tan(0.2) * H * 0.45) / W, lo = Math.min(0.6, hi - 0.05);
      sat.paths = [0.6, 0.9, 0.3, 1, 0.75].map(function (f) { return lo + (hi - lo) * f; });
    }
  }
  function passStart(k) {
    var fx = sat.paths[((k % sat.paths.length) + sat.paths.length) % sat.paths.length] * W;
    return [fx + Math.tan(0.2) * (H * 0.5 + 130), -130];
  }
  function revealSat(p, k, tt) {
    var A = passStart(k), dx = p.cx - A[0], dy = p.cy - A[1];
    var c = dx * sat.n[0] + dy * sat.n[1];
    if (Math.abs(c) > sat.sw / 2) return 0;
    var s = dx * sat.u[0] + dy * sat.u[1], ss = tt * sat.speed;
    if (s > ss) return 0;
    var age = (ss - s) / sat.speed;
    return Math.max(0, 1 - age / FADE);
  }

  /* ---------- drone ---------- */
  function setupDrone() {
    var target = banner ? [W * 0.6, H * 0.74] : small ? [W * 0.72, H * 0.2] : [W * 0.68, H * 0.62], best = null, bd = 1e9;
    farms.forEach(function (f) {
      if (f.kind !== 'pivot' || f.pump) return;
      if (banner && (f.cy - f.r < 8 || f.cy + f.r > H - 8 || f.cx > W - 420)) return;
      var d = Math.hypot(f.cx - target[0], f.cy - target[1]);
      if (d < bd) { bd = d; best = f; }
    });
    drone.f = best; drone.cells = []; drone.path = [];
    if (!best) return;
    var p = 4, r = best.r, x0 = best.cx - r, y0 = best.cy - r;
    drone.p = p; drone.x0 = x0; drone.y0 = y0; drone.n = Math.ceil(2 * r / p);
    drone.seen = new Float32Array(drone.n * drone.n).fill(-99);
    // lawnmower survey path over the pivot
    var spacing = 14, rows = Math.floor((2 * r) / spacing);
    for (var i = 0; i <= rows; i++) {
      var y = y0 + 6 + i * spacing; if (y > y0 + 2 * r - 6) break;
      var half = Math.sqrt(Math.max(0, r * r - (y - best.cy) * (y - best.cy)));
      var a = best.cx - half + 4, b = best.cx + half - 4;
      if (i % 2) drone.path.push([b, y], [a, y]); else drone.path.push([a, y], [b, y]);
    }
    drone.path.push(drone.path[0]);
    drone.len = [0];
    for (var k = 1; k < drone.path.length; k++) drone.len.push(drone.len[k - 1] + Math.hypot(drone.path[k][0] - drone.path[k-1][0], drone.path[k][1] - drone.path[k-1][1]));
    drone.total = drone.len[drone.len.length - 1];
  }
  function dronePos(t) {
    var d = (t * 42) % drone.total, k = 1;
    while (drone.len[k] < d) k++;
    var a = drone.path[k - 1], b = drone.path[k], seg = drone.len[k] - drone.len[k - 1], u = seg ? (d - drone.len[k - 1]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }


  /* ---------- field sensors + machine learning model ---------- */
  var ml = {}, phys = {}, sensors = [];
  function setupML() {
    PW = small ? 176 : 200;
    var colX = W - Math.max(16, Math.min(48, W * 0.04)) - 70;
    ml.x = small ? W - 16 - BW / 2 : colX;  ml.y = small ? 70 + PH / 2 : H * 0.44;
    phys.x = small ? 16 + PW / 2 : colX + 70 - PW / 2; phys.y = small ? 70 + PH / 2 : H * 0.2;
    if (banner) { ml.x = W - 120; ml.y = H * 0.5; phys.x = W - 200 - PW / 2 - 14; phys.y = H * 0.5; }
    var L = [[-46, [-24, 0, 24]], [0, [-33, -11, 11, 33]], [46, [0]]];
    ml.nodes = L.map(function (l) { return l[1].map(function (y) { return [ml.x + l[0], ml.y + 9 + y * 0.92]; }); });
    ml.edges = [];
    for (var a = 0; a < ml.nodes.length - 1; a++)
      ml.nodes[a].forEach(function (n1) { ml.nodes[a + 1].forEach(function (n2) { ml.edges.push([n1, n2]); }); });
    // two soil-moisture / weather sensors in fields
    sensors = [];
    var spots = banner ? [[W * 0.36, H * 0.3], [W * 0.62, H * 0.72]] : small ? [[W * 0.85, H * 0.08]] : [[W * 0.6, H * 0.3], [W * 0.93, H * 0.72]];
    spots.forEach(function (t) {
      var best = null, bd = 1e9;
      farms.forEach(function (f) {
        var cx = f.kind === 'pivot' ? f.cx : f.x + f.w / 2, cy = f.kind === 'pivot' ? f.cy : f.y + f.h / 2;
        var d = Math.hypot(cx - t[0], cy - t[1]); if (d < bd) { bd = d; best = [cx, cy]; }
      });
      if (best) sensors.push(best);
    });
  }
  function along(a, b, t, bend) {   // point on a gently curved link
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - bend;
    var u = 1 - t;
    return [u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]];
  }
  function link(a, b, phase, bend, label) {
    var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2 - bend;
    // soft halo so the line stands out over the map
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6; ctx.strokeStyle = C.paper; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(cx, cy, b[0], b[1]); ctx.stroke();
    ctx.globalAlpha = 0.8; ctx.strokeStyle = C.ink; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(cx, cy, b[0], b[1]); ctx.stroke();
    // arrowhead at the destination
    var ang = Math.atan2(b[1] - cy, b[0] - cx), L = 6.5;
    ctx.globalAlpha = 1; ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - L * Math.cos(ang - 0.42), b[1] - L * Math.sin(ang - 0.42));
    ctx.lineTo(b[0] - L * Math.cos(ang + 0.42), b[1] - L * Math.sin(ang + 0.42));
    ctx.closePath(); ctx.fill();
    // data packets travelling along the link
    for (var k = 0; k < 3; k++) {
      var t = (phase + k / 3) % 1; if (t > 0.94) continue;
      var p = along(a, b, t, bend);
      ctx.globalAlpha = 1; ctx.fillStyle = C.paper;
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.1, 0, Math.PI * 2); ctx.fill();
    }
    if (label) {
      var m = along(a, b, 0.5, bend);
      ctx.font = '500 11px "Bricolage Grotesque", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var w = ctx.measureText(label).width + 14;
      ctx.globalAlpha = 0.95; ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(m[0] - w / 2, m[1] - 10, w, 20, 10); else ctx.rect(m[0] - w / 2, m[1] - 10, w, 20);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = C.ink; ctx.fillText(label, m[0], m[1] + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.globalAlpha = 1;
  }
  function drawSensor(x, y) {
    // badge so the sensor reads clearly against the fields
    ctx.globalAlpha = 0.95; ctx.fillStyle = C.phBg; ctx.strokeStyle = C.field; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - 3, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // probe in the ground
    ctx.globalAlpha = 1; ctx.strokeStyle = C.ink; ctx.fillStyle = C.paper; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x, y - 6); ctx.moveTo(x - 6, y + 8); ctx.lineTo(x + 6, y + 8); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 9, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // radio waves going out
    ctx.strokeStyle = C.index; ctx.lineWidth = 1.4;
    for (var k = 0; k < 2; k++) {
      var r = 9 + k * 5 + ((clock * 6) % 5);
      ctx.globalAlpha = 0.85 - k * 0.3;
      ctx.beginPath(); ctx.arc(x, y - 9, r, -Math.PI * 0.42, -Math.PI * 0.08); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 9, r, -Math.PI * 0.92, -Math.PI * 0.58); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  var BW = 140, BH = 118, PW = 200, PH = 128;
  function box(cx, cy, bg, edge, label, w, h) {
    w = w || BW; h = h || BH;
    var bx = cx - w / 2, by = cy - h / 2;
    ctx.globalAlpha = 0.96; ctx.fillStyle = bg; ctx.strokeStyle = edge; ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 12); else ctx.rect(bx, by, w, h);
    ctx.fill(); ctx.globalAlpha = 0.9; ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = C.ink;
    ctx.font = '500 11.5px "Bricolage Grotesque", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, cx, by + 17);
  }
  function arrow(x1, y1, x2, y2) {
    var a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - 5 * Math.cos(a - 0.5), y2 - 5 * Math.sin(a - 0.5));
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - 5 * Math.cos(a + 0.5), y2 - 5 * Math.sin(a + 0.5));
    ctx.stroke();
  }
  function drawPhysics() {
    box(phys.x, phys.y, C.phBg, C.field, 'Physics-based model', PW, PH);
    var bx = phys.x - PW / 2, x = phys.x - 14, y = phys.y + 12;
    var cw = 38, top = y - 8, bot = y + 30;
    // soil column with a rising and falling water store
    ctx.globalAlpha = 1; ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
    ctx.fillRect(x - cw / 2, top, cw, bot - top);
    var lvl = bot - (bot - top) * (0.35 + 0.2 * Math.sin(clock * 0.9));
    ctx.globalAlpha = 0.7; ctx.fillStyle = C.river; ctx.fillRect(x - cw / 2, lvl, cw, bot - lvl);
    ctx.globalAlpha = 1; ctx.strokeRect(x - cw / 2, top, cw, bot - top);
    // crop on top
    ctx.strokeStyle = C.field; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top - 12);
    ctx.moveTo(x, top - 6); ctx.quadraticCurveTo(x - 8, top - 12, x - 10, top - 8);
    ctx.moveTo(x, top - 9); ctx.quadraticCurveTo(x + 8, top - 15, x + 10, top - 11); ctx.stroke();
    // fluxes in and out, with full names
    var P = [x - 40, top - 18, x - 24, top - 3], I = [x - 62, y + 18, x - cw / 2 - 3, y + 18],
        E = [x + 24, top - 3, x + 40, top - 18], D = [x, bot + 1, x, bot + 12];
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
    [P, I, E, D].forEach(function (f) { arrow(f[0], f[1], f[2], f[3]); });
    ctx.fillStyle = C.ink; ctx.font = '500 10px "Bricolage Grotesque", system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';  ctx.fillText('Precipitation', bx + 9, top - 22); ctx.fillText('Irrigation', bx + 9, y + 12);
    ctx.textAlign = 'right'; ctx.fillText('Evapotranspiration', bx + PW - 8, top - 22);
    ctx.textAlign = 'left';  ctx.fillText('Drainage', x + 6, bot + 12);
    // moving droplets along the fluxes
    var t = (clock * 0.7) % 1;
    ctx.fillStyle = C.river;
    [P, I, E, D].forEach(function (f, i) {
      var u = (t + i * 0.25) % 1; ctx.globalAlpha = Math.sin(u * Math.PI);
      ctx.beginPath(); ctx.arc(f[0] + (f[2] - f[0]) * u, f[1] + (f[3] - f[1]) * u, 1.8, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  function drawML(inputs, output) {
    // data -> physics-based model -> machine learning -> water-use map
    var side = small || banner;
    var inPts = small ? [[phys.x - 30, phys.y + PH / 2], [phys.x, phys.y + PH / 2], [phys.x + 30, phys.y + PH / 2]]
                      : [[phys.x - PW / 2, phys.y - 16], [phys.x - PW / 2, phys.y + 10], [phys.x - PW / 2, phys.y + 36]];
    inputs.forEach(function (src, i) { if (src) link(src, inPts[i], (clock * 0.45 + i * 0.3) % 1, small ? -30 : 40); });
    var pOut = side ? [phys.x + PW / 2, phys.y] : [phys.x, phys.y + PH / 2], mIn = side ? [ml.x - BW / 2, ml.y] : [ml.x, ml.y - BH / 2];
    if (output) link(side ? [ml.x, ml.y + BH / 2] : [ml.x - BW / 2, ml.y], output, (clock * 0.45) % 1, side ? -60 : -30, small ? null : 'Water-use estimate');
    drawPhysics();
    link(pOut, mIn, (clock * 0.6) % 1, 0);
    box(ml.x, ml.y, C.mlBg, C.index, 'Machine learning');
    // edges with signal pulses
    ctx.globalAlpha = 0.4; ctx.strokeStyle = C.index; ctx.lineWidth = 1; ctx.beginPath();
    ml.edges.forEach(function (e) { ctx.moveTo(e[0][0], e[0][1]); ctx.lineTo(e[1][0], e[1][1]); });
    ctx.stroke();
    ml.edges.forEach(function (e, i) {
      var t = (clock * 0.8 + i * 0.137) % 1;
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9; ctx.fillStyle = C.index;
      ctx.beginPath(); ctx.arc(e[0][0] + (e[1][0] - e[0][0]) * t, e[0][1] + (e[1][1] - e[0][1]) * t, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    // nodes, gently "firing"
    ml.nodes.forEach(function (layer, li) {
      layer.forEach(function (n, ni) {
        var act = 0.5 + 0.5 * Math.sin(clock * 2.2 - li * 1.3 + ni * 0.9);
        ctx.globalAlpha = 1; ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n[0], n[1], 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 0.25 + 0.6 * act; ctx.fillStyle = li === 2 ? C.field : C.index;
        ctx.beginPath(); ctx.arc(n[0], n[1], 3.6, 0, Math.PI * 2); ctx.fill();
      });
    });
    ctx.globalAlpha = 1;
  }

  /* ---------- groundwater field + contours ---------- */
  function resize() {
    var r = canvas.getBoundingClientRect();
    W = r.width; H = r.height; small = W < 700;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    cell = small ? 9 : 11;
    cols = Math.ceil(W / cell) + 1; rows = Math.ceil(H / cell) + 1;
    field = new Float32Array(cols * rows);
    if (!well.x) { well.x = well.tx = W * 0.72; well.y = well.ty = H * 0.38; }
    buildFarms(); setupSat(); setupDrone(); setupML();
  }
  function sample() {
    var sc = 1 / 520, z = drift, wx = well.x, wy = well.y, D = well.depth, R = 46;
    for (var j = 0; j < rows; j++) {
      var y = j * cell;
      for (var i = 0; i < cols; i++) {
        var x = i * cell;
        var v = noise3(x * sc, y * sc, z) * 0.9 + noise3(x * sc * 2.1 + 40, y * sc * 2.1, z * 1.3) * 0.32 + noise3(x * sc * 4.3 - 20, y * sc * 4.3, z * 1.7) * 0.09;
        v += (x / W) * 0.35 - (y / H) * 0.2;
        if (D > 0.001) { var dx = x - wx, dy = y - wy; v -= D / (1 + Math.sqrt(dx * dx + dy * dy) / R); }
        field[j * cols + i] = v;
      }
    }
  }
  function lerp(a, b, lvl) { var d = b - a; return d === 0 ? 0.5 : (lvl - a) / d; }
  function seg(p, s, e) { p.moveTo(s[0], s[1]); p.lineTo(e[0], e[1]); }
  function contours() {
    sample();
    var minL = -4, maxL = 3, nL = Math.round((maxL - minL) / STEP);
    var normal = new Path2D(), index = new Path2D();
    for (var j = 0; j < rows - 1; j++) for (var i = 0; i < cols - 1; i++) {
      var a = field[j * cols + i], b = field[j * cols + i + 1], c = field[(j + 1) * cols + i + 1], d = field[(j + 1) * cols + i];
      var lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      var k0 = Math.ceil((lo - minL) / STEP), k1 = Math.floor((hi - minL) / STEP);
      if (k1 < k0) continue;
      var x = i * cell, y = j * cell;
      for (var k = Math.max(k0, 0); k <= Math.min(k1, nL); k++) {
        var L = minL + k * STEP;
        var idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        var T = [x + cell * lerp(a, b, L), y], Rr = [x + cell, y + cell * lerp(b, c, L)], B = [x + cell * lerp(d, c, L), y + cell], Lf = [x, y + cell * lerp(a, d, L)];
        var p = (k % INDEX_EVERY === 0) ? index : normal;
        switch (idx) {
          case 1: case 14: seg(p, Lf, B); break;
          case 2: case 13: seg(p, B, Rr); break;
          case 3: case 12: seg(p, Lf, Rr); break;
          case 4: case 11: seg(p, T, Rr); break;
          case 6: case 9: seg(p, T, B); break;
          case 7: case 8: seg(p, Lf, T); break;
          case 5: seg(p, Lf, T); seg(p, B, Rr); break;
          case 10: seg(p, T, Rr); seg(p, Lf, B); break;
        }
      }
    }
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55; ctx.strokeStyle = C.line; ctx.lineWidth = 0.9; ctx.stroke(normal);
    ctx.globalAlpha = 0.55; ctx.strokeStyle = C.river; ctx.lineWidth = 1.5; ctx.stroke(index);
    ctx.globalAlpha = 1;
  }

  /* ---------- drawing ---------- */
  function draw() {
    if (!field) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    contours();
    drawRiver();

    // farmland
    ctx.globalAlpha = 0.1; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke(roads);
    for (var i = 0; i < farms.length; i++) {
      var f = farms[i];
      ctx.globalAlpha = (0.03 + 0.06 * f.vigor) * f.fade; ctx.fillStyle = C.field;
      ctx.beginPath();
      if (f.kind === 'pivot') ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2); else ctx.rect(f.x, f.y, f.w, f.h);
      ctx.fill();
    }
    ctx.globalAlpha = 0.32; ctx.strokeStyle = C.field; ctx.lineWidth = 1; ctx.stroke(fieldEdges);
    // pivot arms (the irrigation lateral), one per pivot
    ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2; ctx.beginPath();
    for (i = 0; i < farms.length; i++) {
      f = farms[i]; if (f.kind !== 'pivot') continue;
      var ang = clock * 0.08 + f.vigor * 10;
      ctx.moveTo(f.cx, f.cy); ctx.lineTo(f.cx + Math.cos(ang) * f.r, f.cy + Math.sin(ang) * f.r);
    }
    ctx.stroke();

    // satellite water-use pixels (current + previous pass still fading)
    var cyc = PASS + GAP, k = Math.floor(clock / cyc), tt = clock - k * cyc;
    var buckets = [];
    for (i = 0; i < pixels.length; i++) {
      var p = pixels[i];
      var a = Math.max(revealSat(p, k, tt), revealSat(p, k - 1, tt + cyc)) * Math.max(0.2, p.fade);
      if (a <= 0.03) continue;
      var q = Math.min(3, Math.floor(a * 4)), key = p.b * 4 + q;
      (buckets[key] || (buckets[key] = new Path2D())).rect(p.x + 0.25, p.y + 0.25, P - 0.5, P - 0.5);
    }
    for (var key2 in buckets) {
      ctx.globalAlpha = ((key2 % 4) + 1) / 4 * 0.72;
      ctx.fillStyle = C.px[Math.floor(key2 / 4)]; ctx.fill(buckets[key2]);
    }

    // swath edges, scan line and the satellite itself
    var satPos = null, mapPos = null, dronePt = null;
    if (tt < PASS) {
      var A = passStart(k), ss = tt * sat.speed, hw = sat.sw / 2;
      var cxs = A[0] + sat.u[0] * ss, cys = A[1] + sat.u[1] * ss;
      var l = [cxs - sat.n[0] * hw, cys - sat.n[1] * hw], r = [cxs + sat.n[0] * hw, cys + sat.n[1] * hw];
      var back = 260;
      ctx.globalAlpha = 0.5; ctx.strokeStyle = C.index; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(l[0], l[1]); ctx.lineTo(l[0] - sat.u[0] * back, l[1] - sat.u[1] * back);
      ctx.moveTo(r[0], r[1]); ctx.lineTo(r[0] - sat.u[0] * back, r[1] - sat.u[1] * back);
      ctx.stroke(); ctx.setLineDash([]);
      var bl = 70, g = ctx.createLinearGradient(cxs, cys, cxs - sat.u[0] * bl, cys - sat.u[1] * bl);
      g.addColorStop(0, C.index); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.16; ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]);
      ctx.lineTo(r[0] - sat.u[0] * bl, r[1] - sat.u[1] * bl); ctx.lineTo(l[0] - sat.u[0] * bl, l[1] - sat.u[1] * bl);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]); ctx.stroke();
      drawSatellite(cxs, cys);
      satPos = [cxs, cys]; mapPos = [cxs - sat.u[0] * 55, cys - sat.u[1] * 55];
    }

    // drone survey
    if (drone.f) {
      var dp = reduce ? dronePos(drone.total * 0.55 / 42) : dronePos(clock);
      var fx0 = Math.floor((dp[0] - 13 - drone.x0) / drone.p), fx1 = Math.floor((dp[0] + 13 - drone.x0) / drone.p);
      var fy0 = Math.floor((dp[1] - 13 - drone.y0) / drone.p), fy1 = Math.floor((dp[1] + 13 - drone.y0) / drone.p);
      for (var gx = Math.max(0, fx0); gx <= Math.min(drone.n - 1, fx1); gx++)
        for (var gy = Math.max(0, fy0); gy <= Math.min(drone.n - 1, fy1); gy++) drone.seen[gy * drone.n + gx] = clock;
      var db = [];
      for (gx = 0; gx < drone.n; gx++) for (gy = 0; gy < drone.n; gy++) {
        var age = clock - drone.seen[gy * drone.n + gx];
        if (age > 16) continue;
        var px = drone.x0 + gx * drone.p, py = drone.y0 + gy * drone.p;
        if (!inside(drone.f, px + 2, py + 2)) continue;
        var v = drone.f.vigor * 0.7 + 0.4 * (noise3(px / 14, py / 14, 3) * 0.5 + 0.5) - 0.1;
        var bb = Math.max(0, Math.min(NB - 1, Math.round(v * (NB - 1)))), qq = Math.min(3, Math.floor((1 - age / 16) * 4));
        (db[bb * 4 + qq] || (db[bb * 4 + qq] = new Path2D())).rect(px, py, drone.p - 0.5, drone.p - 0.5);
      }
      for (var k3 in db) { ctx.globalAlpha = ((k3 % 4) + 1) / 4 * 0.85; ctx.fillStyle = C.px[Math.floor(k3 / 4)]; ctx.fill(db[k3]); }
      // footprint and drone
      ctx.globalAlpha = 0.6; ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
      ctx.strokeRect(dp[0] - 13, dp[1] - 13, 26, 26);
      drawDrone(dp[0], dp[1]);
      dronePt = dp;
    }

    // field sensors and the machine learning model linking everything
    pumps.forEach(function (q) { drawPump(q[0], q[1]); });
    sensors.forEach(function (q) { drawSensor(q[0], q[1]); });
    drawML([satPos, dronePt, sensors[0] || null], mapPos);

    // the well
    if (well.depth > 0.05) {
      ctx.globalAlpha = Math.min(1, well.depth / 0.6); ctx.fillStyle = C.river;
      ctx.beginPath(); ctx.arc(well.x, well.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSatellite(x, y) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.atan2(sat.u[1], sat.u[0]) - Math.PI / 2);
    ctx.globalAlpha = 1; ctx.lineWidth = 1.2; ctx.strokeStyle = C.ink; ctx.fillStyle = C.paper;
    // body
    ctx.fillRect(-5, -7, 10, 14); ctx.strokeRect(-5, -7, 10, 14);
    // solar panels with cell lines
    ctx.fillStyle = C.index;
    [-1, 1].forEach(function (s) {
      var x0 = s < 0 ? -27 : 9;
      ctx.globalAlpha = 0.85; ctx.fillRect(x0, -5, 18, 10);
      ctx.globalAlpha = 1; ctx.strokeRect(x0, -5, 18, 10);
      ctx.beginPath(); ctx.moveTo(x0 + 6, -5); ctx.lineTo(x0 + 6, 5); ctx.moveTo(x0 + 12, -5); ctx.lineTo(x0 + 12, 5);
      ctx.moveTo(s < 0 ? -9 : 5, 0); ctx.lineTo(s < 0 ? -5 : 9, 0); ctx.stroke();
    });
    ctx.restore();
  }
  function drawDrone(x, y) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1.25, 1.25);
    ctx.globalAlpha = 1; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3; ctx.fillStyle = C.paper;
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke();
    [[-7,-7],[7,-7],[7,7],[-7,7]].forEach(function (c) { ctx.beginPath(); ctx.arc(c[0], c[1], 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = C.ink; ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }

  /* ---------- animation loop ---------- */
  var running = false, last = 0, visible = true;
  function frame(ts) {
    if (!running) return;
    var dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts;
    clock += dt; drift += dt * 0.045;
    well.x += (well.tx - well.x) * Math.min(1, dt * 6);
    well.y += (well.ty - well.y) * Math.min(1, dt * 6);
    well.depth += (well.target - well.depth) * Math.min(1, dt * 2.5);
    draw();
    requestAnimationFrame(frame);
  }
  function start() { if (!running && !reduce && visible && !document.hidden) { running = true; last = 0; requestAnimationFrame(frame); } }
  function stop() { running = false; }

  readColors(); resize();
  clock = reduce ? PASS * 0.55 : PASS * 0.2;   // start mid-pass so the idea is visible at once
  draw();
  window.addEventListener('resize', function () { resize(); draw(); });

  if (!reduce) {
    var hero = canvas.parentElement;
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = canvas.getBoundingClientRect();
      well.tx = e.clientX - r.left; well.ty = e.clientY - r.top; well.target = 1.5;
    });
    hero.addEventListener('pointerleave', function () { well.target = 0; });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; visible ? start() : stop(); }).observe(canvas);
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    start();
  }
})();
