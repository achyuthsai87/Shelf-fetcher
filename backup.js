/* Backups for everything Shelf Finder keeps on this phone: bottles, the map and its sections.
   - Automatic snapshots before anything risky (reloading the layout, replacing or removing the map,
     importing a list, restoring) and about once a day. The newest 6 are kept.
   - A backup file you can save to Files, email to yourself, or move to another phone.
   Nothing here ever leaves the phone unless you save the file. */
(function (root) {
  'use strict';
  var LV = 'shelf-finder-lastver-v1', LF = 'shelf-finder-forcenudge-v1', LB = 'shelf-finder-lastbackup-v1', B = 'shelf-finder-bottles-v1', M = 'shelf-finder-map-v1', X = 'shelf-finder-maps-v1', R = 'shelf-finder-maprot', S = 'shelf-finder-snapshots-v1', MAX = 6;
  var $ = function (s) { return document.querySelector(s); };
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function counts(b, m, x) {
    var n = 0, z = 0;
    try { n = (JSON.parse(b || '[]') || []).length; } catch (e) {}
    try { var mm = JSON.parse(m || 'null'); z = mm && mm.zones ? mm.zones.length : 0; } catch (e) {}
    try { (JSON.parse(x || '[]') || []).forEach(function (q) { z += q && q.zones ? q.zones.length : 0; }); } catch (e) {}
    return { n: n, z: z };
  }
  function list() { try { return JSON.parse(get(S) || '[]') || []; } catch (e) { return []; } }
  function writeList(l) {
    for (var i = 0; i < 6; i++) {
      try { localStorage.setItem(S, JSON.stringify(l)); return true; } catch (e) { l = l.slice(0, -1); if (!l.length) return false; }
    }
    return false;
  }
  function snapshot(reason) {
    var b = get(B), m = get(M), x = get(X), c = counts(b, m, x);
    if (!c.n && !c.z) return false;
    var l = list();
    if (l.length && l[0].b === b && l[0].m === m && l[0].x === x) return false;
    l.unshift({ t: Date.now(), reason: reason || 'Automatic', b: b, m: m, x: x, n: c.n, z: c.z });
    var ok = writeList(l.slice(0, MAX));
    render();
    return ok;
  }
  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3000);
  }
  function when(t) {
    var d = new Date(t), now = new Date(), same = d.toDateString() === now.toDateString();
    var hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return same ? 'Today ' + hm : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hm;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function apply(b, m, rot, x) {
    snapshot('Before restore');
    try {
      localStorage.setItem(B, b || '[]');
      if (m) localStorage.setItem(M, m); else localStorage.removeItem(M);
      if (x !== undefined) { if (x) localStorage.setItem(X, x); else localStorage.removeItem(X); }
      if (rot != null) localStorage.setItem(R, rot);
    } catch (e) { toast('Could not restore: this phone is out of space.'); return; }
    location.reload();
  }

  function djb(s) { var h = 5381, i; for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }
  /* Shelf sections and box height count too, but only when set, so older backups still compare equal. */
  function zsig(z) {
    var a = [z.name, z.x, z.y, z.w, z.h, z.shelves, z.kind];
    if (z.cells) a.push('c' + JSON.stringify(z.cells));
    if (z.hs) a.push('h' + z.hs);
    return a.join('\u0001');
  }
  function sigs() {
    var it = {}, zs = {};
    try { (JSON.parse(get(B) || '[]') || []).forEach(function (x) { it[x.id] = djb([x.brand, x.flavor, x.type, x.size, x.section, x.shelf, x.notes, JSON.stringify(x.places || [])].join('\u0001')); }); } catch (e) {}
    try { var mm = JSON.parse(get(M) || 'null'); ((mm && mm.zones) || []).forEach(function (z) { zs[z.id] = djb(zsig(z)); }); } catch (e) {}
    try { (JSON.parse(get(X) || '[]') || []).forEach(function (q) { ((q && q.zones) || []).forEach(function (z) { zs[q.id + ':' + z.id] = djb(zsig(z)); }); zs[q.id + ':map'] = djb(String(q.name) + (q.img ? q.img.length : 0)); }); } catch (e) {}
    return { i: it, z: zs };
  }
  function lastBackup() { try { return JSON.parse(get(LB) || 'null'); } catch (e) { return null; } }
  function markBackedUp() {
    var c = counts(get(B), get(M), get(X)), s = sigs();
    try { localStorage.setItem(LB, JSON.stringify({ t: Date.now(), n: c.n, z: c.z, i: s.i, zs: s.z })); localStorage.removeItem(LF); } catch (e) {}
    status();
  }
  /* How many bottles or sections were added or changed since the last backup. */
  function changes() {
    var lb = lastBackup(), s = sigs(), n = 0, k;
    for (k in s.i) if (!lb || !lb.i || lb.i[k] !== s.i[k]) n++;
    for (k in s.z) if (!lb || !lb.zs || lb.zs[k] !== s.z[k]) n++;
    return n;
  }
  var REMIND_AT = 5;
  function stale() { return changes() >= REMIND_AT; }
  function status() {
    var el = $('#backupStatus'), lb = lastBackup(), ch = changes();
    if (el) {
      var tail = ch ? ch + ' bottle or section change' + (ch === 1 ? '' : 's') + ' since then.' : 'Nothing has changed since.';
      el.textContent = lb ? 'Last backup: ' + when(lb.t) + ' (' + lb.n + ' bottles). ' + tail : 'No backup saved yet. ' + (ch ? ch + ' bottle or section change' + (ch === 1 ? '' : 's') + ' not backed up.' : '');
    }
    var nd = $('#backupNudge');
    if (nd) {
      var show = ch >= REMIND_AT || (ch > 0 && get(LF) === '1');
      nd.hidden = !show;
      if (show) nd.textContent = ch + ' new or changed bottle' + (ch === 1 ? '' : 's') + ' and section' + (ch === 1 ? '' : 's') + ' not backed up. Tap to save a backup.';
    }
  }
  function saveFile(done) {
    var b = get(B), m = get(M), x = get(X), c = counts(b, m, x);
    if (!c.n && !c.z) { toast('Nothing to back up yet.'); return; }
    var payload = { app: 'shelf-finder', version: 2, savedAt: new Date().toISOString(), bottles: JSON.parse(b || '[]'), map: m ? JSON.parse(m) : null, maps: x ? JSON.parse(x) : [], mapView: get(R) };
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    var name = 'shelf-finder-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    try {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Shelf Finder backup' }).then(function () { markBackedUp(); toast('Backup saved: ' + c.n + ' bottles, ' + c.z + ' sections'); if (typeof done === 'function') done(); }, function () {});
        return;
      }
    } catch (e) {}
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    markBackedUp();
    toast('Backup saved: ' + c.n + ' bottles, ' + c.z + ' sections');
    if (typeof done === 'function') setTimeout(done, 600);
  }

  function restoreFile(file) {
    var r = new FileReader();
    r.onload = function () {
      var o;
      try { o = JSON.parse(String(r.result || '')); } catch (e) { o = null; }
      if (!o || o.app !== 'shelf-finder' || !Array.isArray(o.bottles) || (o.map && !o.map.img)) { toast('That is not a Shelf Finder backup file.'); return; }
      if (o.maps != null && !Array.isArray(o.maps)) { toast('That is not a Shelf Finder backup file.'); return; }
      var xs = Array.isArray(o.maps) ? JSON.stringify(o.maps) : null;
      var c = counts(JSON.stringify(o.bottles), o.map ? JSON.stringify(o.map) : null, xs);
      if (!window.confirm('Replace what is on this phone with the backup (' + c.n + ' bottles, ' + c.z + ' sections)? Your current data is saved to the automatic backups first.')) return;
      apply(JSON.stringify(o.bottles), o.map ? JSON.stringify(o.map) : null, o.mapView, xs === null ? undefined : xs);
    };
    r.readAsText(file);
  }

  function render() {
    var host = $('#autoBackups');
    if (!host) return;
    var l = list();
    host.innerHTML = l.length ? l.map(function (s, i) {
      return '<div class="bkrow"><span><b>' + esc(when(s.t)) + '</b><small>' + esc(s.reason) + ' · ' + s.n + ' bottles, ' + s.z + ' sections</small></span><button class="link" type="button" data-restore="' + i + '">Restore</button></div>';
    }).join('') : '<p class="hint">No automatic backups yet. One is made before anything risky and about once a day.</p>';
  }

  function init() {
    if (!$('#saveBackupBtn')) return;
    $('#saveBackupBtn').addEventListener('click', function () { saveFile(); });
    var nudge = document.createElement('button');
    nudge.id = 'backupNudge'; nudge.className = 'nudge'; nudge.type = 'button'; nudge.hidden = true;
    nudge.addEventListener('click', function () { saveFile(); });
    var hero = document.querySelector('#tab-find .hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(nudge, hero.nextSibling);
    /* After an app update, keep reminding until a backup is saved. */
    try {
      var sc = document.querySelector('script[src*="backup.js"]'), mv = sc && /[?&]v=(\d+)/.exec(sc.getAttribute('src')), cur = mv ? mv[1] : '', old = get(LV);
      if (cur && old !== cur) { localStorage.setItem(LV, cur); if (old && changes() > 0) localStorage.setItem(LF, '1'); }
    } catch (e) {}
    status();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) status(); });
    setInterval(status, 60000);
    $('#restoreBackupBtn').addEventListener('click', function () { $('#restoreFile').click(); });
    $('#restoreFile').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) restoreFile(f); });
    $('#autoBackups').addEventListener('click', function (e) {
      var b = e.target.closest('[data-restore]');
      if (!b) return;
      var s = list()[parseInt(b.getAttribute('data-restore'), 10)];
      if (!s) return;
      if (!window.confirm('Go back to ' + when(s.t) + ' (' + s.n + ' bottles, ' + s.z + ' sections)? What is on the phone now is saved to the automatic backups first.')) return;
      apply(s.b, s.m, null, s.x);
    });
    var standalone = !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    function note(p) {
      var el = $('#persistNote'); if (!el) return;
      var t = standalone ? 'Running as an installed app, which keeps its data separate from your browser history.' : 'Tip: open this page in Safari, tap Share, then Add to Home Screen, and use that icon. An installed app keeps its data even when you clear browser history.';
      el.textContent = (p ? 'This phone has agreed to keep your data safe from low-space cleanups. ' : '') + t + ' Clearing website data on purpose can still erase it, so keep a Drive backup.';
    }
    note(false);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(note, function () {}); } catch (e) {}
    var l = list();
    if (!l.length || Date.now() - l[0].t > 6 * 3600 * 1000) snapshot('Automatic');
    render();
  }

  /* "Back up first?" before an update. Back up now, update anyway, or close (no update). */
  function confirmUpdate(proceed) {
    var old = document.getElementById('updateAsk');
    if (old) old.remove();
    var ch = changes(), lb = lastBackup();
    var msg = !counts(get(B), get(M)).n && !counts(get(B), get(M)).z ? 'There is nothing saved on this phone yet.'
      : ch ? ch + ' bottle or section change' + (ch === 1 ? ' is' : 's are') + ' not backed up' + (lb ? ' since ' + when(lb.t) : ' yet') + '. Updating keeps your data, but a backup file is your safety net.'
      : 'Your last backup (' + (lb ? when(lb.t) : 'none') + ') is up to date. Updating keeps your data.';
    var el = document.createElement('div');
    el.className = 'scrim'; el.id = 'updateAsk';
    el.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="Back up before updating"><h2>Back up before updating?</h2><p class="hint">' + esc(msg) + '</p>' +
      '<div class="askbtns"><button class="btn" type="button" data-a="backup">Back up, then update</button><button class="btn ghost" type="button" data-a="anyway">Update anyway</button><button class="btn ghost" type="button" data-a="close">Close, don\u2019t update</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]');
      if (!a) { if (e.target === el) el.remove(); return; }
      var k = a.getAttribute('data-a');
      if (k === 'close') { el.remove(); return; }
      if (k === 'anyway') { el.remove(); proceed(); return; }
      el.remove();
      saveFile(proceed);
    });
  }

  root.ShelfBackup = { snapshot: snapshot, confirmUpdate: confirmUpdate };
  init();
})(window);
