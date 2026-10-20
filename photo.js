/* Find by photo. Everything runs on the phone. A picture lives only in memory
   (a canvas) while the label is being read, then it is wiped. Nothing is saved,
   uploaded or cached, and no file is written to the phone. */
(function (root) {
  'use strict';

  /* ---------- Matching (pure functions, no DOM) ---------- */
  var STOP = { the: 1, and: 1, proof: 1, vol: 1, alc: 1, product: 1, distilled: 1, bottled: 1, produced: 1, since: 1, estd: 1, premium: 1, imported: 1, liter: 1, litre: 1 };

  function words(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
      .filter(function (w) { return w.length >= 3 && !STOP[w]; });
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }
  function makeCtx(text) {
    var list = Array.from(new Set(words(text)));
    var set = {};
    list.forEach(function (w) { set[w] = 1; });
    var low = String(text || '').toLowerCase();
    return { list: list, set: set, joined: low.replace(/[^a-z0-9]+/g, ''), };
  }
  function hasWord(ctx, w) {
    if (ctx.set[w]) return true;
    if (w.length < 5) return false;
    var tol = w.length >= 9 ? 2 : 1;
    for (var i = 0; i < ctx.list.length; i++) {
      var o = ctx.list[i];
      if (Math.abs(o.length - w.length) <= tol && lev(o, w, tol) <= tol) return true;
    }
    return false;
  }
  function scoreItem(it, ctx) {
    var bw = words(it.brand);
    if (!bw.length) return null;
    var hit = 0;
    bw.forEach(function (w) { if (hasWord(ctx, w)) hit++; });
    var b = hit / bw.length;
    var compact = String(it.brand).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (b < 1 && compact.length >= 6 && ctx.joined.indexOf(compact) >= 0) b = 1;
    if (b < 0.5) return null;
    var fw = words(it.flavor), f = 0;
    if (fw.length) {
      var fh = 0;
      fw.forEach(function (w) { if (hasWord(ctx, w)) fh++; });
      f = fh / fw.length;
    }
    var tw = words(it.type), t = 0;
    if (tw.length && tw.some(function (w) { return hasWord(ctx, w); })) t = 1;
    var sz = String(it.size || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    var s = sz && ctx.joined.indexOf(sz.replace(/\./g, '')) >= 0 ? 1 : 0;
    var score = b * 3 + f * 1.6 + t * 0.4 + s * 0.4 - (fw.length && f === 0 ? 0.3 : 0);
    return { item: it, score: score, exact: b === 1 };
  }
  function rank(items, text, max) {
    var ctx = makeCtx(text);
    var out = [];
    items.forEach(function (it) {
      var r = scoreItem(it, ctx);
      if (r) out.push(r);
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, max || 4);
  }

  var TYPES = [[/\bbourbon\b/, 'Bourbon'], [/\bscotch\b/, 'Scotch'], [/\bwhisk(e)?y\b/, 'Whiskey'], [/\btequila\b/, 'Tequila'], [/\bmezcal\b/, 'Mezcal'],
    [/\bvodka\b/, 'Vodka'], [/\brum\b/, 'Rum'], [/\bgin\b/, 'Gin'], [/\bcognac\b/, 'Cognac'], [/\bbrandy\b/, 'Brandy'], [/\bliqueur\b/, 'Liqueur'],
    [/\bwine\b/, 'Wine'], [/\bbeer\b/, 'Beer']];
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, function (m, a, c) { return a + c.toUpperCase(); });
  }
  function guess(lines, text) {
    var best = '', bestScore = 0;
    (lines || []).forEach(function (l) {
      var t = String(l.text || '').replace(/[^A-Za-z0-9'&\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.replace(/[^A-Za-z]/g, '').length < 3) return;
      if ((l.confidence || 0) < 55) return;
      var onlyGeneric = t.toLowerCase().split(' ').every(function (w) {
        return !w || /^\d/.test(w) || TYPES.some(function (ty) { return ty[0].test(w); });
      });
      if (onlyGeneric) return;
      var h = l.bbox ? (l.bbox.y1 - l.bbox.y0) : 0;
      var s = h * Math.min(t.length, 6);
      if (s > bestScore) { bestScore = s; best = t; }
    });
    var low = String(text || '').toLowerCase(), type = '';
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0].test(low)) { type = TYPES[i][1]; break; }
    var m = low.match(/(?:^|[^\d.,])(\d{1,4}(?:[.,]\d{1,2})?)\s*(ml|cl|l)\b/), size = '';
    if (m) {
      var n = m[1].replace(',', '.');
      size = m[2] === 'l' ? n + 'L' : m[2] === 'cl' ? String(Math.round(parseFloat(n) * 10)) + 'ml' : n + 'ml';
    }
    return { brand: best ? titleCase(best) : '', type: type, size: size };
  }

  var api = { words: words, rank: rank, guess: guess };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof document === 'undefined') return;
  root.ShelfPhoto = api;

  /* ---------- Screen ---------- */
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var stream = null, worker = null, busy = false, bitmap = null;
  var scrim, video, canvas, stage;

  function status(msg) {
    var p = $('#photoStatus');
    p.textContent = msg || '';
    p.hidden = !msg;
  }
  function showChoices(on) {
    $('#photoChoices').hidden = !on;
    $('#pasteBox').hidden = !on;
  }
  function stopCam() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    video.srcObject = null;
    video.hidden = true;
    $('#camControls').hidden = true;
  }
  /* Remove every trace of the picture from memory. */
  function wipe() {
    try { canvas.width = 0; canvas.height = 0; } catch (e) {}
    canvas.hidden = true;
    stage.hidden = true;
    if (bitmap && bitmap.close) { try { bitmap.close(); } catch (e) {} }
    bitmap = null;
    $('#photoFile').value = '';
  }

  function openPhoto() {
    stopCam();
    wipe();
    status('');
    $('#photoResults').innerHTML = '';
    showChoices(true);
    scrim.hidden = false;
  }
  function closePhoto() {
    stopCam();
    wipe();
    busy = false;
    scrim.hidden = true;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (root.Tesseract) return res();
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('reader')); };
      document.head.appendChild(s);
    });
  }
  function getWorker() {
    if (worker) return Promise.resolve(worker);
    var base = new URL('vendor/tesseract/', location.href).href;
    status('Loading the label reader. The first time takes a few seconds.');
    return loadScript(base + 'tesseract.min.js').then(function () {
      return root.Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false
      });
    }).then(function (w) {
      return w.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' }).then(function () { worker = w; return w; });
    });
  }

  /* Draw the source into the working canvas, sized for reading, in grey with stretched contrast. */
  function prepare(src, w, h) {
    var max = 1600, k = Math.min(1, max / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data, i;
    var hist = new Uint32Array(256);
    for (i = 0; i < d.length; i += 4) {
      var g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    var total = d.length / 4, acc = 0, lo = 0, hi = 255;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
    var span = Math.max(40, hi - lo);
    for (i = 0; i < d.length; i += 4) {
      var v = Math.max(0, Math.min(255, ((d[i] - lo) * 255 / span) | 0));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  function inverted() {
    var c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0);
    var img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    for (var i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; }
    x.putImageData(img, 0, 0);
    return c;
  }

  function readLabel() {
    var text = '', lines = [], w;
    return getWorker().then(function (wk) {
      w = wk;
      status('Reading the label…');
      return w.recognize(canvas);
    }).then(function (r) {
      text += r.data.text + '\n';
      lines = lines.concat(r.data.lines || []);
      var inv = inverted();
      return w.recognize(inv).then(function (r2) {
        inv.width = 0; inv.height = 0;
        text += r2.data.text;
        lines = lines.concat(r2.data.lines || []);
        return { text: text, lines: lines };
      });
    });
  }

  function handleSource(src, w, h) {
    if (busy) return;
    busy = true;
    showChoices(false);
    $('#photoResults').innerHTML = '';
    stage.hidden = false;
    canvas.hidden = false;
    video.hidden = true;
    var result = null, failed = false;
    try { prepare(src, w, h); } catch (e) { failed = true; }
    if (failed) { wipe(); busy = false; status('That picture could not be opened. Try another one.'); showChoices(true); return; }
    readLabel().then(function (r) { result = r; }, function () { failed = true; }).then(function () {
      wipe();
      busy = false;
      if (failed) {
        status('The label reader could not start. Check your connection once so it can download, then try again.');
        showChoices(true);
        return;
      }
      showResults(result);
    });
  }

  function handleBlob(blob) {
    if (busy || !blob) return;
    var done = function (bmp) {
      bitmap = bmp;
      handleSource(bmp, bmp.width, bmp.height);
    };
    if (root.createImageBitmap) {
      createImageBitmap(blob).then(done, function () { status('That file is not a picture I can read.'); });
    } else {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); handleSource(im, im.naturalWidth, im.naturalHeight); };
      im.onerror = function () { URL.revokeObjectURL(url); status('That file is not a picture I can read.'); };
      im.src = url;
    }
  }

  function card(r, label) {
    var it = r.item;
    var meta = [it.type, it.size].filter(Boolean).join(' · ');
    var loc = it.section || it.shelf
      ? '<div class="loc"><span class="sec">' + (it.section ? esc(it.section) : 'Shelf') + '</span>' + (it.shelf ? '<span class="shelf">' + (it.section ? 'Shelf ' : '') + esc(it.shelf) + '</span>' : '') + '</div>'
      : '<div class="loc none"><span class="sec">No spot yet</span></div>';
    return '<li class="glass item"><div class="row"><div class="info"><p class="match-label">' + esc(label) + '</p><h3 class="brand">' + esc(it.brand) + '</h3>' +
      (it.flavor ? '<p class="flavor">' + esc(it.flavor) + '</p>' : '') + (meta ? '<p class="meta">' + esc(meta) + '</p>' : '') + '</div>' + loc + '</div></li>';
  }

  function showResults(res) {
    var items = root.ShelfApp ? root.ShelfApp.items() : [];
    var ranked = rank(items, res.text, 4);
    var g = guess(res.lines, res.text);
    var h = '';
    if (ranked.length) {
      h += '<ul class="list">' + ranked.map(function (r, i) {
        return card(r, i === 0 ? (r.exact ? 'Best match' : 'Possible match') : 'Also possible');
      }).join('') + '</ul>';
      status('Photo wiped from memory. Nothing was saved.');
    } else {
      var seen = [g.brand, g.type, g.size].filter(Boolean).join(' · ');
      h += '<div class="glass empty"><h2>Not in your list</h2><p>' + (seen ? 'It looks like: ' + esc(seen) + '.' : 'I could not read enough of the label.') + ' Try again with the label facing the camera and good light, or add it.</p></div>';
      status('Photo wiped from memory. Nothing was saved.');
    }
    h += '<div class="sheet-actions" style="margin-top:12px">' +
      '<button class="btn ghost grow" type="button" id="againBtn">Another photo</button>' +
      (root.ShelfApp ? '<button class="btn grow" type="button" id="addGuessBtn">Add as new bottle</button>' : '') + '</div>';
    $('#photoResults').innerHTML = h;
    $('#againBtn').addEventListener('click', openPhoto);
    var ag = $('#addGuessBtn');
    if (ag) ag.addEventListener('click', function () {
      closePhoto();
      root.ShelfApp.openAdd({ brand: g.brand, type: g.type, size: g.size });
    });
  }

  /* Camera */
  function startCam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status('Camera is not available here. Use Paste or Upload instead.');
      return;
    }
    status('Opening the camera…');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(function () {
        showChoices(false);
        stage.hidden = false;
        canvas.hidden = true;
        video.hidden = false;
        $('#camControls').hidden = false;
        status('Hold the label flat and in good light, then tap Snap.');
      })
      .catch(function () {
        stopCam();
        status('The camera is blocked. Allow camera access for this site, or use Paste or Upload.');
      });
  }
  function snap() {
    if (!stream || !video.videoWidth) return;
    var w = video.videoWidth, h = video.videoHeight;
    var tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(video, 0, 0, w, h);
    stopCam();
    handleSource(tmp, w, h);
    tmp.width = 0; tmp.height = 0;
  }

  /* Paste */
  function pasteButton() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      status('This browser cannot read the clipboard from a button. Hold in the box below and tap Paste.');
      return;
    }
    navigator.clipboard.read().then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var type = list[i].types.filter(function (t) { return t.indexOf('image/') === 0; })[0];
        if (type) { list[i].getType(type).then(handleBlob); return; }
      }
      status('No picture on the clipboard. Copy a picture first, then tap Paste.');
    }).catch(function () {
      status('Clipboard access was blocked. Hold in the box below and tap Paste, or use Upload.');
    });
  }
  function imageFromPaste(e) {
    var files = e.clipboardData && e.clipboardData.files;
    if (!files) return null;
    for (var i = 0; i < files.length; i++) if (files[i].type.indexOf('image/') === 0) return files[i];
    return null;
  }

  function init() {
    scrim = $('#photoScrim');
    video = $('#camVideo');
    canvas = $('#photoCanvas');
    stage = $('#photoStage');
    $('#photoBtn').addEventListener('click', openPhoto);
    $('#photoClose').addEventListener('click', closePhoto);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closePhoto(); });
    $('#camBtn').addEventListener('click', startCam);
    $('#snapBtn').addEventListener('click', snap);
    $('#camCancel').addEventListener('click', function () { stopCam(); status(''); showChoices(true); });
    $('#pasteBtn').addEventListener('click', pasteButton);
    $('#uploadBtn').addEventListener('click', function () { $('#photoFile').click(); });
    $('#photoFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) handleBlob(f);
    });
    var box = $('#pasteBox');
    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var f = imageFromPaste(e);
      if (f) handleBlob(f); else status('No picture on the clipboard. Copy a picture first.');
    });
    box.addEventListener('keydown', function (e) { if (!(e.ctrlKey || e.metaKey)) e.preventDefault(); });
    document.addEventListener('paste', function (e) {
      var f = imageFromPaste(e);
      if (!f) return;
      e.preventDefault();
      if (scrim.hidden) openPhoto();
      handleBlob(f);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopCam(); if (!busy) wipe(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !scrim.hidden) closePhoto(); });
  }
  init();
})(typeof window !== 'undefined' ? window : globalThis);
