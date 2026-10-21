/* Store map. The plan photo becomes a floor that tilts into 3D; each marked section
   rises into a block. Pure geometry, no AI. The projection and drawing code at the top
   has no DOM so it can be tested by rendering to an image. */
(function (root) {
  'use strict';

  /* ---------- Geometry and drawing ---------- */
  var ZH_BASE = 0.05, ZH_PER = 0.018;
  function zoneH(z) {
    if (z.kind === 'flat') return 0.006;
    if (z.kind === 'low') return 0.06 * (z.hs || 1);
    return (ZH_BASE + ZH_PER * (z.shelves || 5)) * (z.hs || 1);
  }
  function zoneN(z) { return (z.kind === 'flat' || z.kind === 'low') ? 1 : (z.shelves || 5); }
  function shelfNumber(s) { var m = String(s == null ? '' : s).match(/\d+/); return m ? parseInt(m[0], 10) : 0; }
  function levelZ(zone, lvl, topFirst) {
    var n = zoneN(zone), h = zoneH(zone);
    if (!lvl || n === 1) return h;
    var L = Math.min(Math.max(lvl, 1), n);
    return h * (topFirst ? 1 - (L - 0.5) / n : (L - 0.5) / n);
  }
  /* Sections on each shelf: z.cells[k-1] is how many cubbies shelf k is divided into (left to right, or top to bottom of the map for a box that runs that way). */
  function cellsOf(z) {
    var n = zoneN(z), out = [], k;
    for (k = 0; k < n; k++) { var v = z.cells && z.cells[k] ? Math.round(z.cells[k]) : 1; out.push(v >= 1 && v <= 24 ? v : 1); }
    return out;
  }
  function slotNumber(s) { var m = /^\s*\d+\s*[-.,/]\s*(\d+)\s*$/.exec(String(s == null ? '' : s)); return m ? parseInt(m[1], 10) : 0; }
  function bandRange(Z, n, k, topFirst) { return topFirst ? [Z * (1 - k / n), Z * (1 - (k - 1) / n)] : [Z * (k - 1) / n, Z * k / n]; }
  function findZone(zones, section) {
    var k = String(section == null ? '' : section).trim().toLowerCase();
    if (!k) return null;
    for (var i = 0; i < zones.length; i++) if (String(zones[i].name).trim().toLowerCase() === k) return zones[i];
    return null;
  }

  /* Floor fractions (u right, v down in the picture) plus a height z -> screen point. */
  function makeProj(W, H, aspect, yaw, elev, zmax, zoom, panX, panY) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), ce = Math.cos(elev), se = Math.sin(elev), D = 2.6;
    function raw(u, v, z) {
      var x = (u - 0.5) * aspect, y = 0.5 - v;
      var x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      return { sx: x1, sy: y1 * se + z * ce, t: -y1 * ce + z * se };
    }
    var pts = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, zmax], [1, 0, zmax], [1, 1, zmax], [0, 1, zmax]];
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    pts.forEach(function (p) {
      var r = raw(p[0], p[1], p[2]), s = 1 / (D - r.t), px = r.sx * s, py = r.sy * s;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    });
    var m = 14;
    var k = Math.min((W - 2 * m) / (maxX - minX), (H - 2 * m) / (maxY - minY));
    k *= zoom || 1;
    var ox = W / 2 - k * (minX + maxX) / 2 + (panX || 0), oy = H / 2 + k * (minY + maxY) / 2 + (panY || 0);
    return function (u, v, z) {
      var r = raw(u, v, z || 0), s = 1 / (D - r.t);
      return { X: ox + r.sx * s * k, Y: oy - r.sy * s * k, t: r.t };
    };
  }

  function affine(s0, s1, s2, d0, d1, d2) {
    var det = s0[0] * (s1[1] - s2[1]) - s0[1] * (s1[0] - s2[0]) + (s1[0] * s2[1] - s2[0] * s1[1]);
    if (Math.abs(det) < 1e-9) return null;
    function solve(x0, x1, x2) {
      return [
        (x0 * (s1[1] - s2[1]) - s0[1] * (x1 - x2) + (x1 * s2[1] - x2 * s1[1])) / det,
        (s0[0] * (x1 - x2) - x0 * (s1[0] - s2[0]) + (s1[0] * x2 - s2[0] * x1)) / det,
        (s0[0] * (s1[1] * x2 - s2[1] * x1) - s0[1] * (s1[0] * x2 - s2[0] * x1) + x0 * (s1[0] * s2[1] - s2[0] * s1[1])) / det
      ];
    }
    var ax = solve(d0[0], d1[0], d2[0]), ay = solve(d0[1], d1[1], d2[1]);
    return [ax[0], ay[0], ax[1], ay[1], ax[2], ay[2]];
  }
  function drawTri(ctx, img, s0, s1, s2, d0, d1, d2) {
    var M = affine(s0, s1, s2, d0, d1, d2);
    if (!M) return;
    var cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    function grow(p) {
      var dx = p[0] - cx, dy = p[1] - cy, l = Math.sqrt(dx * dx + dy * dy) || 1;
      return [p[0] + dx / l * 0.8, p[1] + dy / l * 0.8];
    }
    var a = grow(d0), b = grow(d1), c = grow(d2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath();
    ctx.clip();
    ctx.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].X, pts[0].Y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].X, pts[i].Y);
    ctx.closePath();
  }

  /* Straighten a rough layout: snap to a grid, then make nearly equal sizes exactly equal. */
  /* Boxes that sit on top of each other (touching edges are fine). */
  function overlapPairs(zones) {
    var out = [], t = 0.004, i, k;
    for (i = 0; i < zones.length; i++) for (k = i + 1; k < zones.length; k++) {
      var a = zones[i], b = zones[k];
      var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > t && h > t) out.push([a, b]);
    }
    return out;
  }
  function overlapsAny(z, zones) {
    var t = 0.004;
    return zones.some(function (b) {
      if (b === z) return false;
      var w = Math.min(z.x + z.w, b.x + b.w) - Math.max(z.x, b.x), h = Math.min(z.y + z.h, b.y + b.h) - Math.max(z.y, b.y);
      return w > t && h > t;
    });
  }
  /* Straighten the layout: edges snap to a fine grid, and boxes of nearly the same size are made the same size, but only where that does not push a box onto its neighbour. */
  function tidyZones(zones) {
    var g = 0.005;
    function snap(v) { return Math.round(v / g) * g; }
    function r4(v) { return Math.round(v * 10000) / 10000; }
    zones.forEach(function (z) {
      var x0 = Math.max(0, snap(z.x)), y0 = Math.max(0, snap(z.y));
      var x1 = Math.min(1, snap(z.x + z.w)), y1 = Math.min(1, snap(z.y + z.h));
      var old = { x: z.x, y: z.y, w: z.w, h: z.h };
      z.x = x0; z.y = y0; z.w = Math.max(g, x1 - x0); z.h = Math.max(g, y1 - y0);
      if (overlapsAny(z, zones) && !(function () { z.x = old.x; z.y = old.y; z.w = old.w; z.h = old.h; var r = overlapsAny(z, zones); z.x = x0; z.y = y0; z.w = Math.max(g, x1 - x0); z.h = Math.max(g, y1 - y0); return r; })()) { z.x = old.x; z.y = old.y; z.w = old.w; z.h = old.h; }
    });
    ['w', 'h'].forEach(function (key) {
      var byKind = {};
      zones.forEach(function (z) { var k = z.kind || 'tall'; (byKind[k] = byKind[k] || []).push(z); });
      Object.keys(byKind).forEach(function (k) {
        var sorted = byKind[k].slice().sort(function (a, b) { return a[key] - b[key]; }), group = [];
        var flush = function () {
          if (!group.length) return;
          var mean = group.reduce(function (t, z) { return t + z[key]; }, 0) / group.length;
          var v = Math.max(g, snap(mean));
          group.forEach(function (z) {
            var was = z[key], had = overlapsAny(z, zones);
            z[key] = Math.min(v, 1 - (key === 'w' ? z.x : z.y));
            if (!had && overlapsAny(z, zones)) z[key] = was;
          });
          group = [];
        };
        sorted.forEach(function (z) {
          if (group.length && z[key] - group[0][key] > 0.03) flush();
          group.push(z);
        });
        flush();
      });
    });
    zones.forEach(function (z) { z.x = r4(z.x); z.y = r4(z.y); z.w = r4(z.w); z.h = r4(z.h); });
    return zones;
  }

    function kindPal(kind, dark, base) {
    if (kind === 'cooler') return dark ? { top: 'rgba(105,205,230,0.92)', a: 'rgba(60,150,185,0.96)', b: 'rgba(42,120,155,0.96)' } : { top: 'rgba(80,190,215,0.94)', a: 'rgba(40,140,175,0.96)', b: 'rgba(28,112,150,0.96)' };
    if (kind === 'freezer') return dark ? { top: 'rgba(200,228,255,0.92)', a: 'rgba(130,170,225,0.96)', b: 'rgba(100,140,200,0.96)' } : { top: 'rgba(176,214,250,0.96)', a: 'rgba(104,150,215,0.97)', b: 'rgba(80,124,190,0.97)' };
    return base;
  }
  /* st: {img, imgW, imgH, aspect, zones, yaw, elev, edit, clean, topFirst, selZoneId, selLevel, draft, dark, fast} */
  function drawScene(ctx, W, H, st) {
    var zones = st.zones || [];
    var pal = st.dark
      ? { top: 'rgba(138,168,255,0.92)', a: 'rgba(98,126,216,0.96)', b: 'rgba(72,96,178,0.96)', line: 'rgba(255,255,255,0.35)', hi: '#34d399', hiTop: 'rgba(52,211,153,0.95)', edge: 'rgba(255,255,255,0.35)', flat: 'rgba(138,168,255,0.30)', flatLine: '#8aa8ff', floor: '#1a2338', grid: 'rgba(255,255,255,0.07)', wall: 'rgba(200,215,255,0.55)' }
      : { top: 'rgba(98,130,235,0.93)', a: 'rgba(66,94,200,0.96)', b: 'rgba(48,72,166,0.96)', line: 'rgba(255,255,255,0.5)', hi: '#15915f', hiTop: 'rgba(21,145,95,0.95)', edge: 'rgba(20,30,60,0.35)', flat: 'rgba(74,120,232,0.22)', flatLine: '#3a63c8', floor: '#f3f6fc', grid: 'rgba(60,80,130,0.13)', wall: 'rgba(40,55,100,0.55)' };
    var zmax = 0.2;
    if (!st.edit) zones.forEach(function (z) { zmax = Math.max(zmax, zoneH(z)); });
    var elev = st.edit ? Math.PI / 2 : st.elev, yaw = st.edit ? 0 : st.yaw;
    var P = makeProj(W, H, st.aspect, yaw, elev, st.edit ? 0.02 : zmax, st.zoom, st.panX, st.panY);

    /* floor, as a grid of textured triangles so the picture follows the perspective */
    var N = st.edit ? 1 : (st.fast ? 10 : 20), i, j;
    var cleanFloor = !!st.clean && !st.edit;
    if (cleanFloor) {
      ctx.fillStyle = pal.floor;
      poly(ctx, [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)]);
      ctx.fill();
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      for (i = 1; i < 10; i++) {
        var ga = P(i / 10, 0, 0), gb = P(i / 10, 1, 0), gc = P(0, i / 10, 0), gd = P(1, i / 10, 0);
        ctx.beginPath(); ctx.moveTo(ga.X, ga.Y); ctx.lineTo(gb.X, gb.Y); ctx.moveTo(gc.X, gc.Y); ctx.lineTo(gd.X, gd.Y); ctx.stroke();
      }
    }
    for (i = 0; i < N && !cleanFloor; i++) {
      for (j = 0; j < N; j++) {
        var u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
        var p00 = P(u0, v0, 0), p10 = P(u1, v0, 0), p11 = P(u1, v1, 0), p01 = P(u0, v1, 0);
        var q00 = [u0 * st.imgW, v0 * st.imgH], q10 = [u1 * st.imgW, v0 * st.imgH], q11 = [u1 * st.imgW, v1 * st.imgH], q01 = [u0 * st.imgW, v1 * st.imgH];
        drawTri(ctx, st.img, q00, q10, q11, [p00.X, p00.Y], [p10.X, p10.Y], [p11.X, p11.Y]);
        drawTri(ctx, st.img, q00, q11, q01, [p00.X, p00.Y], [p11.X, p11.Y], [p01.X, p01.Y]);
      }
    }
    ctx.lineWidth = cleanFloor ? 2.5 : 1.5;
    ctx.strokeStyle = cleanFloor ? pal.wall : pal.edge;
    poly(ctx, [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)]);
    ctx.stroke();

    var result = { proj: P, dot: null, handles: {} };
    var labels = [];

    if (st.edit) {
      zones.forEach(function (z) {
        var a = P(z.x, z.y, 0), b = P(z.x + z.w, z.y + z.h, 0);
        var bad = st.overlapIds && st.overlapIds[z.id];
        ctx.fillStyle = bad ? 'rgba(235,70,70,0.30)' : pal.flat;
        ctx.strokeStyle = bad ? '#eb4646' : pal.flatLine;
        ctx.lineWidth = bad ? 3 : 2;
        ctx.fillRect(a.X, a.Y, b.X - a.X, b.Y - a.Y);
        ctx.strokeRect(a.X, a.Y, b.X - a.X, b.Y - a.Y);
        ctx.fillStyle = pal.flatLine;
        ctx.fillRect(b.X - 8, b.Y - 8, 16, 16);
        labels.push({ text: z.name || 'Unnamed', X: (a.X + b.X) / 2, Y: (a.Y + b.Y) / 2, w: b.X - a.X });
        result.handles[z.id] = { X: b.X, Y: b.Y };
      });
      if (st.draft) {
        var da = P(st.draft.x, st.draft.y, 0), db = P(st.draft.x + st.draft.w, st.draft.y + st.draft.h, 0);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = pal.hi;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(da.X, da.Y, db.X - da.X, db.Y - da.Y);
        ctx.setLineDash([]);
      }
    } else {
      var order = zones.map(function (z) {
        var c = P(z.x + z.w / 2, z.y + z.h / 2, 0);
        return { z: z, t: c.t };
      }).sort(function (p, q) { return p.t - q.t; });

      order.forEach(function (o) {
        var z = o.z, Z = zoneH(z), n = zoneN(z), sel = st.selZoneId === z.id, zp = kindPal(z.kind, st.dark, pal);
        var x0 = z.x, x1 = z.x + z.w, y0 = z.y, y1 = z.y + z.h;
        var faces = [
          { c: [[x0, y0], [x1, y0]], col: zp.a, nx: 0, ny: 1 },
          { c: [[x1, y1], [x0, y1]], col: zp.a, nx: 0, ny: -1 },
          { c: [[x0, y1], [x0, y0]], col: zp.b, nx: -1, ny: 0 },
          { c: [[x1, y0], [x1, y1]], col: zp.b, nx: 1, ny: 0 }
        ].map(function (f) {
          var m = P((f.c[0][0] + f.c[1][0]) / 2, (f.c[0][1] + f.c[1][1]) / 2, Z / 2);
          f.t = m.t;
          return f;
        }).sort(function (p, q) { return p.t - q.t; });

        var bandBest = null;
        faces.forEach(function (f) {
          var FA = f.c[0], FB = f.c[1];
          /* Only faces that look toward the camera are drawn, so from one side you never see the shelves of the other side. */
          var fp = [P(FA[0], FA[1], 0), P(FB[0], FB[1], 0), P(FB[0], FB[1], Z), P(FA[0], FA[1], Z)], far = 0, ai;
          for (ai = 0; ai < 4; ai++) { var pa = fp[ai], pb = fp[(ai + 1) % 4]; far += pa.X * pb.Y - pb.X * pa.Y; }
          if (far <= 0) return;
          /* Only the part of a face pressed against a neighbouring box is inside; the rest of it is still a side. */
          var alongX = FA[1] === FB[1], lo = alongX ? Math.min(FA[0], FB[0]) : Math.min(FA[1], FB[1]), hi = alongX ? Math.max(FA[0], FB[0]) : Math.max(FA[1], FB[1]);
          var cover = [];
          zones.forEach(function (q) {
            if (q === z || zoneH(q) < Z - 0.002) return;
            var qx1 = q.x + q.w, qy1 = q.y + q.h, tol = 0.004;
            if (alongX) {
              var yy = FA[1];
              if ((yy === y0 && Math.abs(qy1 - yy) < tol) || (yy === y1 && Math.abs(q.y - yy) < tol)) cover.push([Math.max(lo, q.x), Math.min(hi, qx1)]);
            } else {
              var xx = FA[0];
              if ((xx === x0 && Math.abs(qx1 - xx) < tol) || (xx === x1 && Math.abs(q.x - xx) < tol)) cover.push([Math.max(lo, q.y), Math.min(hi, qy1)]);
            }
          });
          cover = cover.filter(function (c) { return c[1] - c[0] > 0.002; }).sort(function (p1, p2) { return p1[0] - p2[0]; });
          var segs = [], cur = lo;
          cover.forEach(function (c) { if (c[0] - cur > 0.01) segs.push([cur, c[0]]); if (c[1] > cur) cur = c[1]; });
          if (hi - cur > 0.01) segs.push([cur, hi]);
          var rev = alongX ? FA[0] > FB[0] : FA[1] > FB[1];
          segs.forEach(function (sg) {
            var u = rev ? sg[1] : sg[0], v = rev ? sg[0] : sg[1];
            var A = alongX ? [u, FA[1]] : [FA[0], u], B = alongX ? [v, FA[1]] : [FA[0], v];
            var pts = [P(A[0], A[1], 0), P(B[0], B[1], 0), P(B[0], B[1], Z), P(A[0], A[1], Z)];
            ctx.fillStyle = f.col;
            poly(ctx, pts);
            ctx.fill();
            var cl = cellsOf(z), longX = z.w >= z.h, isLong = alongX === longX;
            if (sel && st.selLevel !== undefined) {
              var lv = st.selLevel ? Math.min(Math.max(st.selLevel, 1), n) : 0;
              if (lv && n > 1) {
                var za = st.topFirst ? Z * (1 - lv / n) : Z * (lv - 1) / n, zb = st.topFirst ? Z * (1 - (lv - 1) / n) : Z * lv / n;
                var cc = cl[lv - 1], slot = st.selSlot && cc > 1 && st.selSlot <= cc ? st.selSlot : 0, hA = A, hB = B, show = true;
                if (slot) {
                  if (!isLong) show = false;
                  else {
                    var c0 = Math.max(sg[0], lo + (hi - lo) * (slot - 1) / cc), c1 = Math.min(sg[1], lo + (hi - lo) * slot / cc);
                    if (c1 - c0 < 0.0005) show = false;
                    else { var cu = rev ? c1 : c0, cv2 = rev ? c0 : c1; hA = alongX ? [cu, FA[1]] : [FA[0], cu]; hB = alongX ? [cv2, FA[1]] : [FA[0], cv2]; }
                  }
                }
                if (show) {
                  ctx.fillStyle = pal.hi;
                  ctx.globalAlpha = 0.85;
                  var bq = [P(hA[0], hA[1], za), P(hB[0], hB[1], za), P(hB[0], hB[1], zb), P(hA[0], hA[1], zb)];
                  poly(ctx, bq);
                  ctx.fill();
                  ctx.globalAlpha = 1;
                  var bA = 0, bi;
                  for (bi = 0; bi < 4; bi++) { var b1 = bq[bi], b2 = bq[(bi + 1) % 4]; bA += b1.X * b2.Y - b2.X * b1.Y; }
                  bA = Math.abs(bA) / 2;
                  if (!bandBest || bA > bandBest.a) bandBest = { a: bA, X: (bq[0].X + bq[1].X + bq[2].X + bq[3].X) / 4, Y: (bq[0].Y + bq[1].Y + bq[2].Y + bq[3].Y) / 4 };
                }
              }
            }
            ctx.strokeStyle = pal.line;
            ctx.lineWidth = 1;
            for (var k = 1; k < n; k++) {
              var zz = Z * k / n, l1 = P(A[0], A[1], zz), l2 = P(B[0], B[1], zz);
              ctx.beginPath(); ctx.moveTo(l1.X, l1.Y); ctx.lineTo(l2.X, l2.Y); ctx.stroke();
            }
            if (isLong && n > 1 && z.cells) {
              ctx.lineWidth = 1.5;
              for (var sk = 1; sk <= n; sk++) {
                var sc = cl[sk - 1]; if (sc < 2) continue;
                var br = bandRange(Z, n, sk, st.topFirst), si;
                for (si = 1; si < sc; si++) {
                  var tt = lo + (hi - lo) * si / sc;
                  if (tt <= sg[0] + 0.0005 || tt >= sg[1] - 0.0005) continue;
                  var d1 = alongX ? P(tt, FA[1], br[0]) : P(FA[0], tt, br[0]), d2 = alongX ? P(tt, FA[1], br[1]) : P(FA[0], tt, br[1]);
                  ctx.beginPath(); ctx.moveTo(d1.X, d1.Y); ctx.lineTo(d2.X, d2.Y); ctx.stroke();
                }
              }
              ctx.lineWidth = 1;
            }
            ctx.strokeStyle = pal.edge;
            poly(ctx, pts);
            ctx.stroke();
          });
        });

        var top = [P(x0, y0, Z), P(x1, y0, Z), P(x1, y1, Z), P(x0, y1, Z)];
        ctx.fillStyle = sel ? pal.hiTop : zp.top;
        poly(ctx, top);
        ctx.fill();
        ctx.strokeStyle = sel ? pal.hi : pal.edge;
        ctx.lineWidth = sel ? 3 : 1;
        ctx.stroke();
        var tc = P((x0 + x1) / 2, (y0 + y1) / 2, Z);
        var wpx = Math.max(Math.abs(top[1].X - top[0].X), Math.abs(top[2].X - top[3].X));
        labels.push({ text: z.name || 'Unnamed', X: tc.X, Y: tc.Y, w: wpx });
        if (sel) {
          var lz = levelZ(z, st.selLevel || 0, st.topFirst);
          var dp = P((x0 + x1) / 2, (y0 + y1) / 2, lz);
          result.dot = bandBest ? { X: bandBest.X, Y: bandBest.Y } : { X: tc.X, Y: tc.Y };
        }
      });
    }

    ctx.font = '600 12px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach(function (l) {
      var text = l.text, short = text.length <= 3;
      if (short) {
        if (l.w < 8) return;
        ctx.font = '700 ' + Math.max(9, Math.min(13, l.w * 0.85)) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
      } else {
        if (l.w < 44) return;
        ctx.font = '600 12px -apple-system, "Segoe UI", Roboto, sans-serif';
      }
      while (text.length > 3 && ctx.measureText(text).width > l.w - 6) text = text.slice(0, -2);
      if (text !== l.text) text = text.trim() + '…';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,16,40,0.7)';
      ctx.strokeText(text, l.X, l.Y);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, l.X, l.Y);
    });
    return result;
  }

  var api = { makeProj: makeProj, drawScene: drawScene, shelfNumber: shelfNumber, levelZ: levelZ, findZone: findZone, zoneH: zoneH, tidyZones: tidyZones };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof document === 'undefined') return;

  /* ---------- Screen ---------- */
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var KEY = 'shelf-finder-map-v1';
  var map = null, imgEl = null;
  var focusDot = false, zoom = 1, panX = 0, panY = 0, pointers = {}, pinch = null, lastTap = 0;
  var tapStart = null, lastTapUp = 0, holdTimer = null;
  function clearHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } var w = $('#mapCv'); if (w) w.classList.remove('grabbed'); }
  var yaw = 0, elev = 0.95, edit = false, sel = null, drawing = null, pendingName = '', fast = false, raf = 0, last = null;
  var zoneEditing = null;

  function loadMap() {
    try { var m = JSON.parse(localStorage.getItem(KEY) || 'null'); if (m && m.img) return m; } catch (e) {}
    return null;
  }
  var KEY2 = 'shelf-finder-maps-v1', extras = [], cur = 'main';
  function loadExtras() {
    try { var a = JSON.parse(localStorage.getItem(KEY2) || '[]'); return Array.isArray(a) ? a.filter(function (m) { return m && m.id; }) : []; } catch (e) { return []; }
  }
  function saveExtras() { try { localStorage.setItem(KEY2, JSON.stringify(extras)); return true; } catch (e) { return false; } }
  var coldSet = [];
  function calcCold(m) { coldSet = m && m.zones ? m.zones.filter(function (z) { return z.kind === 'cooler' || z.kind === 'freezer'; }).map(function (z) { return String(z.name).trim().toLowerCase(); }) : []; }
  /* Undo history for the boxes on the map: each save keeps the layout it replaced. */
  var undoStack = [], redoStack = [], lastZ = null;
  function zSnap() { return map && map.zones ? JSON.stringify(map.zones) : null; }
  function undoUI() {
    var u = $('#mapUndoBtn'), r = $('#mapRedoBtn'); if (!u || !r) return;
    u.hidden = r.hidden = !edit; u.disabled = !undoStack.length; r.disabled = !redoStack.length;
  }
  function undoReset() { undoStack = []; redoStack = []; lastZ = zSnap(); undoUI(); }
  function applyZones(json, from, to) {
    var cur2 = zSnap(); if (cur2 !== null) to.push(cur2);
    map.zones = JSON.parse(json); lastZ = json; sel = null;
    skipUndo = true; var ok = persist(); skipUndo = false;
    if (!ok) toast('This phone has no room left to keep the map.');
    closeZone(); notify(); refresh(); undoUI();
  }
  var skipUndo = false;
  function undoMap() { if (!undoStack.length) return; applyZones(undoStack.pop(), undoStack, redoStack); toast('Undone.'); }
  function redoMap() { if (!redoStack.length) return; applyZones(redoStack.pop(), redoStack, undoStack); toast('Redone.'); }
  function persist() {
    if (!skipUndo && map) {
      var nowZ = zSnap();
      if (lastZ !== null && nowZ !== lastZ) { undoStack.push(lastZ); if (undoStack.length > 50) undoStack.shift(); redoStack = []; }
      lastZ = nowZ; undoUI();
    }
    try {
      if (cur === 'main') { localStorage.setItem(KEY, JSON.stringify(map)); calcCold(map); }
      else {
        var i = extras.findIndex(function (m) { return m.id === cur; });
        if (i >= 0) extras[i] = map;
        localStorage.setItem(KEY2, JSON.stringify(extras));
      }
      return true;
    } catch (e) { return false; }
  }
  function mapName(id) {
    id = id || cur;
    if (id === 'main') return 'Store';
    var m = extras.filter(function (x) { return x.id === id; })[0];
    return m ? (m.name || 'Map') : 'Map';
  }
  /* Where a bottle sits on one map: the main store map uses its Aisle and Shelf, every other map uses its places list. */
  function spot(it, id, pi) {
    id = id || cur;
    var pl = it.places || [], p = null;
    if (pi != null && pl[pi] && pl[pi].m === id) p = pl[pi];
    else if (id === 'main' && (it.section || it.shelf)) return { section: it.section || '', shelf: it.shelf || '' };
    else p = pl.filter(function (x) { return x.m === id; })[0] || null;
    return p ? { section: p.section || '', shelf: p.shelf || '' } : { section: '', shelf: '' };
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function items() { return root.ShelfApp ? root.ShelfApp.items() : []; }
  function notify() { if (root.ShelfApp && root.ShelfApp.refresh) root.ShelfApp.refresh(); }
  function newId() { return 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function loadImage(cb) {
    if (!map || !map.img) { imgEl = null; cb(); return; }
    var im = new Image();
    im.onload = function () { imgEl = im; cb(); };
    im.onerror = function () { imgEl = null; cb(); };
    im.src = map.img;
  }

  /* A PDF plan is drawn to a picture on this phone (first page) with pdf.js, then handled like a photo. */
  function pdfToBlob(file) {
    toast('Reading the PDF...');
    return import('./vendor/pdfjs/pdf.min.mjs').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
      return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; }).then(function (doc) {
        return doc.getPage(1).then(function (page) {
          var v1 = page.getViewport({ scale: 1 }), sc = Math.min(4, 1800 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: sc });
          var c = document.createElement('canvas'), ctx = c.getContext('2d');
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
            return new Promise(function (res, rej) { c.toBlob(function (b) { c.width = 0; c.height = 0; b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.9); });
          }).then(function (blob) { var pages = doc.numPages; doc.destroy(); return { blob: blob, pages: pages }; });
        });
      });
    });
  }
  function setMapFromBlob(blob) {
    if (window.ShelfBackup) window.ShelfBackup.snapshot('Before replacing the map photo');
    var finish = function (src, w, h) {
      var k = Math.min(1, 1400 / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      var url = c.toDataURL('image/jpeg', 0.8), cw = c.width, ch = c.height;
      c.width = 0; c.height = 0;
      var prev = map;
      map = { img: url, w: cw, h: ch, zones: prev ? prev.zones : [], topFirst: prev ? prev.topFirst : true };
      if (cur !== 'main' && prev) { map.id = prev.id; map.name = prev.name; }
      if (!persist()) { map = prev; toast('This phone has no room left to keep the map.'); return; }
      loadImage(function () { refresh(); toast('Map saved on this phone'); });
    };
    if (root.createImageBitmap) {
      createImageBitmap(blob).then(function (b) { finish(b, b.width, b.height); if (b.close) b.close(); }, function () { toast('That file is not a picture I can read.'); });
    } else {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); finish(im, im.naturalWidth, im.naturalHeight); };
      im.onerror = function () { URL.revokeObjectURL(url); toast('That file is not a picture I can read.'); };
      im.src = url;
    }
  }

  /* Rendering */
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; paint(); }); }
  function paint() {
    var tab = $('#tab-map');
    if (!tab || !tab.classList.contains('on') || !map || !imgEl) return;
    var wrap = $('#mapWrap'), cv = $('#mapCanvas');
    var W = Math.max(200, wrap.clientWidth), H = Math.round(Math.min(Math.max(W * 1.25, 380), Math.max(380, window.innerHeight * 0.7)));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var z = sel ? map.zones.filter(function (q) { return q.id === sel.zoneId; })[0] : null;
    last = drawScene(ctx, W, H, {
      img: imgEl, imgW: imgEl.naturalWidth, imgH: imgEl.naturalHeight, aspect: imgEl.naturalWidth / imgEl.naturalHeight,
      zones: map.zones, yaw: yaw, elev: elev, edit: edit, clean: map.look !== 'photo', topFirst: map.topFirst !== false,
      zoom: zoom, panX: panX, panY: panY, selZoneId: z ? z.id : null, selLevel: z ? sel.level : undefined, selSlot: z ? sel.slot : 0, draft: drawing && drawing.mode === 'draw' ? drawing.rect : null,
      dark: !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches), fast: fast, overlapIds: edit ? overlapIdMap() : null
    });
    if (focusDot && z && last.dot && !edit) {
      focusDot = false;
      var f = 2.2, ccx = W / 2, ccy = H / 2;
      var z0 = zoom || 1, bx = (last.dot.X - panX - ccx) / z0, by = (last.dot.Y - panY - ccy) / z0;
      zoom = f; panX = -bx * f; panY = -by * f;
      paint();
      return;
    }
    var dw = $('#mapDotWrap');
    if (z && last.dot && !edit) {
      dw.hidden = false;
      dw.style.left = last.dot.X + 'px';
      dw.style.top = last.dot.Y + 'px';
      $('#mapTag').textContent = z.name + (sel.level ? ' · Shelf ' + sel.level + (sel.slot && cellsOf(z)[Math.min(sel.level, cellsOf(z).length) - 1] >= sel.slot ? ' · Section ' + sel.slot : '') : (sel.item && String(spot(sel.item, cur, sel.pi).shelf).trim() === '0' ? ' · On top' : ''));
    } else dw.hidden = true;
  }

  function overlapIdMap() {
    var o = {}; if (!map) return o;
    overlapPairs(map.zones).forEach(function (p) { o[p[0].id] = 1; o[p[1].id] = 1; });
    return o;
  }
  function showOverlapMsg() {
    var el = $('#mapOverlapMsg'); if (!el) return;
    var ps = map && edit ? overlapPairs(map.zones) : [];
    if (!ps.length) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = ps.length + ' box' + (ps.length === 1 ? ' sits' : 'es sit') + ' on top of another (shown in red): ' + ps.slice(0, 4).map(function (p) { return p[0].name + ' and ' + p[1].name; }).join(', ') + (ps.length > 4 ? '...' : '') + '. Press and hold a red box, then drag it apart.';
  }
  function unproject(x, y) {
    var a = last.proj(0, 0, 0), b = last.proj(1, 1, 0);
    return { u: (x - a.X) / (b.X - a.X), v: (y - a.Y) / (b.Y - a.Y) };
  }

  /* UI state */
  function unplaced() {
    var have = {}, out = [], seen = {};
    map.zones.forEach(function (z) { have[String(z.name).trim().toLowerCase()] = 1; });
    items().forEach(function (i) {
      var sp = spot(i), k = sp.section.toLowerCase();
      if (k && !have[k] && !seen[k]) { seen[k] = 1; out.push(sp.section); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  }
  function renderTabs() {
    var h = '<button class="chip" type="button" data-mtab="main" aria-pressed="' + (cur === 'main') + '">Store</button>';
    extras.forEach(function (m) { h += '<button class="chip" type="button" data-mtab="' + esc(m.id) + '" aria-pressed="' + (cur === m.id) + '">' + esc(m.name || 'Map') + '</button>'; });
    h += '<button class="chip" type="button" data-mnew="1">+ Add map</button>';
    $('#mapTabs').innerHTML = h;
    $('#tab-map h1').textContent = extras.length ? 'Maps' : 'Store map';
  }
  function refresh() {
    if (lastZ === null) lastZ = zSnap();
    undoUI();
    var has = !!(map && imgEl), isMain = cur === 'main';
    renderTabs();
    $('#mapEmpty').hidden = has;
    $('#mapMain').hidden = !has;
    $('#mapEmptyTitle').textContent = isMain ? 'Add your store plan' : 'Add a plan for ' + mapName();
    $('#mapEmptyText').textContent = isMain ? 'Take a photo of your drawing or printout, or choose a PDF of it. It becomes a guide you trace over. The app then draws a clean 3D version of your store and makes the bottle glow where it sits.' : 'Take a photo of the drawing or choose a PDF of it. It becomes a guide you trace over, and then this place gets its own 3D map.';
    $('#mapRemoveBtn').hidden = !isMain;
    $('#mapManage').hidden = isMain;
    if (!isMain && document.activeElement !== $('#mapName')) $('#mapName').value = mapName();
    if (has) {
      $('#mapEditBtn').textContent = edit ? 'Done' : 'Edit sections';
      $('#mapEditHelp').hidden = !edit;
      $('#mapTilt').disabled = edit;
      showOverlapMsg();
      $('#segTop').setAttribute('aria-pressed', String(map.topFirst !== false));
      $('#segBottom').setAttribute('aria-pressed', String(map.topFirst === false));
      $('#segClean').setAttribute('aria-pressed', String(map.look !== 'photo'));
      $('#segPhoto').setAttribute('aria-pressed', String(map.look === 'photo'));
      if (edit) {
        var un = unplaced();
        $('#mapUnplaced').innerHTML = un.length
          ? 'Sections still to place: ' + un.map(function (n) { return '<button class="chip" type="button" data-pend="' + esc(n) + '" aria-pressed="' + (pendingName === n) + '">' + esc(n) + '</button>'; }).join(' ')
          : (map.zones.length ? 'Every section in your list is on the map.' : '');
      }
      $('#mapCv').style.touchAction = edit ? 'pan-y' : 'none';
    }
    caption();
    schedule();
  }
  function caption() {
    var c = $('#mapCaption');
    if (!sel || !sel.item) { c.hidden = true; return; }
    var it = sel.item, z = map && map.zones.filter(function (q) { return q.id === sel.zoneId; })[0];
    var name = it.brand + (it.flavor ? ' ' + it.flavor : '');
    var sp = spot(it, cur, sel.pi);
    var where = sp.section ? sp.section + (sp.shelf ? (String(sp.shelf).trim() === '0' ? ', on top' : ', shelf ' + sp.shelf) : '') : (cur === 'main' ? 'No spot saved yet' : 'No spot saved on ' + mapName());
    c.hidden = false;
    c.innerHTML = '<strong>' + esc(name) + '</strong><span>' + esc(where) + '</span>' +
      (z ? '' : (sp.section ? '<em>' + esc(sp.section) + ' is not marked on the map yet. Tap Edit sections to add it.</em>' : ''));
  }
  function switchTo(id, then) {
    if (id !== 'main' && !extras.some(function (m) { return m.id === id; })) id = 'main';
    if (id === cur && map !== undefined && (id !== 'main' || map)) { if (then) then(); return; }
    if (edit) { edit = false; restoreView(); }
    cur = id; sel = null; pendingName = ''; zoom = 1; panX = 0; panY = 0; yaw = 0;
    map = id === 'main' ? loadMap() : extras.filter(function (m) { return m.id === id; })[0] || null;
    undoReset();
    loadImage(function () { refresh(); if (then) then(); });
  }
  var held = null;
  function selectItem(it, pi) {
    held = it;
    var sp = spot(it, cur, pi), z = map ? findZone(map.zones, sp.section) : null;
    sel = { zoneId: z ? z.id : null, level: shelfNumber(sp.shelf), slot: slotNumber(sp.shelf), item: it, pi: pi };
    if (edit) { edit = false; restoreView(); }
    zoom = 1; panX = 0; panY = 0;
    focusDot = !!z;
    refresh();
  }
  var savedView = null;
  function restoreView() { if (savedView) { yaw = savedView.yaw; elev = savedView.elev; savedView = null; $('#mapTilt').value = Math.round(elev * 180 / Math.PI); } }

  /* Search on the map screen */
  function suggest() {
    var qv = $('#mapSearch').value, host = $('#mapSuggest');
    if (!window.ShelfSearch.tokens(qv).length) { host.innerHTML = ''; return; }
    var res = window.ShelfSearch.run(items(), qv).map(function (r) { return r.it; }).slice(0, 6);
    host.innerHTML = res.length ? res.map(function (it) {
      return '<button class="chip" type="button" data-pick="' + esc(it.id) + '">' + esc(it.brand + (it.flavor ? ' ' + it.flavor : '')) + '</button>';
    }).join('') : '<span class="hint">Nothing matches. Try fewer words.</span>';
  }

  /* Zone sheet */
  function openZone(z, rect) {
    zoneEditing = z ? z.id : null;
    $('#zoneTitle').textContent = z ? 'Edit section' : 'Name this section';
    $('#zName').value = z ? z.name : (pendingName || '');
    $('#zShelves').value = z ? (z.shelves || 5) : 5;
    zoneCells = z && z.cells ? cellsOf(z).slice() : [];
    setKind(z && z.kind ? z.kind : 'tall');
    $('#zDelete').hidden = !z; $('#zAddNext').hidden = !z;
    var rn = z && /^[A-Za-z]+\d*[a-z]*$/.test(String(z.name || '').trim()) ? /^[A-Za-z]+/.exec(String(z.name).trim())[0].toUpperCase() : '';
    $('#zRenumber').hidden = !rn; $('#zRenumber').textContent = rn ? 'Renumber all ' + rn + ' boxes in order' : 'Renumber in order';
    setHs(z && z.hs ? z.hs : 1);
    $('#zSplitBox').hidden = !z;
    $('#zoneErr').hidden = true;
    var names = {};
    items().forEach(function (i) { var sp = spot(i); if (sp.section) names[sp.section.toLowerCase()] = sp.section; });
    $('#dl-zone').innerHTML = Object.keys(names).sort().map(function (k) { return '<option value="' + esc(names[k]) + '">'; }).join('');
    openZone.rect = rect || null;
    $('#zoneScrim').hidden = false;
    setTimeout(function () { $('#zName').focus(); }, 30);
  }
  var zoneKind = 'tall', zoneHs = 1, zoneCells = [];
  function shelvesNow() { var n = Math.round(parseFloat($('#zShelves').value)); return n >= 1 && n <= 12 ? n : 5; }
  function renderCells() {
    var host = $('#zCells'), n = shelvesNow(), k, rows = [], top = !map || map.topFirst !== false;
    $('#zCellsField').hidden = !(zoneKind === 'tall' || zoneKind === 'cooler' || zoneKind === 'freezer') || n < 2;
    for (k = 0; k < n; k++) if (!(zoneCells[k] >= 1)) zoneCells[k] = 1;
    zoneCells.length = n;
    function row(label, key, val) { return '<div class="cellrow"><span>' + label + '</span><button class="tbtn" type="button" data-cm="' + key + '" aria-label="Fewer">−</button><b>' + val + '</b><button class="tbtn" type="button" data-cp="' + key + '" aria-label="More">+</button></div>'; }
    for (k = 1; k <= n; k++) rows.push(row('Shelf ' + k + (n > 1 ? (k === 1 ? (top ? ' (top)' : ' (bottom)') : (k === n ? (top ? ' (bottom)' : ' (top)') : '')) : ''), k, zoneCells[k - 1]));
    if (!top) rows.reverse();
    host.innerHTML = row('All shelves', 'all', zoneCells.every(function (v) { return v === zoneCells[0]; }) ? zoneCells[0] : '—') + rows.join('');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('#zCells [data-cm], #zCells [data-cp]') : null; if (!b) return;
    var key = b.getAttribute('data-cm') || b.getAttribute('data-cp'), d = b.hasAttribute('data-cp') ? 1 : -1, k;
    function bump(i) { zoneCells[i] = Math.max(1, Math.min(24, (zoneCells[i] || 1) + d)); }
    if (key === 'all') { var base = zoneCells.every(function (v) { return v === zoneCells[0]; }) ? zoneCells[0] : (d > 0 ? Math.max.apply(null, zoneCells) : Math.min.apply(null, zoneCells)); for (k = 0; k < zoneCells.length; k++) zoneCells[k] = Math.max(1, Math.min(24, base + (zoneCells.every(function (v) { return v === zoneCells[0]; }) ? d : 0))); }
    else bump(parseInt(key, 10) - 1);
    renderCells();
  });
  function setHs(v) {
    zoneHs = v;
    Array.prototype.forEach.call(document.querySelectorAll('#zHeight [data-hs]'), function (b) { b.setAttribute('aria-pressed', String(parseFloat(b.getAttribute('data-hs')) === v)); });
  }
  /* Split one box into equal parts: K becomes K1, K2, K3; K1 becomes K1a, K1b, K1c. */
  function splitZone(dir) {
    var z = zoneEditing && map.zones.filter(function (q) { return q.id === zoneEditing; })[0];
    var n = Math.round(parseFloat($('#zSplitN').value));
    if (!z) return;
    if (!(n >= 2 && n <= 12)) { $('#zoneErr').textContent = 'Choose 2 to 12 parts.'; $('#zoneErr').hidden = false; return; }
    if (window.ShelfBackup) window.ShelfBackup.snapshot('Before splitting a section');
    var sh = Math.round(parseFloat($('#zShelves').value)); if (!(sh >= 1 && sh <= 12)) sh = z.shelves || 5;
    var start = Math.round(parseFloat($('#zSplitStart').value)); if (!(start >= 0)) start = 1;
    var base = String(z.name || '').trim(), letters = /\d$/.test(base), parts = [], i;
    for (i = 0; i < n; i++) {
      var nm = letters ? base + String.fromCharCode(97 + i) : base + (start + i);
      var r = dir === 'x' ? { x: z.x + z.w * i / n, y: z.y, w: z.w / n, h: z.h } : { x: z.x, y: z.y + z.h * i / n, w: z.w, h: z.h / n };
      parts.push({ id: newId(), name: nm, x: r.x, y: r.y, w: r.w, h: r.h, shelves: sh, kind: zoneKind, hs: zoneHs === 1 ? undefined : zoneHs });
    }
    var at = map.zones.indexOf(z);
    map.zones.splice.apply(map.zones, [at, 1].concat(parts));
    if (!persist()) toast('This phone has no room left to keep the map.');
    closeZone();
    notify();
    refresh();
    toast(base + ' is now ' + parts[0].name + ' to ' + parts[parts.length - 1].name + '. Bottles that said ' + base + ' need the new names.');
  }
  /* Next box name: A3 gives A4 (one more than the highest A number already on the map). */
  function nextBoxName(name) {
    var m = /^(.*?)(\d+)$/.exec(String(name || '').trim());
    if (!m) return name ? String(name).trim() + '2' : '';
    var pre = m[1].toLowerCase(), hi = parseInt(m[2], 10);
    map.zones.forEach(function (z) { var q = /^(.*?)(\d+)$/.exec(String(z.name || '').trim()); if (q && q[1].toLowerCase() === pre) hi = Math.max(hi, parseInt(q[2], 10)); });
    return m[1] + (hi + 1);
  }
  /* A free spot of the same size right next to a box (right, below, left, above), or on top of it if the map is full there. */
  function roomNextTo(z) {
    var g = 0.004, below = { x: z.x, y: z.y + z.h + g }, above = { x: z.x, y: z.y - z.h - g }, right = { x: z.x + z.w + g, y: z.y }, left = { x: z.x - z.w - g, y: z.y }, i;
    var nm = /^([A-Za-z]+)\d+[a-z]*$/.exec(String(z.name || '').trim()), sib = nm ? map.zones.filter(function (q) { return new RegExp('^' + nm[1] + '\\d+[a-z]*$', 'i').test(String(q.name || '').trim()); }) : [], c, strict = false;
    sib = sib.filter(function (q) { return q !== z; });
    if (sib.length >= 1) {
      /* Follow the way the nearest neighbour with the same letter lies: beside it means a row, above or below it means a column. */
      var zcx = z.x + z.w / 2, zcy = z.y + z.h / 2, near = sib.slice().sort(function (a, b) { return Math.hypot(a.x + a.w / 2 - zcx, a.y + a.h / 2 - zcy) - Math.hypot(b.x + b.w / 2 - zcx, b.y + b.h / 2 - zcy); })[0];
      var vert = Math.abs(near.y + near.h / 2 - zcy) >= Math.abs(near.x + near.w / 2 - zcx);
      c = vert ? [below, above] : [right, left]; strict = true;
    } else c = [right, below, left, above];
    for (i = 0; i < c.length; i++) {
      var t = { x: c[i].x, y: c[i].y, w: z.w, h: z.h };
      if (t.x >= 0 && t.y >= 0 && t.x + t.w <= 1 && t.y + t.h <= 1 && !overlapsAny(t, map.zones)) return t;
    }
    return strict ? null : { x: Math.min(Math.max(0, z.x + z.w * 0.3), 1 - z.w), y: Math.min(Math.max(0, z.y + z.h * 0.3), 1 - z.h), w: z.w, h: z.h };
  }
  function addNextTo(z) {
    if (!z) return;
    var r = roomNextTo(z);
    if (!r) { $('#zoneErr').textContent = 'No empty room next to ' + z.name + ' in line with the others. Split ' + z.name + ' into two instead, then use Renumber.'; $('#zoneErr').hidden = false; return; }
    var nz = { id: newId(), name: nextBoxName(z.name), x: r.x, y: r.y, w: r.w, h: r.h, shelves: z.shelves || 5, kind: z.kind || 'tall' };
    if (z.hs) nz.hs = z.hs; if (z.cells) nz.cells = z.cells.slice();
    map.zones.push(nz);
    if (!persist()) toast('This phone has no room left to keep the map.');
    closeZone(); notify(); refresh();
    toast(nz.name + ' added next to ' + z.name + '. Press and hold it to move or resize.');
  }
  /* Number the boxes that share a letter (A1, A1a, A1b, A2...) in map order: A1, A2, A3... down a column or along a row. */
  function renumberFrom(z) {
    var m = z && /^([A-Za-z]+)\d*[a-z]*$/.exec(String(z.name || '').trim());
    if (!m) return;
    var pre = m[1], re = new RegExp('^' + pre + '\\d+[a-z]*$', 'i');
    var grp = map.zones.filter(function (q) { return re.test(String(q.name || '').trim()); });
    if (grp.length < 2) { $('#zoneErr').textContent = 'Only one ' + pre + ' box. Nothing to renumber.'; $('#zoneErr').hidden = false; return; }
    var xs = grp.map(function (q) { return q.x + q.w / 2; }), ys = grp.map(function (q) { return q.y + q.h / 2; });
    var vert = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) >= (Math.max.apply(null, xs) - Math.min.apply(null, xs));
    grp.sort(function (a, b) { var ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2; return vert ? (ay - by) || (ax - bx) : (ax - bx) || (ay - by); });
    if (window.ShelfBackup) window.ShelfBackup.snapshot('Before renumbering boxes');
    grp.forEach(function (q, i) { q.name = pre + (i + 1); });
    if (!persist()) toast('This phone has no room left to keep the map.');
    closeZone(); notify(); refresh();
    toast(grp.length + ' ' + pre + ' boxes numbered ' + pre + '1 to ' + pre + grp.length + (vert ? ' from the top' : ' from the left') + '. Bottles keep their old names, so check those.');
  }
  function setKind(k) {
    zoneKind = k;
    Array.prototype.forEach.call(document.querySelectorAll('#zKind [data-kind]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === k)); });
    $('#zShelvesField').hidden = !(k === 'tall' || k === 'cooler' || k === 'freezer');
    $('#zHeightField').hidden = k === 'flat';
    renderCells();
  }
  function closeZone() { $('#zoneScrim').hidden = true; zoneEditing = null; openZone.rect = null; }
  function applyCells(z, sh) {
    var shelfy = zoneKind === 'tall' || zoneKind === 'cooler' || zoneKind === 'freezer', cs = zoneCells.slice(0, sh);
    while (cs.length < sh) cs.push(1);
    if (shelfy && cs.some(function (v) { return v > 1; })) z.cells = cs; else delete z.cells;
  }
  function saveZone() {
    var name = $('#zName').value.trim(), sh = Math.round(parseFloat($('#zShelves').value));
    if (!name) { $('#zoneErr').textContent = 'Enter the aisle or section name, for example Aisle 3.'; $('#zoneErr').hidden = false; return; }
    if (!(sh >= 1 && sh <= 12)) sh = 5;
    if (zoneEditing) {
      var z = map.zones.filter(function (q) { return q.id === zoneEditing; })[0];
      if (z) { z.name = name; z.shelves = sh; z.kind = zoneKind; if (zoneHs === 1) delete z.hs; else z.hs = zoneHs; applyCells(z, sh); }
    } else if (openZone.rect) {
      var r = openZone.rect;
      var nz = { id: newId(), name: name, x: r.x, y: r.y, w: r.w, h: r.h, shelves: sh, kind: zoneKind, hs: zoneHs === 1 ? undefined : zoneHs };
      applyCells(nz, sh);
      map.zones.push(nz);
    }
    if (pendingName && pendingName.toLowerCase() === name.toLowerCase()) pendingName = '';
    if (!persist()) toast('This phone has no room left to keep the map.');
    closeZone();
    notify();
    if (sel && sel.item) selectItem(sel.item); else refresh();
  }
  function deleteZone() {
    if (!zoneEditing) return;
    map.zones = map.zones.filter(function (q) { return q.id !== zoneEditing; });
    persist();
    closeZone();
    notify();
    if (sel && sel.item) selectItem(sel.item); else refresh();
  }

  /* Pointer handling on the canvas */
  function pt(e) {
    var r = $('#mapCanvas').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  /* The camera as drawScene builds it, so a turn can keep the spot you are looking at in place. */
  function buildProj(zm, px, py) {
    var cv = $('#mapCanvas'), zmax = 0.2;
    map.zones.forEach(function (q) { zmax = Math.max(zmax, zoneH(q)); });
    return makeProj(cv.clientWidth, cv.clientHeight, imgEl.naturalWidth / imgEl.naturalHeight, yaw, elev, zmax, zm, px, py);
  }
  function floorUV(P, X, Y) {
    var u = 0.5, v = 0.5, e = 0.001, i;
    for (i = 0; i < 12; i++) {
      var f = P(u, v, 0), fu = P(u + e, v, 0), fv = P(u, v + e, 0);
      var a = (fu.X - f.X) / e, c = (fu.Y - f.Y) / e, b = (fv.X - f.X) / e, d = (fv.Y - f.Y) / e;
      var det = a * d - b * c;
      if (Math.abs(det) < 1e-9) break;
      var dx = X - f.X, dy = Y - f.Y;
      u += (d * dx - b * dy) / det;
      v += (-c * dx + a * dy) / det;
    }
    return { u: u, v: v };
  }
  function turnBy(dyaw) {
    var cv = $('#mapCanvas'), cx = cv.clientWidth / 2, cy = cv.clientHeight / 2, uv = null;
    if (zoom > 1 && map && imgEl) uv = floorUV(buildProj(zoom, panX, panY), cx, cy);
    yaw = clamp(yaw + dyaw, -1.3, 1.3);
    if (uv) { var q = buildProj(zoom, panX, panY)(uv.u, uv.v, 0); panX += cx - q.X; panY += cy - q.Y; }
  }
  function setZoom(nz, fx, fy) {
    nz = Math.max(1, Math.min(6, nz));
    var cv = $('#mapCanvas'), cx = cv.clientWidth / 2, cy = cv.clientHeight / 2;
    if (fx == null) { fx = cx; fy = cy; }
    var f = nz / zoom;
    panX = fx - cx - (fx - cx - panX) * f;
    panY = fy - cy - (fy - cy - panY) * f;
    zoom = nz;
    if (zoom === 1) { panX = 0; panY = 0; }
    schedule();
  }
  function pinchDist() { var k = Object.keys(pointers); return Math.hypot(pointers[k[0]].x - pointers[k[1]].x, pointers[k[0]].y - pointers[k[1]].y) || 1; }
  function pinchMid() { var k = Object.keys(pointers); return { x: (pointers[k[0]].x + pointers[k[1]].x) / 2, y: (pointers[k[0]].y + pointers[k[1]].y) / 2 }; }
  function onDown(e) {
    if (!map || !imgEl || !last) return;
    var p = pt(e), cv = $('#mapCanvas');
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    pointers[e.pointerId] = p;
    if (Object.keys(pointers).length === 2) {
      if (drawing && drawing.zone && drawing.orig) { drawing.zone.x = drawing.orig.x; drawing.zone.y = drawing.orig.y; drawing.zone.w = drawing.orig.w; drawing.zone.h = drawing.orig.h; }
      drawing = null;
      pinch = { d: pinchDist(), z: zoom, mid: pinchMid() };
      lastTapUp = 0; tapStart = null;
      fast = true;
      return;
    }
    if (!edit) { tapStart = { t: Date.now(), x: p.x, y: p.y }; drawing = { mode: 'orbit', x: p.x, sx: p.x, sy: p.y, moved: false }; fast = true; return; }
    var uv = unproject(p.x, p.y), hit = null, mode = 'draw', i, z;
    for (i = map.zones.length - 1; i >= 0; i--) {
      z = map.zones[i];
      var h = last.handles[z.id];
      if (h && Math.abs(p.x - h.X) < 22 && Math.abs(p.y - h.Y) < 22) { hit = z; mode = 'resize'; break; }
    }
    if (!hit) {
      for (i = map.zones.length - 1; i >= 0; i--) {
        z = map.zones[i];
        if (uv.u >= z.x && uv.u <= z.x + z.w && uv.v >= z.y && uv.v <= z.y + z.h) { hit = z; mode = 'move'; break; }
      }
    }
    drawing = { mode: mode, zone: hit, sx: p.x, sy: p.y, start: uv, moved: false, armed: e.pointerType === 'mouse', orig: hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } : null, rect: { x: uv.u, y: uv.v, w: 0, h: 0 } };
    /* On a touch screen a plain swipe scrolls the page. Boxes only move, resize or get drawn after a short press and hold. */
    if (!drawing.armed) {
      var dd = drawing;
      clearHold();
      holdTimer = setTimeout(function () {
        holdTimer = null;
        if (drawing === dd && !dd.moved) { dd.armed = true; $('#mapCv').classList.add('grabbed'); try { if (navigator.vibrate) navigator.vibrate(20); } catch (x) {} }
      }, 380);
    }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function onMove(e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = pt(e);
    if (pinch && Object.keys(pointers).length >= 2) {
      var mid = pinchMid();
      panX += mid.x - pinch.mid.x; panY += mid.y - pinch.mid.y;
      pinch.mid = mid;
      var nz = Math.max(1, Math.min(6, pinch.z * pinchDist() / pinch.d)), cv0 = $('#mapCanvas');
      var f = nz / zoom, cx = cv0.clientWidth / 2, cy = cv0.clientHeight / 2;
      panX = mid.x - cx - (mid.x - cx - panX) * f;
      panY = mid.y - cy - (mid.y - cy - panY) * f;
      zoom = nz;
      if (zoom === 1) { panX = 0; panY = 0; }
      schedule();
      return;
    }
    if (!drawing) return;
    var p = pt(e);
    if (drawing.mode === 'pan') {
      panX += p.x - drawing.x; panY += p.y - drawing.y;
      drawing.x = p.x; drawing.y = p.y;
      schedule();
      return;
    }
    if (drawing.mode === 'orbit') {
      var dx = p.x - drawing.x;
      if (Math.abs(p.x - drawing.sx) + Math.abs(p.y - drawing.sy) > 8) drawing.moved = true;
      turnBy(dx * 0.008);
      drawing.x = p.x;
      schedule();
      return;
    }
    if (Math.abs(p.x - drawing.sx) + Math.abs(p.y - drawing.sy) > 6) drawing.moved = true;
    if (!drawing.armed) { if (drawing.moved) { clearHold(); drawing = null; } return; }
    if (!drawing.moved) return;
    var uv = unproject(p.x, p.y), d = drawing;
    if (d.mode === 'draw') {
      var x0 = clamp(Math.min(d.start.u, uv.u), 0, 1), x1 = clamp(Math.max(d.start.u, uv.u), 0, 1);
      var y0 = clamp(Math.min(d.start.v, uv.v), 0, 1), y1 = clamp(Math.max(d.start.v, uv.v), 0, 1);
      d.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else if (d.mode === 'move') {
      d.zone.x = clamp(d.orig.x + (uv.u - d.start.u), 0, 1 - d.orig.w);
      d.zone.y = clamp(d.orig.y + (uv.v - d.start.v), 0, 1 - d.orig.h);
    } else if (d.mode === 'resize') {
      d.zone.w = clamp(d.orig.w + (uv.u - d.start.u), 0.03, 1 - d.orig.x);
      d.zone.h = clamp(d.orig.h + (uv.v - d.start.v), 0.03, 1 - d.orig.y);
    }
    schedule();
  }
  function onUp(e) {
    if (e && e.pointerId != null) delete pointers[e.pointerId];
    if (pinch) {
      if (Object.keys(pointers).length < 2) { pinch = null; fast = false; if (!Object.keys(pointers).length) drawing = null; schedule(); }
      return;
    }
    clearHold();
    if (!drawing) return;
    var d = drawing;
    drawing = null;
    fast = false;
    if (d.mode === 'orbit' || d.mode === 'pan') {
      var now = Date.now();
      if (!d.moved && tapStart && now - tapStart.t < 300) {
        if (now - lastTapUp < 350) { setZoom(zoom > 1.2 ? 1 : 2.5, tapStart.x, tapStart.y); lastTapUp = 0; return; }
        lastTapUp = now;
      } else lastTapUp = 0;
      schedule();
      return;
    }
    if (d.mode === 'draw') {
      if (d.moved && d.rect.w > 0.03 && d.rect.h > 0.03) openZone(null, d.rect);
    } else if (!d.moved) {
      if (d.mode === 'move') openZone(d.zone);
    } else {
      persist(); showOverlapMsg();
    }
    schedule();
  }

  function init() {
    extras = loadExtras(); cur = 'main';
    map = loadMap(); calcCold(map); undoReset();
    var cv = $('#mapCanvas');
    cv.addEventListener('touchmove', function (e) { if (edit && drawing && drawing.armed && e.cancelable) e.preventDefault(); }, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', function (e) { clearHold(); if (drawing && drawing.zone && drawing.orig && drawing.armed) { drawing.zone.x = drawing.orig.x; drawing.zone.y = drawing.orig.y; drawing.zone.w = drawing.orig.w; drawing.zone.h = drawing.orig.h; } delete pointers[e.pointerId]; if (Object.keys(pointers).length < 2) pinch = null; drawing = null; fast = false; schedule(); });
    cv.addEventListener('wheel', function (e) { if (!map || !imgEl) return; e.preventDefault(); var p = pt(e); setZoom(zoom * Math.exp(-e.deltaY * 0.002), p.x, p.y); }, { passive: false });
    $('#mapZoomIn').addEventListener('click', function () { setZoom(zoom * 1.6); });
    $('#mapZoomOut').addEventListener('click', function () { setZoom(zoom / 1.6); });
    window.addEventListener('resize', schedule);
    $('#mapPickBtn').addEventListener('click', function () { $('#mapFile').click(); });
    $('#mapReplaceBtn').addEventListener('click', function () { $('#mapFile').click(); });
    $('#mapFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) {
        pdfToBlob(f).then(function (r) { setMapFromBlob(r.blob); if (r.pages > 1) setTimeout(function () { toast('Used page 1 of ' + r.pages + ' from the PDF.'); }, 1800); }, function () { toast('Could not read that PDF. Try a screenshot of it instead.'); });
      } else setMapFromBlob(f);
    });
    $('#mapEditBtn').addEventListener('click', function () {
      edit = !edit;
      if (edit) { savedView = { yaw: yaw, elev: elev }; sel = sel; } else restoreView();
      refresh();
    });
    $('#mapUndoBtn').addEventListener('click', undoMap);
    $('#mapRedoBtn').addEventListener('click', redoMap);
    $('#mapResetBtn').addEventListener('click', function () {
      /* Clear any half-finished touch too, so nothing drags the view back. */
      clearHold(); pointers = {}; pinch = null; drawing = null; fast = false; focusDot = false;
      zoom = 1; panX = 0; panY = 0; yaw = 0; elev = 0.95; $('#mapTilt').value = Math.round(elev * 180 / Math.PI);
      $('#mapCv').classList.remove('grabbed'); paint(); schedule();
    });
    $('#mapTilt').addEventListener('input', function (e) { elev = parseFloat(e.target.value) * Math.PI / 180; fast = true; schedule(); clearTimeout(init.t); init.t = setTimeout(function () { fast = false; schedule(); }, 180); });
    $('#segClean').addEventListener('click', function () { map.look = 'clean'; persist(); refresh(); });
    $('#segPhoto').addEventListener('click', function () { map.look = 'photo'; persist(); refresh(); });
    $('#mapTidyBtn').addEventListener('click', function () {
      if (!map.zones.length) { toast('Mark a section first.'); return; }
      tidyZones(map.zones);
      persist();
      schedule();
      toast('Straightened and evened out');
    });
    $('#zKind').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (b) setKind(b.getAttribute('data-kind'));
    });
    $('#segTop').addEventListener('click', function () { map.topFirst = true; persist(); refresh(); });
    $('#segBottom').addEventListener('click', function () { map.topFirst = false; persist(); refresh(); });
    $('#mapRemoveBtn').addEventListener('click', function () {
      var b = this;
      if (b.getAttribute('data-armed') !== '1') {
        b.setAttribute('data-armed', '1');
        b.textContent = 'Tap again to remove';
        setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = 'Remove map'; }, 3000);
        return;
      }
      b.removeAttribute('data-armed');
      b.textContent = 'Remove map';
      if (window.ShelfBackup) window.ShelfBackup.snapshot('Before removing the map');
      try { localStorage.removeItem(KEY); } catch (e) {}
      map = null; imgEl = null; sel = null; edit = false; savedView = null;
      refresh();
      notify();
      toast('Map removed from this phone');
    });
    $('#mapTabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-mtab]'), n = e.target.closest('[data-mnew]');
      if (t) { $('#mapNewForm').hidden = true; var keep = (sel && sel.item) || held; switchTo(t.getAttribute('data-mtab'), keep ? function () { if (map && imgEl) selectItem(keep); } : null); return; }
      if (n) { var f = $('#mapNewForm'); f.hidden = !f.hidden; if (!f.hidden) setTimeout(function () { $('#mapNewName').focus(); }, 30); }
    });
    $('#mapNewForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var nm = $('#mapNewName').value.trim();
      if (!nm) { toast('Give the map a name, like Garage or Inventory.'); return; }
      var m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: nm.slice(0, 24), zones: [], topFirst: true };
      extras.push(m);
      if (!saveExtras()) { extras.pop(); toast('This phone has no room left to keep another map.'); return; }
      $('#mapNewName').value = ''; $('#mapNewForm').hidden = true;
      switchTo(m.id);
      notify();
    });
    $('#mapNewCancel').addEventListener('click', function () { $('#mapNewForm').hidden = true; });
    $('#mapName').addEventListener('change', function () {
      var nm = this.value.trim();
      if (cur === 'main' || !map) return;
      if (!nm) { this.value = mapName(); return; }
      map.name = nm.slice(0, 24);
      persist(); refresh(); notify();
    });
    $('#mapDeleteBtn').addEventListener('click', function () {
      var b = this;
      if (b.getAttribute('data-armed') !== '1') {
        b.setAttribute('data-armed', '1');
        b.textContent = 'Tap again to delete this map';
        setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = 'Delete this map'; }, 3000);
        return;
      }
      b.removeAttribute('data-armed'); b.textContent = 'Delete this map';
      if (cur === 'main') return;
      if (window.ShelfBackup) window.ShelfBackup.snapshot('Before deleting a map');
      var gone = cur;
      extras = extras.filter(function (m) { return m.id !== gone; });
      saveExtras();
      cur = 'main'; map = loadMap(); sel = null; edit = false; savedView = null;
      loadImage(function () { refresh(); notify(); toast('Map deleted'); });
    });
    $('#mapSearch').addEventListener('input', suggest);
    $('#mapSuggest').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (!b) return;
      var it = items().filter(function (x) { return x.id === b.getAttribute('data-pick'); })[0];
      if (!it) return;
      if (!spot(it).section) {
        var alt = ['main'].concat(extras.map(function (m) { return m.id; })).filter(function (id) { return spot(it, id).section; })[0];
        if (alt && alt !== cur) { switchTo(alt, function () { if (map && imgEl) selectItem(it); }); return; }
      }
      selectItem(it);
    });
    $('#mapUnplaced').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pend]');
      if (!b) return;
      pendingName = pendingName === b.getAttribute('data-pend') ? '' : b.getAttribute('data-pend');
      refresh();
    });
    $('#zoneForm').addEventListener('submit', function (e) { e.preventDefault(); saveZone(); });
    $('#zCancel').addEventListener('click', closeZone);
    $('#zDelete').addEventListener('click', deleteZone);
    $('#zRenumber').addEventListener('click', function () { var z = zoneEditing && map.zones.filter(function (q) { return q.id === zoneEditing; })[0]; renumberFrom(z); });
    $('#zAddNext').addEventListener('click', function () { var z = zoneEditing && map.zones.filter(function (q) { return q.id === zoneEditing; })[0]; addNextTo(z); });
    $('#mapAddBox').addEventListener('click', function () {
      if (!map) return;
      var ref = map.zones[map.zones.length - 1], rect, nm = '';
      if (ref) { rect = roomNextTo(ref) || { x: 0.45, y: 0.45, w: ref.w, h: ref.h }; nm = nextBoxName(ref.name); } else rect = { x: 0.45, y: 0.45, w: 0.1, h: 0.1 };
      pendingName = nm; openZone(null, rect);
    });
    var bulkKind = 'cooler';
    $('#bulkKind').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bk]'); if (!b) return;
      bulkKind = b.getAttribute('data-bk');
      Array.prototype.forEach.call(document.querySelectorAll('#bulkKind [data-bk]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    $('#bulkApply').addEventListener('click', function () {
      var raw = $('#bulkNames').value, names = [];
      raw.split(/[,;\n&+]+|\s+and\s+/i).forEach(function (t) {
        t = t.trim(); if (!t) return;
        var m = /^([A-Za-z]*)\s*(\d+)\s*[-–]\s*(?:[A-Za-z]*)\s*(\d+)$/.exec(t);
        if (m && parseInt(m[3], 10) >= parseInt(m[2], 10) && parseInt(m[3], 10) - parseInt(m[2], 10) < 200) { for (var n = parseInt(m[2], 10); n <= parseInt(m[3], 10); n++) names.push(m[1] + n); }
        else names.push(t);
      });
      if (!names.length) { toast('Type the box names first, like 1-17, FD.'); return; }
      var byName = {}; map.zones.forEach(function (z) { byName[String(z.name).trim().toLowerCase()] = z; });
      var hit = [], miss = [];
      names.forEach(function (n) { var z = byName[n.toLowerCase()]; if (z) { if (hit.indexOf(z) < 0) hit.push(z); } else miss.push(n); });
      if (!hit.length) { toast('No box with those names. Check the spelling.'); return; }
      if (window.ShelfBackup) window.ShelfBackup.snapshot('Before changing many boxes');
      hit.forEach(function (z) { z.kind = bulkKind; if (!z.shelves) z.shelves = 5; });
      if (!persist()) toast('This phone has no room left to keep the map.');
      notify(); refresh();
      var label = { tall: 'Shelves', cooler: 'Cooler', freezer: 'Freezer', low: 'Counter' }[bulkKind];
      toast(hit.length + ' box' + (hit.length === 1 ? '' : 'es') + ' set to ' + label + (miss.length ? '. Not found: ' + miss.slice(0, 4).join(', ') + (miss.length > 4 ? '...' : '') : ''));
    });
    $('#bulkDelete').addEventListener('click', function () {
      var raw = $('#bulkNames').value, names = [];
      raw.split(/[,;\n&+]+|\s+and\s+/i).forEach(function (t) {
        t = t.trim(); if (!t) return;
        var mm = /^([A-Za-z]*)\s*(\d+)\s*[-–]\s*(?:[A-Za-z]*)\s*(\d+)$/.exec(t);
        if (mm && parseInt(mm[3], 10) >= parseInt(mm[2], 10) && parseInt(mm[3], 10) - parseInt(mm[2], 10) < 200) { for (var n = parseInt(mm[2], 10); n <= parseInt(mm[3], 10); n++) names.push(mm[1] + n); }
        else names.push(t);
      });
      if (!names.length) { toast('Type the box names first, like A4-A6.'); return; }
      var set = {}; names.forEach(function (n) { set[n.toLowerCase()] = 1; });
      var hit = map.zones.filter(function (z) { return set[String(z.name).trim().toLowerCase()]; });
      if (!hit.length) { toast('No box with those names. Check the spelling.'); return; }
      var ok = true; try { ok = window.confirm('Delete ' + hit.length + ' box' + (hit.length === 1 ? '' : 'es') + ' (' + hit.slice(0, 5).map(function (z) { return z.name; }).join(', ') + (hit.length > 5 ? '...' : '') + ')? Bottles stay in your list. You can Undo.'); } catch (e) {}
      if (!ok) return;
      map.zones = map.zones.filter(function (z) { return hit.indexOf(z) < 0; });
      if (!persist()) toast('This phone has no room left to keep the map.');
      notify(); refresh();
      toast(hit.length + ' box' + (hit.length === 1 ? '' : 'es') + ' deleted. Tap Undo to bring back.');
    });
    $('#zShelves').addEventListener('input', renderCells);
    $('#zHeight').addEventListener('click', function (e) { var b = e.target.closest('[data-hs]'); if (b) setHs(parseFloat(b.getAttribute('data-hs'))); });
    $('#zSplitX').addEventListener('click', function () { splitZone('x'); });
    $('#zSplitY').addEventListener('click', function () { splitZone('y'); });
    $('#zoneScrim').addEventListener('mousedown', function (e) { if (e.target === this) closeZone(); });
    loadImage(function () { refresh(); notify(); });
  }

  root.ShelfMap = {
    debug: function () { return { zoom: zoom, panX: panX, panY: panY, yaw: yaw, pointers: Object.keys(pointers).length }; },
    coldNames: function () { return coldSet; },
    maps: function () { return [{ id: 'main', name: 'Store' }].concat(extras.map(function (m) { return { id: m.id, name: m.name || 'Map' }; })); },
    has: function (id) {
      id = id || 'main';
      var m = id === cur ? map : (id === 'main' ? loadMap() : extras.filter(function (x) { return x.id === id; })[0]);
      return !!(m && m.zones && m.zones.length);
    },
    mapOf: function (id) { return id === 'main' ? loadMap() : extras.filter(function (x) { return x.id === id; })[0] || null; },
    zoneNames: function (id) { var m = this.mapOf(id || 'main'); return m && m.zones ? m.zones.map(function (z) { return z.name; }) : []; },
    zoneInfo: function (name, id) {
      var m = this.mapOf(id || 'main'), z = m && m.zones ? findZone(m.zones, name) : null;
      return z ? { shelves: (z.kind === 'flat' || z.kind === 'low') ? 1 : (z.shelves || 5), topFirst: m.topFirst !== false, kind: z.kind || 'tall', cells: z.cells ? cellsOf(z) : null } : null;
    },
    editZone: function (name, id) { var mm = this.mapOf(id || 'main'), z = mm && mm.zones ? findZone(mm.zones, name) : null; if (z && (id || 'main') === cur) openZone(z); return !!z; },
    onShow: function () { refresh(); },
    show: function (it, id, pi) {
      if (root.ShelfApp) root.ShelfApp.showTab('map');
      switchTo(id || 'main', function () { if (map && imgEl) selectItem(it, pi); });
    }
  };
  init();
})(typeof window !== 'undefined' ? window : globalThis);
