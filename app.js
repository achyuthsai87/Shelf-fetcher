(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var LS = 'shelf-finder-bottles-v1';
  var DEFAULT_TYPES = ['Vodka', 'Whiskey', 'Bourbon', 'Rum', 'Tequila', 'Gin', 'Brandy', 'Liqueur', 'Wine', 'Beer', 'Seltzer'];

  var items = [];
  var q = '';
  var tokens = [];
  var re = null;
  var typeF = '';
  var limit = 60;
  var tab = 'find';
  var editing = null;
  var carry = { type: '', size: '', section: '', shelf: '' };
  var openSecs = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s == null ? '' : s).trim(); }
  function newId() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function mk(o) {
    var it = {
      id: o.id, brand: norm(o.brand), flavor: norm(o.flavor), type: norm(o.type), size: norm(o.size),
      section: norm(o.section), shelf: norm(o.shelf), notes: norm(o.notes), updatedAt: o.updatedAt || 0
    };
    it._h = [it.brand, it.flavor, it.type, it.size, it.section, it.shelf, it.notes].join(' ').toLowerCase();
    return it;
  }
  function loadLocal() {
    try { return (JSON.parse(localStorage.getItem(LS) || '[]') || []).map(mk); } catch (e) { return []; }
  }
  function saveLocal() {
    try {
      localStorage.setItem(LS, JSON.stringify(items.map(function (i) {
        return { id: i.id, brand: i.brand, flavor: i.flavor, type: i.type, size: i.size, section: i.section, shelf: i.shelf, notes: i.notes, updatedAt: i.updatedAt };
      })));
      return true;
    } catch (e) { return false; }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function cmp(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }

  /* Data changes */
  function save(it) {
    it.updatedAt = Date.now();
    var i = items.findIndex(function (x) { return x.id === it.id; });
    var prev = items.slice();
    if (i < 0) items.push(it); else items[i] = it;
    if (!saveLocal()) { items = prev; throw new Error('storage'); }
    renderAll();
  }
  function removeItem(id) {
    var prev = items.slice();
    items = items.filter(function (x) { return x.id !== id; });
    if (!saveLocal()) { items = prev; throw new Error('storage'); }
    renderAll();
  }

  /* Rendering */
  function setQuery(v) {
    q = v;
    tokens = v.toLowerCase().split(/\s+/).filter(Boolean);
    re = tokens.length ? new RegExp('(' + tokens.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi') : null;
    limit = 60;
  }
  function hl(text) {
    text = String(text == null ? '' : text);
    if (!re) return esc(text);
    var out = '', last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (!m[0]) break;
      out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  function filtered() {
    return items.filter(function (it) {
      if (typeF && it.type.toLowerCase() !== typeF) return false;
      for (var i = 0; i < tokens.length; i++) if (it._h.indexOf(tokens[i]) < 0) return false;
      return true;
    }).sort(function (a, b) { return cmp(a.brand, b.brand) || cmp(a.flavor, b.flavor); });
  }

  function renderHero() {
    var secs = {};
    items.forEach(function (i) { if (i.section) secs[i.section.toLowerCase()] = 1; });
    var n = Object.keys(secs).length;
    $('#heroNum').textContent = items.length;
    $('#heroSub').textContent = items.length
      ? (n ? 'across ' + n + (n === 1 ? ' aisle or section' : ' aisles and sections') : 'No aisles entered yet')
      : 'Add your first bottle to get started';
  }

  function renderChips() {
    var counts = {}, labels = {};
    items.forEach(function (i) {
      var k = i.type.toLowerCase();
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
      if (!labels[k]) labels[k] = i.type;
    });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (typeF && !counts[typeF]) typeF = '';
    var h = '';
    if (keys.length) {
      h += '<button class="chip" type="button" data-type="" aria-pressed="' + (!typeF) + '">All <span>' + items.length + '</span></button>';
      keys.forEach(function (k) {
        h += '<button class="chip" type="button" data-type="' + esc(k) + '" aria-pressed="' + (typeF === k) + '">' + esc(labels[k]) + ' <span>' + counts[k] + '</span></button>';
      });
    }
    $('#chips').innerHTML = h;
    $('#chips').hidden = !keys.length;

    var tl = {};
    DEFAULT_TYPES.forEach(function (t) { tl[t.toLowerCase()] = t; });
    Object.keys(labels).forEach(function (k) { tl[k] = labels[k]; });
    $('#dl-types').innerHTML = Object.keys(tl).map(function (k) { return '<option value="' + esc(tl[k]) + '">'; }).join('');
    var secs = {};
    items.forEach(function (i) { if (i.section) secs[i.section.toLowerCase()] = i.section; });
    $('#dl-sections').innerHTML = Object.keys(secs).sort(cmp).map(function (k) { return '<option value="' + esc(secs[k]) + '">'; }).join('');
  }

  function renderList() {
    var list = $('#list'), empty = $('#emptyHost'), more = $('#moreBtn');
    var res = filtered();
    empty.innerHTML = '';
    more.hidden = true;
    if (!items.length) {
      list.innerHTML = '';
      empty.innerHTML = '<div class="glass empty"><h2>No bottles yet</h2><p>Walk the shelves and add each bottle as you pass it. Type, size, aisle and shelf stay filled in, so the next one takes a few seconds. Have a spreadsheet already? Paste it in.</p><div class="btns"><button class="btn" type="button" data-open="add">Add first bottle</button><button class="btn ghost" type="button" data-open="import">Import a list</button></div></div>';
      return;
    }
    if (!res.length) {
      list.innerHTML = '';
      empty.innerHTML = '<div class="glass empty"><h2>No match</h2><p>' + (q ? 'Nothing found for “' + esc(q) + '”.' : 'Nothing in this type yet.') + ' Try fewer words or check the spelling.</p>' +
        (q ? '<div class="btns"><button class="btn" type="button" data-open="addq">Add “' + esc(q) + '” as a new bottle</button></div>' : '') + '</div>';
      return;
    }
    var shown = res.slice(0, limit);
    list.innerHTML = shown.map(function (it) {
      var meta = [it.type, it.size].filter(Boolean).join(' · ');
      var loc = it.section || it.shelf
        ? '<div class="loc"><span class="sec">' + (it.section ? hl(it.section) : 'Shelf') + '</span>' + (it.shelf ? '<span class="shelf">' + (it.section ? 'Shelf ' : '') + hl(it.shelf) + '</span>' : '') + '</div>'
        : '<div class="loc none"><span class="sec">No spot yet</span></div>';
      return '<li class="glass item" data-id="' + esc(it.id) + '"><div class="row"><div class="info">' +
        '<h3 class="brand">' + hl(it.brand) + '</h3>' +
        (it.flavor ? '<p class="flavor">' + hl(it.flavor) + '</p>' : '') +
        (meta ? '<p class="meta">' + hl(meta) + '</p>' : '') +
        (it.notes ? '<p class="notes">' + hl(it.notes) + '</p>' : '') +
        '</div>' + loc + '</div>' +
        '<div class="actions">' + (window.ShelfMap && window.ShelfMap.has() ? '<button class="link" type="button" data-act="map">Show on map</button>' : '') + '<button class="link" type="button" data-act="edit">Edit</button><button class="link danger" type="button" data-act="del">Delete</button></div>' +
        '</li>';
    }).join('');
    if (res.length > shown.length) {
      more.hidden = false;
      more.textContent = 'Show more (' + (res.length - shown.length) + ' left)';
    }
  }

  function renderBrowse() {
    var host = $('#browseHost');
    if (!items.length) {
      host.innerHTML = '<div class="glass empty"><h2>Nothing to browse yet</h2><p>Once bottles have an aisle or section, they are grouped here so you can see everything on one shelf.</p><div class="btns"><button class="btn" type="button" data-open="add">Add first bottle</button></div></div>';
      return;
    }
    var groups = {}, names = {};
    items.forEach(function (i) {
      var k = i.section.toLowerCase();
      if (!groups[k]) { groups[k] = []; names[k] = i.section; }
      groups[k].push(i);
    });
    var keys = Object.keys(groups).sort(function (a, b) {
      if (!a) return 1;
      if (!b) return -1;
      return cmp(a, b);
    });
    host.innerHTML = keys.map(function (k) {
      var rows = groups[k].sort(function (a, b) { return cmp(a.shelf, b.shelf) || cmp(a.brand, b.brand) || cmp(a.flavor, b.flavor); });
      var name = names[k] || 'No spot yet';
      return '<details class="glass sec-card" data-sec="' + esc(k) + '"' + (openSecs[k] ? ' open' : '') + '><summary><span>' + esc(name) + '</span><span class="cnt">' + rows.length + '</span></summary><ul class="srows">' +
        rows.map(function (i) {
          return '<li data-id="' + esc(i.id) + '"><span class="sshelf">' + esc(i.shelf || '—') + '</span><span class="sbody"><b>' + esc(i.brand) + '</b>' +
            (i.flavor ? ' ' + esc(i.flavor) : '') + (i.size ? ' <small>' + esc(i.size) + '</small>' : '') + '</span><button class="link" type="button" data-act="edit">Edit</button></li>';
        }).join('') + '</ul></details>';
    }).join('');
  }

  function renderAll() {
    renderHero();
    renderChips();
    renderList();
    if (tab === 'browse') renderBrowse();
  }

  function showTab(name) {
    tab = name;
    ['find', 'browse', 'map', 'more'].forEach(function (t) { $('#tab-' + t).classList.toggle('on', t === name); });
    document.querySelectorAll('.tabbar [data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    if (name === 'browse') renderBrowse();
    if (name === 'map' && window.ShelfMap) window.ShelfMap.onShow();
    window.scrollTo(0, 0);
  }

  /* Add / edit sheet */
  var F = {};
  ['brand', 'flavor', 'type', 'size', 'section', 'shelf', 'notes'].forEach(function (k) { F[k] = $('#f-' + k); });
  function openSheet(it, pre) {
    editing = it ? it.id : null;
    var v = it || pre || {};
    $('#sheetTitle').textContent = it ? 'Edit bottle' : 'Add bottle';
    Object.keys(F).forEach(function (k) { F[k].value = v[k] || ''; });
    $('#formErr').hidden = true;
    $('#saveNextBtn').hidden = !!it;
    $('#sheetScrim').hidden = false;
    setTimeout(function () { F.brand.focus(); }, 30);
  }
  function closeSheet() { $('#sheetScrim').hidden = true; editing = null; }

  function submit(another) {
    var brand = norm(F.brand.value);
    var err = $('#formErr');
    if (!brand) { err.textContent = 'Enter the brand name so this bottle can be found.'; err.hidden = false; F.brand.focus(); return; }
    var it = mk({
      id: editing || newId(), brand: brand, flavor: F.flavor.value, type: F.type.value, size: F.size.value,
      section: F.section.value, shelf: F.shelf.value, notes: F.notes.value
    });
    try {
      save(it);
    } catch (e) {
      err.textContent = 'This phone has no room left to save. Export a CSV, then free up browser storage.';
      err.hidden = false;
      return;
    }
    carry = { type: it.type, size: it.size, section: it.section, shelf: it.shelf };
    toast('Saved ' + it.brand);
    if (another && !editing) openSheet(null, carry); else closeSheet();
  }

  /* Import / export */
  function parseLine(line, d) {
    var out = [], cur = '', inq = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inq) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c;
      } else if (c === '"' && cur === '') inq = true;
      else if (c === d) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }
  function dupKey(o) { return [o.brand, o.flavor, o.size].map(function (s) { return norm(s).toLowerCase(); }).join('|'); }
  function runImport() {
    var msg = $('#importMsg');
    var lines = $('#importText').value.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) { msg.textContent = 'Choose a file or paste at least one line first.'; msg.hidden = false; return; }
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var ALIASES = { brand: ['brand', 'name', 'item', 'item name', 'description', 'product', 'product name', 'title'], flavor: ['flavor', 'flavour', 'variant'], type: ['type', 'category', 'class', 'dept', 'department', 'kind'], size: ['size', 'volume', 'unit size', 'pack', 'pack size'], section: ['aisle', 'section', 'location', 'zone', 'area'], shelf: ['shelf', 'level', 'row', 'step'] };
    var cols = { brand: 0, flavor: 1, type: 2, size: 3, section: 4, shelf: 5 }, hasHeader = false;
    var h0 = parseLine(lines[0], delim).map(function (s) { return s.toLowerCase().replace(/[^a-z ]/g, '').trim(); });
    var map2 = {}, hits = 0;
    Object.keys(ALIASES).forEach(function (f) { var ix = -1; ALIASES[f].forEach(function (al) { if (ix < 0) ix = h0.indexOf(al); }); if (ix >= 0) { map2[f] = ix; hits++; } });
    if (hits >= 2 || (hits >= 1 && map2.brand !== undefined)) { hasHeader = true; cols = { brand: -1, flavor: -1, type: -1, size: -1, section: -1, shelf: -1 }; Object.keys(map2).forEach(function (f) { cols[f] = map2[f]; }); }
    var byKey = {};
    items.forEach(function (i) { byKey[dupKey(i)] = i; });
    var added = 0, updated = 0, same = 0, fresh = [];
    lines.forEach(function (l, idx) {
      if (idx === 0 && hasHeader) return;
      var c = parseLine(l, delim);
      var g = function (f) { return cols[f] >= 0 && cols[f] < c.length ? c[cols[f]] : ''; };
      if (!g('brand')) return;
      var it = mk({ id: newId(), brand: g('brand'), flavor: g('flavor'), type: g('type'), size: g('size'), section: g('section'), shelf: g('shelf'), updatedAt: Date.now() });
      var k = dupKey(it), old = byKey[k];
      if (old) {
        var ch = false;
        ['type', 'section', 'shelf'].forEach(function (f) { if (it[f] && it[f] !== old[f]) { old[f] = it[f]; ch = true; } });
        if (ch) { old.updatedAt = Date.now(); updated++; } else same++;
        return;
      }
      byKey[k] = it;
      fresh.push(it);
      added++;
    });
    var skipped = same;
    var prev = items.slice();
    items = items.concat(fresh);
    if (!saveLocal()) {
      items = prev;
      msg.textContent = 'This phone has no room left to save the list.';
      msg.hidden = false;
      return;
    }
    renderAll();
    msg.textContent = 'Added ' + added + (updated ? ', updated location on ' + updated : '') + (skipped ? ', ' + skipped + ' already up to date' : '') + '.';
    msg.hidden = false;
    if (added || updated) { $('#importText').value = ''; $('#importFile').value = ''; }
  }
  function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    if (!items.length) { toast('Nothing to export yet.'); return; }
    var rows = [['Brand', 'Flavor', 'Type', 'Size', 'Section', 'Shelf', 'Notes']].concat(
      items.slice().sort(function (a, b) { return cmp(a.brand, b.brand); }).map(function (i) { return [i.brand, i.flavor, i.type, i.size, i.section, i.shelf, i.notes]; })
    );
    var text = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
    var blob = new Blob([text], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'shelf-finder-bottles.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Export ready');
  }

  function openImport() {
    $('#importMsg').hidden = true;
    $('#importScrim').hidden = false;
  }

  /* Events */
  $('#search').addEventListener('input', function (e) { setQuery(e.target.value); renderList(); });
  $('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-type]');
    if (!b) return;
    typeF = b.getAttribute('data-type');
    limit = 60;
    renderChips();
    renderList();
  });
  $('#moreBtn').addEventListener('click', function () { limit += 60; renderList(); });
  document.querySelectorAll('.tabbar [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });
  $('#addBtn').addEventListener('click', function () { openSheet(null, carry); });
  function openFromEmpty(e) {
    var b = e.target.closest('[data-open]');
    if (!b) return;
    var w = b.getAttribute('data-open');
    if (w === 'add') openSheet(null, carry);
    else if (w === 'addq') openSheet(null, Object.assign({}, carry, { brand: q }));
    else if (w === 'import') openImport();
  }
  $('#emptyHost').addEventListener('click', openFromEmpty);
  $('#browseHost').addEventListener('click', function (e) {
    openFromEmpty(e);
    var b = e.target.closest('[data-act="edit"]');
    if (!b) return;
    var it = items.find(function (x) { return x.id === b.closest('li').getAttribute('data-id'); });
    if (it) openSheet(it);
  });
  $('#browseHost').addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.getAttribute) openSecs[d.getAttribute('data-sec')] = d.open;
  }, true);
  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var id = b.closest('.item').getAttribute('data-id');
    var it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    if (b.getAttribute('data-act') === 'edit') { openSheet(it); return; }
    if (b.getAttribute('data-act') === 'map') { window.ShelfMap.show(it); return; }
    if (b.getAttribute('data-armed') !== '1') {
      b.setAttribute('data-armed', '1');
      b.textContent = 'Tap again to delete';
      setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-armed'); b.textContent = 'Delete'; } }, 3000);
      return;
    }
    try { removeItem(id); toast('Deleted ' + it.brand); } catch (err) { toast('Could not delete. Try again.'); }
  });
  $('#sheet').addEventListener('submit', function (e) { e.preventDefault(); submit(false); });
  $('#saveNextBtn').addEventListener('click', function () { submit(true); });
  $('#cancelBtn').addEventListener('click', closeSheet);
  $('#sheetScrim').addEventListener('mousedown', function (e) { if (e.target === this) closeSheet(); });
  $('#importBtn').addEventListener('click', openImport);
  $('#importFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { $('#importText').value = String(r.result || ''); };
    r.readAsText(f);
  });
  $('#importSheet').addEventListener('submit', function (e) { e.preventDefault(); runImport(); });
  $('#importCancel').addEventListener('click', function () { $('#importScrim').hidden = true; });
  $('#importScrim').addEventListener('mousedown', function (e) { if (e.target === this) this.hidden = true; });
  $('#exportBtn').addEventListener('click', exportCsv);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $('#sheetScrim').hidden = true; $('#importScrim').hidden = true; }
  });

  window.ShelfApp = {
    items: function () { return items; },
    showTab: showTab,
    refresh: function () { renderAll(); },
    openAdd: function (pre) { openSheet(null, Object.assign({}, carry, pre || {})); }
  };

  /* Start */
  items = loadLocal();
  renderAll();
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function (ok) {
        var n = $('#storageNote');
        n.textContent = ok ? 'This phone has agreed to keep the list safe from automatic clean-up.' : 'The browser may clear this list if the phone runs low on space. Export a copy now and then.';
        n.hidden = false;
      });
    }
  } catch (e) {}
  if ('serviceWorker' in navigator) {
    var hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadCtl && !reloaded) { reloaded = true; location.reload(); } });
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (r) { r.update(); }).catch(function () {}); });
  }
})();
