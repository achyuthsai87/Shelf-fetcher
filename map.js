/* Store map. The plan photo becomes a floor that tilts into 3D; each marked section
   rises into a block. Pure geometry, no AI. The projection and drawing code at the top
   has no DOM so it can be tested by rendering to an image. */
(function (root) {
  'use strict';

  /* ---------- Geometry and drawing ---------- */
  var ZH_BASE = 0.05, ZH_PER = 0.018;
  function zoneH(z) {
    if (z.kind === 'flat') return 0.006;
    if (z.kind === 'low') return 0.06;
    return ZH_BASE + ZH_PER * (z.shelves || 5);
  }
  function zoneN(z) { return (z.kind === 'flat' || z.kind === 'low') ? 1 : (z.shelves || 5); }
  function shelfNumber(s) { var m = String(s == null ? '' : s).match(/\d+/); return m ? parseInt(m[0], 10) : 0; }
  function levelZ(zone, lvl, topFirst) {
    var n = zoneN(zone), h = zoneH(zone);
    if (!lvl || n === 1) return h;
    var L = Math.min(Math.max(lvl, 1), n);
    return h * (topFirst ? 1 - (L - 0.5) / n : (L - 0.5) / n);
  }
  function findZone(zones, section) {
    var k = String(section == null ? '' : section).trim().toLowerCase();
    if (!k) return null;
    for (var i = 0; i < zones.length; i++) if (String(zones[i].name).trim().toLowerCase() === k) return zones[i];
    return null;
  }

  /* Floor fractions (u right, v down in the picture) plus a height z -> screen point. */
  function makeProj(W, H, aspect, yaw, elev, zmax) {
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
    var ox = W / 2 - k * (minX + maxX) / 2, oy = H / 2 + k * (minY + maxY) / 2;
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
  function tidyZones(zones) {
    var g = 0.02;
    function snap(v) { return Math.round(v / g) * g; }
    function r4(v) { return Math.round(v * 10000) / 10000; }
    zones.forEach(function (z) {
      var x0 = Math.max(0, snap(z.x)), y0 = Math.max(0, snap(z.y));
      var x1 = Math.min(1, snap(z.x + z.w)), y1 = Math.min(1, snap(z.y + z.h));
      z.x = x0; z.y = y0;
      z.w = Math.max(g, x1 - x0);
      z.h = Math.max(g, y1 - y0);
    });
    ['w', 'h'].forEach(function (key) {
      var byKind = {};
      zones.forEach(function (z) { var k = z.kind || 'tall'; (byKind[k] = byKind[k] || []).push(z); });
      Object.keys(byKind).forEach(function (k) {
        var sorted = byKind[k].sort(function (a, b) { return a[key] - b[key]; }), group = [];
        var flush = function () {
          if (!group.length) return;
          var mean = group.reduce(function (t, z) { return t + z[key]; }, 0) / group.length;
          var v = Math.max(g, snap(mean));
          group.forEach(function (z) { z[key] = Math.min(v, 1 - (key === 'w' ? z.x : z.y)); });
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

  /* st: {img, imgW, imgH, aspect, zones, yaw, elev, edit, clean, topFirst, selZoneId, selLevel, draft, dark, fast} */
  function drawScene(ctx, W, H, st) {
    var zones = st.zones || [];
    var pal = st.dark
      ? { top: 'rgba(138,168,255,0.92)', a: 'rgba(98,126,216,0.96)', b: 'rgba(72,96,178,0.96)', line: 'rgba(255,255,255,0.35)', hi: '#34d399', hiTop: 'rgba(52,211,153,0.95)', edge: 'rgba(255,255,255,0.35)', flat: 'rgba(138,168,255,0.30)', flatLine: '#8aa8ff', floor: '#1a2338', grid: 'rgba(255,255,255,0.07)', wall: 'rgba(200,215,255,0.55)' }
      : { top: 'rgba(98,130,235,0.93)', a: 'rgba(66,94,200,0.96)', b: 'rgba(48,72,166,0.96)', line: 'rgba(255,255,255,0.5)', hi: '#15915f', hiTop: 'rgba(21,145,95,0.95)', edge: 'rgba(20,30,60,0.35)', flat: 'rgba(74,120,232,0.22)', flatLine: '#3a63c8', floor: '#f3f6fc', grid: 'rgba(60,80,130,0.13)', wall: 'rgba(40,55,100,0.55)' };
    var zmax = 0.2;
    if (!st.edit) zones.forEach(function (z) { zmax = Math.max(zmax, zoneH(z)); });
    var elev = st.edit ? Math.PI / 2 : st.elev, yaw = st.edit ? 0 : st.yaw;
    var P = makeProj(W, H, st.aspect, yaw, elev, st.edit ? 0.02 : zmax);

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
        ctx.fillStyle = pal.flat;
        ctx.strokeStyle = pal.flatLine;
        ctx.lineWidth = 2;
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
        var z = o.z, Z = zoneH(z), n = zoneN(z), sel = st.selZoneId === z.id;
        var x0 = z.x, x1 = z.x + z.w, y0 = z.y, y1 = z.y + z.h;
        var faces = [
          { c: [[x0, y0], [x1, y0]], col: pal.a, nx: 0, ny: 1 },
          { c: [[x1, y1], [x0, y1]], col: pal.a, nx: 0, ny: -1 },
          { c: [[x0, y1], [x0, y0]], col: pal.b, nx: -1, ny: 0 },
          { c: [[x1, y0], [x1, y1]], col: pal.b, nx: 1, ny: 0 }
        ].map(function (f) {
          var m = P((f.c[0][0] + f.c[1][0]) / 2, (f.c[0][1] + f.c[1][1]) / 2, Z / 2);
          f.t = m.t;
          return f;
        }).sort(function (p, q) { return p.t - q.t; });

        faces.forEach(function (f) {
          var A = f.c[0], B = f.c[1];
          var pts = [P(A[0], A[1], 0), P(B[0], B[1], 0), P(B[0], B[1], Z), P(A[0], A[1], Z)];
          ctx.fillStyle = f.col;
          poly(ctx, pts);
          ctx.fill();
          if (sel && st.selLevel !== undefined) {
            var lv = st.selLevel ? Math.min(Math.max(st.selLevel, 1), n) : 0;
            if (lv && n > 1) {
              var za = st.topFirst ? Z * (1 - lv / n) : Z * (lv - 1) / n, zb = st.topFirst ? Z * (1 - (lv - 1) / n) : Z * lv / n;
              ctx.fillStyle = pal.hi;
              ctx.globalAlpha = 0.85;
              poly(ctx, [P(A[0], A[1], za), P(B[0], B[1], za), P(B[0], B[1], zb), P(A[0], A[1], zb)]);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          }
          ctx.strokeStyle = pal.line;
          ctx.lineWidth = 1;
          for (var k = 1; k < n; k++) {
            var zz = Z * k / n, l1 = P(A[0], A[1], zz), l2 = P(B[0], B[1], zz);
            ctx.beginPath(); ctx.moveTo(l1.X, l1.Y); ctx.lineTo(l2.X, l2.Y); ctx.stroke();
          }
          ctx.strokeStyle = pal.edge;
          poly(ctx, pts);
          ctx.stroke();
        });

        var top = [P(x0, y0, Z), P(x1, y0, Z), P(x1, y1, Z), P(x0, y1, Z)];
        ctx.fillStyle = sel ? pal.hiTop : pal.top;
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
          result.dot = { X: dp.X, Y: dp.Y };
        }
      });
    }

    ctx.font = '600 12px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach(function (l) {
      if (l.w < 44) return;
      var text = l.text;
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
  var yaw = 0, elev = 0.95, edit = false, sel = null, drawing = null, pendingName = '', fast = false, raf = 0, last = null;
  var zoneEditing = null;

  function loadMap() {
    try { var m = JSON.parse(localStorage.getItem(KEY) || 'null'); if (m && m.img) return m; } catch (e) {}
    return null;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(map)); return true; } catch (e) { return false; }
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
    if (!map) { imgEl = null; cb(); return; }
    var im = new Image();
    im.onload = function () { imgEl = im; cb(); };
    im.onerror = function () { imgEl = null; cb(); };
    im.src = map.img;
  }

  function setMapFromBlob(blob) {
    var finish = function (src, w, h) {
      var k = Math.min(1, 1400 / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      var url = c.toDataURL('image/jpeg', 0.8), cw = c.width, ch = c.height;
      c.width = 0; c.height = 0;
      var prev = map;
      map = { img: url, w: cw, h: ch, zones: prev ? prev.zones : [], topFirst: prev ? prev.topFirst : true };
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
    var W = Math.max(200, wrap.clientWidth), H = Math.round(Math.min(Math.max(W * 0.95, 300), Math.max(300, window.innerHeight * 0.58)));
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
      selZoneId: z ? z.id : null, selLevel: z ? sel.level : undefined, draft: drawing && drawing.mode === 'draw' ? drawing.rect : null,
      dark: !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches), fast: fast
    });
    var dw = $('#mapDotWrap');
    if (z && last.dot && !edit) {
      dw.hidden = false;
      dw.style.left = last.dot.X + 'px';
      dw.style.top = last.dot.Y + 'px';
      $('#mapTag').textContent = z.name + (sel.level ? ' · Shelf ' + sel.level : '');
    } else dw.hidden = true;
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
      var k = i.section.toLowerCase();
      if (k && !have[k] && !seen[k]) { seen[k] = 1; out.push(i.section); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  }
  function refresh() {
    var has = !!(map && imgEl);
    $('#mapEmpty').hidden = has;
    $('#mapMain').hidden = !has;
    if (has) {
      $('#mapEditBtn').textContent = edit ? 'Done' : 'Edit sections';
      $('#mapEditHelp').hidden = !edit;
      $('#mapTilt').disabled = edit;
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
      $('#mapCv').style.touchAction = edit ? 'none' : 'pan-y';
    }
    caption();
    schedule();
  }
  function caption() {
    var c = $('#mapCaption');
    if (!sel || !sel.item) { c.hidden = true; return; }
    var it = sel.item, z = map && map.zones.filter(function (q) { return q.id === sel.zoneId; })[0];
    var name = it.brand + (it.flavor ? ' ' + it.flavor : '');
    var where = it.section ? it.section + (it.shelf ? ', shelf ' + it.shelf : '') : 'No spot saved yet';
    c.hidden = false;
    c.innerHTML = '<strong>' + esc(name) + '</strong><span>' + esc(where) + '</span>' +
      (z ? '' : (it.section ? '<em>' + esc(it.section) + ' is not marked on the map yet. Tap Edit sections to add it.</em>' : ''));
  }
  function selectItem(it) {
    var z = map ? findZone(map.zones, it.section) : null;
    sel = { zoneId: z ? z.id : null, level: shelfNumber(it.shelf), item: it };
    if (edit) { edit = false; restoreView(); }
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
    setKind(z && z.kind ? z.kind : 'tall');
    $('#zDelete').hidden = !z;
    $('#zoneErr').hidden = true;
    var names = {};
    items().forEach(function (i) { if (i.section) names[i.section.toLowerCase()] = i.section; });
    $('#dl-zone').innerHTML = Object.keys(names).sort().map(function (k) { return '<option value="' + esc(names[k]) + '">'; }).join('');
    openZone.rect = rect || null;
    $('#zoneScrim').hidden = false;
    setTimeout(function () { $('#zName').focus(); }, 30);
  }
  var zoneKind = 'tall';
  function setKind(k) {
    zoneKind = k;
    Array.prototype.forEach.call(document.querySelectorAll('#zKind [data-kind]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === k)); });
    $('#zShelvesField').hidden = k !== 'tall';
  }
  function closeZone() { $('#zoneScrim').hidden = true; zoneEditing = null; openZone.rect = null; }
  function saveZone() {
    var name = $('#zName').value.trim(), sh = Math.round(parseFloat($('#zShelves').value));
    if (!name) { $('#zoneErr').textContent = 'Enter the aisle or section name, for example Aisle 3.'; $('#zoneErr').hidden = false; return; }
    if (!(sh >= 1 && sh <= 12)) sh = 5;
    if (zoneEditing) {
      var z = map.zones.filter(function (q) { return q.id === zoneEditing; })[0];
      if (z) { z.name = name; z.shelves = sh; z.kind = zoneKind; }
    } else if (openZone.rect) {
      var r = openZone.rect;
      map.zones.push({ id: newId(), name: name, x: r.x, y: r.y, w: r.w, h: r.h, shelves: sh, kind: zoneKind });
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
  function onDown(e) {
    if (!map || !imgEl || !last) return;
    var p = pt(e), cv = $('#mapCanvas');
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    if (!edit) { drawing = { mode: 'orbit', x: p.x, moved: false }; fast = true; return; }
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
    drawing = { mode: mode, zone: hit, sx: p.x, sy: p.y, start: uv, moved: false, orig: hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } : null, rect: { x: uv.u, y: uv.v, w: 0, h: 0 } };
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function onMove(e) {
    if (!drawing) return;
    var p = pt(e);
    if (drawing.mode === 'orbit') {
      var dx = p.x - drawing.x;
      if (Math.abs(dx) > 1) drawing.moved = true;
      yaw = clamp(yaw + dx * 0.008, -1.3, 1.3);
      drawing.x = p.x;
      schedule();
      return;
    }
    if (Math.abs(p.x - drawing.sx) + Math.abs(p.y - drawing.sy) > 6) drawing.moved = true;
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
  function onUp() {
    if (!drawing) return;
    var d = drawing;
    drawing = null;
    fast = false;
    if (d.mode === 'orbit') { schedule(); return; }
    if (d.mode === 'draw') {
      if (d.moved && d.rect.w > 0.03 && d.rect.h > 0.03) openZone(null, d.rect);
    } else if (!d.moved) {
      if (d.mode === 'move') openZone(d.zone);
    } else {
      persist();
    }
    schedule();
  }

  function init() {
    map = loadMap();
    var cv = $('#mapCanvas');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', function () { drawing = null; fast = false; schedule(); });
    window.addEventListener('resize', schedule);
    $('#mapPickBtn').addEventListener('click', function () { $('#mapFile').click(); });
    $('#mapStarterBtn').addEventListener('click', function () {
      Promise.all([fetch('./starter-layout.json').then(function (r) { return r.json(); }), fetch('./starter-plan.jpg').then(function (r) { return r.blob(); })]).then(function (res) {
        var fr = new FileReader();
        fr.onload = function () {
          var prev = map;
          map = { img: fr.result, w: res[0].w, h: res[0].h, zones: res[0].zones, topFirst: true };
          if (!persist()) { map = prev; toast('This phone has no room left to keep the map.'); return; }
          loadImage(function () { refresh(); notify(); toast('Store layout loaded'); });
        };
        fr.readAsDataURL(res[1]);
      }).catch(function () { toast('Could not load the layout. Check your connection.'); });
    });
    $('#mapReplaceBtn').addEventListener('click', function () { $('#mapFile').click(); });
    $('#mapFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) setMapFromBlob(f);
      e.target.value = '';
    });
    $('#mapEditBtn').addEventListener('click', function () {
      edit = !edit;
      if (edit) { savedView = { yaw: yaw, elev: elev }; sel = sel; } else restoreView();
      refresh();
    });
    $('#mapResetBtn').addEventListener('click', function () { yaw = 0; elev = 0.95; $('#mapTilt').value = Math.round(elev * 180 / Math.PI); schedule(); });
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
      try { localStorage.removeItem(KEY); } catch (e) {}
      map = null; imgEl = null; sel = null; edit = false; savedView = null;
      refresh();
      notify();
      toast('Map removed from this phone');
    });
    $('#mapSearch').addEventListener('input', suggest);
    $('#mapSuggest').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (!b) return;
      var it = items().filter(function (x) { return x.id === b.getAttribute('data-pick'); })[0];
      if (it) selectItem(it);
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
    $('#zoneScrim').addEventListener('mousedown', function (e) { if (e.target === this) closeZone(); });
    loadImage(function () { refresh(); notify(); });
  }

  root.ShelfMap = {
    has: function () { return !!(map && map.zones && map.zones.length); },
    zoneNames: function () { return map && map.zones ? map.zones.map(function (z) { return z.name; }) : []; },
    zoneInfo: function (name) {
      var z = map && map.zones ? findZone(map.zones, name) : null;
      return z ? { shelves: (z.kind === 'flat' || z.kind === 'low') ? 1 : (z.shelves || 5), topFirst: map.topFirst !== false } : null;
    },
    onShow: function () { refresh(); },
    show: function (it) {
      if (root.ShelfApp) root.ShelfApp.showTab('map');
      if (map && imgEl) selectItem(it);
    }
  };
  init();
})(typeof window !== 'undefined' ? window : globalThis);
