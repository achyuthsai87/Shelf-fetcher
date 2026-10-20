/* Backups for everything Shelf Finder keeps on this phone: bottles, the map and its sections.
   - Automatic snapshots before anything risky (reloading the layout, replacing or removing the map,
     importing a list, restoring) and about once a day. The newest 6 are kept.
   - A backup file you can save to Files, email to yourself, or move to another phone.
   Nothing here ever leaves the phone unless you save the file. */
(function (root) {
  'use strict';
  var LB = 'shelf-finder-lastbackup-v1', B = 'shelf-finder-bottles-v1', M = 'shelf-finder-map-v1', R = 'shelf-finder-maprot', S = 'shelf-finder-snapshots-v1', MAX = 6;
  var $ = function (s) { return document.querySelector(s); };
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function counts(b, m) {
    var n = 0, z = 0;
    try { n = (JSON.parse(b || '[]') || []).length; } catch (e) {}
    try { var mm = JSON.parse(m || 'null'); z = mm && mm.zones ? mm.zones.length : 0; } catch (e) {}
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
    var b = get(B), m = get(M), c = counts(b, m);
    if (!c.n && !c.z) return false;
    var l = list();
    if (l.length && l[0].b === b && l[0].m === m) return false;
    l.unshift({ t: Date.now(), reason: reason || 'Automatic', b: b, m: m, n: c.n, z: c.z });
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

  function apply(b, m, rot) {
    snapshot('Before restore');
    try {
      localStorage.setItem(B, b || '[]');
      if (m) localStorage.setItem(M, m); else localStorage.removeItem(M);
      if (rot != null) localStorage.setItem(R, rot);
    } catch (e) { toast('Could not restore: this phone is out of space.'); return; }
    location.reload();
  }

  function hash() {
    var s = (get(B) || '') + '|' + (get(M) || ''), h = 5381, i;
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }
  function lastBackup() { try { return JSON.parse(get(LB) || 'null'); } catch (e) { return null; } }
  function markBackedUp() {
    var c = counts(get(B), get(M));
    try { localStorage.setItem(LB, JSON.stringify({ t: Date.now(), h: hash(), n: c.n, z: c.z })); } catch (e) {}
    status();
  }
  function stale() {
    var c = counts(get(B), get(M)), lb = lastBackup();
    if (!c.n) return false;
    if (!lb) return c.n >= 10;
    return lb.h !== hash() && Date.now() - lb.t > 2 * 24 * 3600 * 1000;
  }
  function status() {
    var el = $('#backupStatus'), lb = lastBackup(), c = counts(get(B), get(M));
    if (el) {
      if (!lb) el.textContent = 'No backup saved yet.';
      else el.textContent = 'Last backup: ' + when(lb.t) + ' (' + lb.n + ' bottles). ' + (lb.h === hash() ? 'Nothing has changed since.' : 'You have changes since then.');
    }
    var nd = $('#backupNudge');
    if (nd) {
      var show = stale();
      nd.hidden = !show;
      if (show) nd.textContent = lb ? 'Your changes are not backed up yet. Tap to save a backup.' : 'Your list is not backed up yet. Tap to save a backup.';
    }
  }
  function saveFile() {
    var b = get(B), m = get(M), c = counts(b, m);
    if (!c.n && !c.z) { toast('Nothing to back up yet.'); return; }
    var payload = { app: 'shelf-finder', version: 1, savedAt: new Date().toISOString(), bottles: JSON.parse(b || '[]'), map: m ? JSON.parse(m) : null, mapView: get(R) };
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    var name = 'shelf-finder-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    try {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Shelf Finder backup' }).then(function () { markBackedUp(); toast('Backup saved: ' + c.n + ' bottles, ' + c.z + ' sections'); }, function () {});
        return;
      }
    } catch (e) {}
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    markBackedUp();
    toast('Backup saved: ' + c.n + ' bottles, ' + c.z + ' sections');
  }

  function restoreFile(file) {
    var r = new FileReader();
    r.onload = function () {
      var o;
      try { o = JSON.parse(String(r.result || '')); } catch (e) { o = null; }
      if (!o || o.app !== 'shelf-finder' || !Array.isArray(o.bottles) || (o.map && !o.map.img)) { toast('That is not a Shelf Finder backup file.'); return; }
      var c = counts(JSON.stringify(o.bottles), o.map ? JSON.stringify(o.map) : null);
      if (!window.confirm('Replace what is on this phone with the backup (' + c.n + ' bottles, ' + c.z + ' sections)? Your current data is saved to the automatic backups first.')) return;
      apply(JSON.stringify(o.bottles), o.map ? JSON.stringify(o.map) : null, o.mapView);
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
    $('#saveBackupBtn').addEventListener('click', saveFile);
    var nudge = document.createElement('button');
    nudge.id = 'backupNudge'; nudge.className = 'nudge'; nudge.type = 'button'; nudge.hidden = true;
    nudge.addEventListener('click', saveFile);
    var hero = document.querySelector('#tab-find .hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(nudge, hero.nextSibling);
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
      apply(s.b, s.m, null);
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

  root.ShelfBackup = { snapshot: snapshot };
  init();
})(window);
