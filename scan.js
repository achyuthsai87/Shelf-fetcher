/* Barcode scanner. The camera feed is only shown on screen and read on this phone; nothing is
   saved or uploaded. Uses the phone's built-in detector when it has one, and a bundled reader
   (vendor/zxing) everywhere else. A photo of the barcode works too. */
(function (root) {
  'use strict';
  var libPromise = null;
  function loadLib() {
    if (root.ZXing) return Promise.resolve(root.ZXing);
    if (!libPromise) {
      libPromise = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = 'vendor/zxing/zxing.min.js';
        s.onload = function () { res(root.ZXing); };
        s.onerror = function () { libPromise = null; rej(new Error('lib')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }
  var wasmPromise = null;
  /* The main reader: zxing-cpp compiled to WebAssembly. It reads barcodes at any angle (sideways too), small or blurry ones much better than the older reader. */
  function loadWasm() {
    if (root.ZXingWASM && root.__zxwReady) return Promise.resolve(root.ZXingWASM);
    if (!wasmPromise) {
      wasmPromise = new Promise(function (res, rej) {
        function ready() {
          try { root.ZXingWASM.setZXingModuleOverrides({ locateFile: function (p) { return p.slice(-5) === '.wasm' ? 'vendor/zxing-wasm/zxing_reader.wasm' : p; } }); } catch (e) {}
          /* Warm it up so the first real frame is fast; also proves the .wasm file loads. */
          var c = document.createElement('canvas'); c.width = c.height = 8;
          root.ZXingWASM.readBarcodes(c.getContext('2d').getImageData(0, 0, 8, 8), { formats: ['EAN-13'] }).then(function () { root.__zxwReady = true; res(root.ZXingWASM); }, function (e) { wasmPromise = null; rej(e); });
        }
        if (root.ZXingWASM) return ready();
        var s = document.createElement('script');
        s.src = 'vendor/zxing-wasm/reader.js';
        s.onload = ready;
        s.onerror = function () { wasmPromise = null; rej(new Error('wasm')); };
        document.head.appendChild(s);
      });
    }
    return wasmPromise;
  }
  var WOPT = { formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF', 'QRCode'], tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 1 };
  function grab(src, sw, sh, sx, sy, cw, ch, maxw, cv) {
    var k = Math.min(1, maxw / cw);
    cv.width = Math.round(cw * k); cv.height = Math.round(ch * k);
    var cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(src, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
    return cx.getImageData(0, 0, cv.width, cv.height);
  }
  function $(s) { return document.querySelector(s); }

  var state = null;
  setTimeout(function () { if (root.requestIdleCallback) root.requestIdleCallback(function () { try { loadWasm().catch(function () {}); } catch (e) {} }); }, 3000);

  function stop() {
    if (!state) return;
    state.dead = true;
    try { if (state.reader) state.reader.reset(); } catch (e) {}
    try { clearInterval(state.timer); } catch (e) {}
    try { if (state.ac) state.ac.close(); } catch (e) {}
    try { if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    var ov = $('#scanOv'); if (ov) ov.remove();
    state = null;
  }

  function open(onCode, opts) {
    opts = opts || {};
    if (state) stop();
    var ov = document.createElement('div');
    ov.className = 'scanov' + (opts.continuous ? ' cont' : ''); ov.id = 'scanOv';
    ov.innerHTML = (opts.head ? '<div class="scanhead">' + opts.head + '</div>' : '') + '<div class="scanbox"><video id="scanVideo" playsinline muted autoplay></video><div class="scanline"></div></div>' +
      '<p class="scanmsg" id="scanMsg">Starting the camera...</p>' +
      '<div class="scanrow"><input id="scanType" inputmode="none" enterkeyhint="done" placeholder="Tap to type, or scan with a scanner" autocomplete="off"><button class="btn" id="scanTypeGo" type="button">Use</button></div>' +
      (opts.continuous ? '<div class="scanlog" id="scanLog"></div>' : '') +
      '<div class="scanrow"><label class="btn ghost scanpick">Use a photo instead<input id="scanPhoto" type="file" accept="image/*" capture="environment" hidden></label><button class="btn' + (opts.continuous ? '' : ' ghost') + '" id="scanClose" type="button">' + (opts.doneText || 'Close') + '</button></div>';
    document.body.appendChild(ov);
    state = { dead: false, onCode: onCode, done: false, opts: opts, lastCode: '', lastAt: 0 };
    var msg = $('#scanMsg');
    function found(code) {
      if (!state || state.done || state.dead || state.hold) return;
      code = String(code || '').trim(); if (code.indexOf('SF1|') !== 0) code = code.replace(/\s+/g, '');
      if (!code) return;
      if (opts.continuous) {
        var now = Date.now();
        if (code === state.lastCode && now - state.lastAt < 2500) { state.lastAt = now; return; }
        state.lastCode = code; state.lastAt = now;
        var r = state.onCode(code);
        if (r && r.text) addLog(r);
        return;
      }
      state.done = true;
      var cb = state.onCode;
      stop();
      cb(code);
    }
    function addLog(r) {
      var host = $('#scanLog'); if (!host) return;
      var d = document.createElement('div'); d.className = 'logrow ' + (r.cls || '');
      var sp = document.createElement('span'); sp.textContent = r.text; d.appendChild(sp);
      if (r.undo) { var b = document.createElement('button'); b.type = 'button'; b.className = 'tbtn'; b.textContent = 'Undo'; b.addEventListener('click', function () { try { r.undo(); } catch (e) {} sp.textContent = 'Undone'; d.className = 'logrow'; b.remove(); }); d.appendChild(b); }
      if (r.action) { var ab = document.createElement('button'); ab.type = 'button'; ab.className = 'tbtn'; ab.textContent = r.action.label; ab.addEventListener('click', function () { try { r.action.fn(); } catch (e) {} }); d.appendChild(ab); }
      host.insertBefore(d, host.firstChild);
      if (opts.beep !== false) beep(r.cls === 'bad');
    }
    state.addLog = addLog;
    function beep(bad) {
      try {
        if (navigator.vibrate) navigator.vibrate(bad ? [40, 40, 40] : 25);
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        var c = state.ac || (state.ac = new AC()), o = c.createOscillator(), g = c.createGain();
        o.frequency.value = bad ? 220 : 880; g.gain.value = 0.08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.1);
      } catch (e) {}
    }
    /* A hardware scanner types the code and presses Enter, so the field is focused without a keyboard popping up. Tapping it brings the keyboard for typing by hand. */
    var tin = $('#scanType');
    tin.addEventListener('pointerdown', function () { if (tin.getAttribute('inputmode') === 'none') { tin.setAttribute('inputmode', 'numeric'); tin.blur(); setTimeout(function () { tin.focus(); }, 30); } });
    if (opts.continuous) setTimeout(function () { try { if (state && !state.dead) tin.focus({ preventScroll: true }); } catch (e) {} }, 60);
    $('#scanClose').addEventListener('click', function () { var d = opts.onDone; stop(); if (d) d(); });
    $('#scanTypeGo').addEventListener('click', function () { var tv = $('#scanType'); found(tv.value); tv = $('#scanType'); if (tv) tv.value = ''; if (state && state.typingDone) state.typingDone(); });
    $('#scanType').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var tv = $('#scanType'); found(tv.value); tv = $('#scanType'); if (tv) tv.value = ''; if (state && state.typingDone) state.typingDone(); } });
    $('#scanPhoto').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      msg.textContent = 'Reading the photo...';
      var url = URL.createObjectURL(f);
      function noneFound() { URL.revokeObjectURL(url); if (state) msg.textContent = 'No barcode found in that photo. Try again, closer and in focus.'; }
      function oldReader() {
        loadLib().then(function (Z) {
          var r = new Z.BrowserMultiFormatReader();
          return r.decodeFromImageUrl(url).then(function (res) { URL.revokeObjectURL(url); found(res.getText()); }, noneFound);
        }, function () { URL.revokeObjectURL(url); if (state) msg.textContent = 'Could not load the scanner.'; });
      }
      loadWasm().then(function (W) {
        var im = new Image();
        im.onload = function () {
          var cv = document.createElement('canvas'), w = im.naturalWidth, h = im.naturalHeight;
          W.readBarcodes(grab(im, w, h, 0, 0, w, h, 1600, cv), WOPT).then(function (rs) {
            var r = rs.filter(function (x) { return x.isValid; })[0];
            if (r) { URL.revokeObjectURL(url); found(r.text); } else oldReader();
          }, oldReader);
        };
        im.onerror = noneFound; im.src = url;
      }, oldReader);
    });
    var video = $('#scanVideo');
    /* The camera only runs while it is needed: it is switched off while a pop-up is open or while you type, and back on afterwards (saves battery). */
    function startCam() {
      if (!state || state.dead) return;
      var gen = state.gen = (state.gen || 0) + 1;
      state.paused = false;
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { msg.textContent = 'This phone will not open the camera here. Use a photo or type the number.'; return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (stream) {
        if (!state || state.dead || state.gen !== gen) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        state.stream = stream;
        video.srcObject = stream;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        msg.textContent = 'Point at the barcode, about 6 to 8 inches away. Any angle works.';
        /* Autofocus / zoom nudges where the phone allows them (ignored otherwise). */
        try {
          var tr = stream.getVideoTracks()[0], cap = tr.getCapabilities ? tr.getCapabilities() : {}, adv = {};
          if (cap.focusMode && cap.focusMode.indexOf('continuous') >= 0) adv.focusMode = 'continuous';
          if (cap.zoom && cap.zoom.max >= 1.5) adv.zoom = Math.min(cap.zoom.max, Math.max(cap.zoom.min || 1, 1.5));
          if (Object.keys(adv).length) tr.applyConstraints({ advanced: [adv] }).catch(function () {});
        } catch (e) {}
        loadWasm().then(function (W) {
          if (!state || state.dead || state.gen !== gen) return;
          var cv = document.createElement('canvas'), busy = false, n = 0;
          state.timer = setInterval(function () {
            if (!state || state.done || state.hold || busy || video.readyState < 2 || !video.videoWidth) return;
            busy = true;
            var vw = video.videoWidth, vh = video.videoHeight, mid = (n++ % 2) === 0;
            /* Alternate: the middle of the frame at full detail, then the whole frame. */
            var id = mid ? grab(video, vw, vh, vw * 0.15, vh * 0.15, vw * 0.7, vh * 0.7, 1280, cv) : grab(video, vw, vh, 0, 0, vw, vh, 1280, cv);
            W.readBarcodes(id, WOPT).then(function (rs) {
              busy = false;
              var r = rs.filter(function (x) { return x.isValid; })[0];
              if (r) found(r.text);
            }, function () { busy = false; });
          }, 90);
        }, function () { fallbackReader(stream, gen); });
      }, function () {
        if (state) msg.textContent = 'The camera is blocked. Allow camera access for this app in the phone settings, or use a photo or type the number.';
      });
    }
    function fallbackReader(stream, gen) {
      {
        if (root.BarcodeDetector) {
          var det;
          try { det = new root.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] }); } catch (e) { det = null; }
          if (det) {
            state.timer = setInterval(function () {
              if (!state || state.done || video.readyState < 2) return;
              det.detect(video).then(function (r) { if (r && r[0]) found(r[0].rawValue); }, function () {});
            }, 250);
            return;
          }
        }
        loadLib().then(function (Z) {
          if (!state || state.dead || state.gen !== gen) return;
          var hints = new Map();
          hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
          hints.set(Z.DecodeHintType.TRY_HARDER, true);
          var rd = new Z.MultiFormatReader(); rd.setHints(hints);
          var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
          state.timer = setInterval(function () {
            if (!state || state.done || video.readyState < 2 || !video.videoWidth) return;
            var k = Math.min(1, 960 / video.videoWidth);
            cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
            cx.drawImage(video, 0, 0, cv.width, cv.height);
            try {
              var bm = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv)));
              found(rd.decode(bm).getText());
            } catch (e) { /* no barcode in this frame */ }
          }, 220);
        }, function () { if (state) msg.textContent = 'Could not load the scanner. Use a photo or type the number.'; });
      }
    }
    function pauseCam() {
      if (!state || state.dead || state.paused) return;
      state.paused = true; state.gen = (state.gen || 0) + 1;
      try { clearInterval(state.timer); } catch (e) {}
      try { if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      state.stream = null; try { video.srcObject = null; } catch (e) {}
      msg.textContent = 'Camera is off while you type. It comes back on its own.';
    }
    function resumeCam() { if (state && !state.dead && state.paused && !state.hold) startCam(); }
    state.pauseCam = pauseCam; state.resumeCam = resumeCam;
    tin.addEventListener('focus', function () { if (tin.getAttribute('inputmode') !== 'none') pauseCam(); });
    tin.addEventListener('blur', function () { setTimeout(function () { if (state && document.activeElement !== tin) resumeCam(); }, 350); });
    function typingDone() {
      if (!state || state.hold) return;
      tin.setAttribute('inputmode', 'none'); tin.blur();
      setTimeout(function () { if (state && !state.dead) { try { tin.focus({ preventScroll: true }); } catch (e) {} resumeCam(); } }, 40);
    }
    state.typingDone = typingDone;
    startCam();
  }

  root.ShelfScan = { open: open, close: stop, hold: function (b) { if (!state) return; state.hold = !!b; if (b) { if (state.pauseCam) state.pauseCam(); } else { var ti = document.getElementById('scanType'); if (ti) ti.setAttribute('inputmode', 'none'); if (state.resumeCam) state.resumeCam(); } }, setHead: function (html) { var e = document.querySelector('#scanOv .scanhead'); if (e) e.innerHTML = html; }, log: function (r) { if (state && state.addLog) state.addLog(r); } };
})(typeof window !== 'undefined' ? window : globalThis);
