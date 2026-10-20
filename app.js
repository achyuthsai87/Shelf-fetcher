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
      id: o.id, brand: norm(o.brand), flavor: norm(o.flavor), type: norm(o.type), size: norm(o.size), price: norm(o.price), qty: norm(o.qty), code: norm(o.code),
      section: norm(o.section), shelf: norm(o.shelf), notes: norm(o.notes), updatedAt: o.updatedAt || 0,
      places: (Array.isArray(o.places) ? o.places : []).map(function (p) { return { m: norm(p && p.m), section: norm(p && p.section), shelf: norm(p && p.shelf) }; }).filter(function (p) { return p.m && (p.section || p.shelf); })
    };
    return window.ShelfSearch.prepare(it);
  }
  function loadLocal() {
    try { return (JSON.parse(localStorage.getItem(LS) || '[]') || []).map(mk); } catch (e) { return []; }
  }
  function rawOf(i) {
    return { id: i.id, brand: i.brand, flavor: i.flavor, type: i.type, size: i.size, price: i.price, qty: i.qty, code: i.code, section: i.section, shelf: i.shelf, notes: i.notes, updatedAt: i.updatedAt, places: i.places && i.places.length ? i.places : undefined };
  }
  var TRASH = 'shelf-finder-trash-v1';
  function trashList() { try { return JSON.parse(localStorage.getItem(TRASH) || '[]') || []; } catch (e) { return []; } }
  function trashSet(l) { try { localStorage.setItem(TRASH, JSON.stringify(l.slice(0, 30))); } catch (e) {} }
  function saveLocal() {
    try {
      localStorage.setItem(LS, JSON.stringify(items.map(function (i) {
        return { id: i.id, brand: i.brand, flavor: i.flavor, type: i.type, size: i.size, price: i.price, qty: i.qty, code: i.code, section: i.section, shelf: i.shelf, notes: i.notes, updatedAt: i.updatedAt, places: i.places && i.places.length ? i.places : undefined };
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
    tokens = window.ShelfSearch.tokens(v);
    limit = 60;
  }
  function hl(text) { return window.ShelfSearch.highlight(text, tokens, esc); }
  var noSpot = false, stockF = '';
  var LOWKEY = 'shelf-finder-low-v1';
  function lowAt() { try { var v = parseInt(localStorage.getItem(LOWKEY), 10); return v >= 0 ? v : 2; } catch (e) { return 2; } }
  function qtyNum(it) { return /^-?\d+$/.test(String(it.qty || '').trim()) ? parseInt(it.qty, 10) : null; }
  function stockState(it) { var n = qtyNum(it); if (n === null) return ''; return n <= 0 ? 'out' : (n <= lowAt() ? 'low' : 'ok'); }
  function hasOtherPlace(it) { return (it.places || []).some(function (p) { return p.section || p.shelf; }); }
  function coldSet() { var a = window.ShelfMap && window.ShelfMap.coldNames ? window.ShelfMap.coldNames() : [], o = {}; a.forEach(function (n) { o[n] = 1; }); return o; }
  var coldCache = {};
  function isCold(it) { return !!(it.section && coldCache[it.section.toLowerCase()]); }
  function needsRestock(it) { var st = stockState(it); return hasOtherPlace(it) && (!it.section || st === 'out' || st === 'low'); }
  function filtered() {
    var pool = items.filter(function (it) {
      if (typeF && it.type.toLowerCase() !== typeF) return false;
      if (noSpot && (it.section || it.shelf || it.places.length)) return false;
      if (stockF === 'low' && !(stockState(it) === 'out' || stockState(it) === 'low')) return false;
      if (stockF === 'restock' && !needsRestock(it)) return false;
      if (stockF === 'cold' && !isCold(it)) return false;
      return true;
    });
    if (tokens.length) return window.ShelfSearch.run(pool, q).map(function (r) { return r.it; });
    return pool.sort(function (a, b) { return cmp(a.brand, b.brand) || cmp(a.flavor, b.flavor); });
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
    if (stockF === 'low' && !items.some(function (i) { var st = stockState(i); return st === 'out' || st === 'low'; })) stockF = '';
    coldCache = coldSet();
    if (stockF === 'restock' && !items.some(needsRestock)) stockF = '';
    if (stockF === 'cold' && !items.some(isCold)) stockF = '';
    var h = '';
    if (keys.length) {
      var ns = items.filter(function (i) { return !i.section && !i.shelf && !i.places.length; }).length;
      h += '<button class="chip" type="button" data-type="" aria-pressed="' + (!typeF && !noSpot && !stockF) + '">All <span>' + items.length + '</span></button>';
      if (ns) h += '<button class="chip" type="button" data-nospot="1" aria-pressed="' + noSpot + '">No spot yet <span>' + ns + '</span></button>';
      var nl = items.filter(function (i) { var st = stockState(i); return st === 'out' || st === 'low'; }).length, nr = items.filter(needsRestock).length;
      if (nl) h += '<button class="chip" type="button" data-stock="low" aria-pressed="' + (stockF === 'low') + '">Low or out <span>' + nl + '</span></button>';
      if (nr) h += '<button class="chip" type="button" data-stock="restock" aria-pressed="' + (stockF === 'restock') + '">Restock <span>' + nr + '</span></button>';
      var nc = items.filter(isCold).length;
      if (nc) h += '<button class="chip" type="button" data-stock="cold" aria-pressed="' + (stockF === 'cold') + '">Cold <span>' + nc + '</span></button>';
      keys.forEach(function (k) {
        h += '<button class="chip" type="button" data-type="' + esc(k) + '" aria-pressed="' + (typeF === k && !noSpot && !stockF) + '">' + esc(labels[k]) + ' <span>' + counts[k] + '</span></button>';
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
    if (window.ShelfMap && window.ShelfMap.zoneNames) window.ShelfMap.zoneNames().forEach(function (n) { secs[n.toLowerCase()] = n; });
    $('#dl-sections').innerHTML = Object.keys(secs).sort(cmp).map(function (k) { return '<option value="' + esc(secs[k]) + '">'; }).join('');
  }

  function fmtPrice(p) {
    var t = String(p || '').replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t) || !parseFloat(t)) return '';
    return '$' + parseFloat(t).toFixed(2);
  }
  function qtyBadge(it) {
    var st = stockState(it), n = qtyNum(it);
    if (!st) return '';
    return '<span class="qty ' + st + '">' + (st === 'out' ? 'Out' : st === 'low' ? 'Low · ' + n : 'Qty ' + n) + '</span>';
  }
  function mapLabel(id) {
    var ms = window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : [];
    for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i].name;
    return '';
  }
  function renderPlaces(it) {
    var host = $('#placesHost'), ms = (window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : []).filter(function (m) { return m.id !== 'main'; });
    if (!ms.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = '<span class="hint">Also kept on other maps (leave blank if not there)</span>' + ms.map(function (m) {
      var p = ((it && it.places) || []).filter(function (x) { return x.m === m.id; })[0] || {};
      var names = window.ShelfMap.zoneNames ? window.ShelfMap.zoneNames(m.id) : [];
      return '<div class="placerow" data-pm="' + esc(m.id) + '"><b>' + esc(m.name) + '</b>' +
        '<input data-ps list="dl-pm-' + esc(m.id) + '" placeholder="Section" value="' + esc(p.section || '') + '" autocapitalize="characters">' +
        '<datalist id="dl-pm-' + esc(m.id) + '">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
        '<input data-pf inputmode="numeric" placeholder="Shelf (0 = on top)" value="' + esc(p.shelf || '') + '"></div>';
    }).join('');
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
      var dym = q && !typeF && !noSpot ? window.ShelfSearch.didYouMean(items, q) : '';
      empty.innerHTML = '<div class="glass empty"><h2>No match</h2><p>' + (q ? 'Nothing found for “' + esc(q) + '”.' : 'Nothing in this type yet.') + ' Every word has to start a word in the bottle’s name, type or description.</p>' +
        (dym ? '<div class="btns"><button class="btn" type="button" data-open="dym" data-q="' + esc(dym) + '">Did you mean “' + esc(dym) + '”?</button></div>' : '') +
        (q ? '<div class="btns"><button class="btn ghost" type="button" data-open="addq">Add “' + esc(q) + '” as a new bottle</button></div>' : '') + '</div>';
      return;
    }
    var shown = res.slice(0, limit);
    list.innerHTML = shown.map(function (it) {
      var meta = [it.type, it.size].filter(Boolean).join(' · ');
      var xp = (it.places || []).map(function (p) {
        var nm = mapLabel(p.m);
        if (!nm) return '';
        return '<button class="pill" type="button" data-pm="' + esc(p.m) + '">' + esc(nm) + ' · ' + hl(p.section || '') + (p.shelf ? (p.section ? ' · ' : '') + (p.shelf === '0' ? 'on top' : 'shelf ' + hl(p.shelf)) : '') + '</button>';
      }).join('');
      var loc = it.section || it.shelf
        ? '<div class="loc"><span class="sec">' + (it.section ? hl(it.section) : 'Shelf') + '</span>' + (it.shelf ? '<span class="shelf">' + (it.shelf === '0' && it.section ? 'On top' : (it.section ? 'Shelf ' : '') + hl(it.shelf)) + '</span>' : '') + '</div>'
        : '<div class="loc none"><span class="sec">' + (xp ? 'Not on floor' : 'No spot yet') + '</span></div>';
      return '<li class="glass item" data-id="' + esc(it.id) + '"><div class="row"><div class="info">' +
        '<h3 class="brand">' + hl(it.brand) + '</h3>' +
        (it.flavor ? '<p class="flavor">' + hl(it.flavor) + '</p>' : '') +
        (meta ? '<p class="meta">' + hl(meta) + '</p>' : '') +
        (it.notes ? '<p class="notes">' + hl(it.notes) + '</p>' : '') +
        (xp ? '<div class="places">' + xp + '</div>' : '') +
        '</div>' + loc + '</div>' +
        '<div class="actions"><span class="lft">' + (fmtPrice(it.price) ? '<span class="price">' + esc(fmtPrice(it.price)) + '</span>' : '') + qtyBadge(it) + '</span>' + (needsRestock(it) ? '<button class="link" type="button" data-act="restock">Restocked</button>' : '') + '<button class="link" type="button" data-act="edit">Edit</button><button class="link danger" type="button" data-act="del">Delete</button></div>' +
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
        }).join('') + '</ul><div class="secfoot"><button class="link" type="button" data-print="' + esc(k) + '">Print this list</button></div></details>';
    }).join('');
  }

  function renderTrash() {
    var host = $('#trashList'); if (!host) return;
    var l = trashList();
    host.innerHTML = l.length ? l.map(function (e, i) {
      var d = new Date(e.t), when = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return '<div class="bkrow"><span><b>' + esc(e.it.brand + (e.it.flavor ? ' ' + e.it.flavor : '')) + '</b><small>Deleted ' + esc(when) + '</small></span><button class="link" type="button" data-untrash="' + i + '">Restore</button></div>';
    }).join('') : '<p class="hint">Bottles you delete wait here, so a slip is easy to undo. The last 30 are kept.</p>';
  }
  function untrash(i) {
    var l = trashList(), e = l[i];
    if (!e) return;
    l.splice(i, 1); trashSet(l);
    var it = mk(e.it);
    if (!items.some(function (x) { return x.id === it.id; })) { try { save(it); } catch (err) { toast('Could not restore. This phone is out of space.'); return; } }
    renderTrash();
    toast('Restored ' + it.brand);
  }
  function toastAct(msg, label, fn) {
    var t = $('#toast');
    t.innerHTML = esc(msg) + ' <button type="button" class="tbtn">' + esc(label) + '</button>';
    t.hidden = false;
    t.querySelector('.tbtn').addEventListener('click', function () { clearTimeout(toastTimer); t.hidden = true; fn(); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 7000);
  }
  function renderAll() {
    renderTrash();
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
  ['brand', 'flavor', 'type', 'size', 'price', 'qty', 'code', 'section', 'shelf', 'notes'].forEach(function (k) { F[k] = $('#f-' + k); });
  function openSheet(it, pre) {
    editing = it ? it.id : null;
    var v = it || pre || {};
    $('#sheetTitle').textContent = it ? 'Edit bottle' : 'Add bottle';
    Object.keys(F).forEach(function (k) { F[k].value = v[k] || ''; });
    $('#formErr').hidden = true;
    $('#saveNextBtn').hidden = !!it;
    $('#sheetScrim').hidden = false;
    syncShelfPick();
    renderPlaces(it);
    if (!it) setTimeout(function () { F.brand.focus(); }, 30);
    else if (!it.section) setTimeout(function () { F.section.focus(); }, 30);
  }
  function syncShelfPick() {
    var host = $('#shelfPick'), info = window.ShelfMap && window.ShelfMap.zoneInfo ? window.ShelfMap.zoneInfo(F.section.value) : null;
    if (!info || info.shelves < 2) { host.innerHTML = ''; host.hidden = true; return; }
    var cur = String(F.shelf.value || '').trim(), h = '';
    for (var i = 0; i <= info.shelves; i++) h += '<button class="chip" type="button" data-shelf="' + i + '" aria-pressed="' + (cur === String(i)) + '">' + i + '</button>';
    host.innerHTML = '<span class="hint">Shelf (0 = on top of the box, 1 = the ' + (info.topFirst ? 'top' : 'bottom') + ' shelf)</span><div class="chips">' + h + '</div>';
    host.hidden = false;
  }
  function closeSheet() { $('#sheetScrim').hidden = true; editing = null; }

  function submit(another) {
    var brand = norm(F.brand.value);
    var err = $('#formErr');
    if (!brand) { err.textContent = 'Enter the brand name so this bottle can be found.'; err.hidden = false; F.brand.focus(); return; }
    var it = mk({
      id: editing || newId(), brand: brand, flavor: F.flavor.value, type: F.type.value, size: F.size.value, price: F.price.value, qty: F.qty.value, code: F.code.value,
      section: F.section.value, shelf: F.shelf.value, notes: F.notes.value,
      places: Array.prototype.map.call(document.querySelectorAll('#placesHost .placerow'), function (r) {
        return { m: r.getAttribute('data-pm'), section: r.querySelector('[data-ps]').value, shelf: r.querySelector('[data-pf]').value };
      })
    });
    /* Places on maps that still exist but are not shown (none) are kept from the saved bottle. */
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
  /* Refresh mode: match a column to bottles already listed (by item code, brand or name) and update only price and quantity. */
  var refreshHeader = false;
  function importRows() {
    var lines = $('#importText').value.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    return lines.map(function (l) { return parseLine(l, delim); });
  }
  function fillMapper() {
    var box = $('#importMapBox'), on = $('#importUpdateOnly').checked;
    box.hidden = !on;
    if (!on) return;
    var rows = importRows();
    if (!rows.length) { box.innerHTML = '<p class="hint">Choose a file or paste your list first, then the columns show up here.</p>'; return; }
    var hdr = rows[0], low = hdr.map(function (x) { return x.toLowerCase().replace(/[^a-z ]/g, '').trim(); });
    var known = ['code', 'upc', 'barcode', 'sku', 'item code', 'item number', 'item no', 'item', 'name', 'description', 'brand', 'product', 'price', 'retail', 'retail price', 'qty', 'quantity', 'on hand', 'stock', 'qoh'];
    refreshHeader = low.some(function (x) { return known.indexOf(x) >= 0; });
    var labels = hdr.map(function (x, i) { return refreshHeader ? (x || 'Column ' + (i + 1)) : 'Column ' + (i + 1) + (x ? ' (' + x.slice(0, 14) + ')' : ''); });
    function guess(list) { for (var k = 0; k < list.length; k++) { var ix = low.indexOf(list[k]); if (ix >= 0) return ix; } return -1; }
    var gm = guess(['code', 'upc', 'barcode', 'sku', 'item code', 'item number', 'item no', 'item', 'plu', 'name', 'description', 'brand', 'product']);
    var gp = guess(['price', 'retail', 'retail price', 'unit price', 'sell price', 'selling price', 'srp']);
    var gq = guess(['qty', 'quantity', 'on hand', 'onhand', 'qoh', 'stock', 'in stock', 'count']);
    if (!refreshHeader) { gm = 0; }
    function sel(id, label, g, optional) {
      return '<div class="field full"><label for="' + id + '">' + label + '</label><select id="' + id + '">' + (optional ? '<option value="-1">Do not change</option>' : '') + labels.map(function (t, i) { return '<option value="' + i + '"' + (i === g ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>';
    }
    box.innerHTML = '<p class="hint">Say which column is which. A bottle is matched when this column equals its item code, brand or name.</p>' + sel('rmMatch', 'Match bottles by', gm, false) + sel('rmPrice', 'Price column', gp, true) + sel('rmQty', 'Quantity column', gq, true);
  }
  function normKey(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/^0+(?=\d)/, ''); }
  function runRefresh() {
    var msg = $('#importMsg'), rows = importRows();
    if (!rows.length) { msg.textContent = 'Choose a file or paste at least one line first.'; msg.hidden = false; return; }
    var mi = parseInt($('#rmMatch').value, 10), pi = parseInt($('#rmPrice').value, 10), qi = parseInt($('#rmQty').value, 10);
    if (pi < 0 && qi < 0) { msg.textContent = 'Pick a price column, a quantity column, or both.'; msg.hidden = false; return; }
    var idx = {};
    items.forEach(function (it) { [it.code, it.brand, it.flavor].forEach(function (v) { var k = normKey(v); if (!k) return; (idx[k] = idx[k] || []); if (idx[k].indexOf(it) < 0) idx[k].push(it); }); });
    if (window.ShelfBackup) window.ShelfBackup.snapshot('Before refreshing prices and quantities');
    var prev = items.map(function (i) { return rawOf(i); }), upd = 0, same = 0, miss = 0, start = refreshHeader ? 1 : 0;
    for (var r = start; r < rows.length; r++) {
      var row = rows[r], key = normKey(row[mi]);
      if (!key) continue;
      var hit = idx[key];
      if (!hit) { miss++; continue; }
      var np = pi >= 0 ? norm(row[pi]).replace(/^\$/, '') : '', nq = qi >= 0 ? norm(row[qi]).replace(/\.0+$/, '') : '';
      hit.forEach(function (it) {
        var ch = false;
        if (np && np !== it.price) { it.price = np; ch = true; }
        if (nq && nq !== it.qty) { it.qty = nq; ch = true; }
        if (ch) { it.updatedAt = Date.now(); upd++; } else same++;
      });
    }
    if (upd && !saveLocal()) { items = prev.map(mk); msg.textContent = 'This phone has no room left to save the list.'; msg.hidden = false; return; }
    renderAll();
    msg.textContent = 'Updated ' + upd + ' bottle' + (upd === 1 ? '' : 's') + (same ? ', ' + same + ' already up to date' : '') + (miss ? ', ' + miss + ' rows not found in your list' : '') + '.';
    msg.hidden = false;
  }
  function runImport() {
    if ($('#importUpdateOnly').checked) { runRefresh(); return; }
    var msg = $('#importMsg');
    var lines = $('#importText').value.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) { msg.textContent = 'Choose a file or paste at least one line first.'; msg.hidden = false; return; }
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var ALIASES = { brand: ['brand', 'name', 'item', 'item name', 'description', 'product', 'product name', 'title'], flavor: ['flavor', 'flavour', 'variant'], type: ['type', 'category', 'class', 'dept', 'department', 'kind'], size: ['size', 'volume', 'unit size', 'pack', 'pack size'], qty: ['qty', 'quantity', 'on hand', 'onhand', 'qoh', 'stock', 'in stock', 'count'], code: ['code', 'upc', 'barcode', 'sku', 'item code', 'item number', 'item no', 'plu', 'ean'], price: ['price', 'retail', 'retail price', 'unit price', 'sell price', 'selling price', 'srp', 'cost'], section: ['aisle', 'section', 'location', 'zone', 'area'], shelf: ['shelf', 'level', 'row', 'step'], notes: ['notes', 'note', 'keywords', 'tags', 'details'] };
    var cols = { brand: 0, flavor: 1, type: 2, size: 3, price: -1, qty: -1, code: -1, section: 4, shelf: 5, notes: -1 }, hasHeader = false;
    var h0 = parseLine(lines[0], delim).map(function (s) { return s.toLowerCase().replace(/[^a-z ]/g, '').trim(); });
    var map2 = {}, hits = 0;
    Object.keys(ALIASES).forEach(function (f) { var ix = -1; ALIASES[f].forEach(function (al) { if (ix < 0) ix = h0.indexOf(al); }); if (ix >= 0) { map2[f] = ix; hits++; } });
    if (hits >= 2 || (hits >= 1 && map2.brand !== undefined)) { hasHeader = true; cols = { brand: -1, flavor: -1, type: -1, size: -1, price: -1, qty: -1, code: -1, section: -1, shelf: -1, notes: -1 }; Object.keys(map2).forEach(function (f) { cols[f] = map2[f]; }); }
    var byKey = {};
    items.forEach(function (i) { byKey[dupKey(i)] = i; });
    var added = 0, updated = 0, same = 0, fresh = [];
    lines.forEach(function (l, idx) {
      if (idx === 0 && hasHeader) return;
      var c = parseLine(l, delim);
      var g = function (f) { return cols[f] >= 0 && cols[f] < c.length ? c[cols[f]] : ''; };
      if (!g('brand')) return;
      var it = mk({ id: newId(), brand: g('brand'), flavor: g('flavor'), type: g('type'), size: g('size'), price: g('price'), qty: g('qty'), code: g('code'), section: g('section'), shelf: g('shelf'), notes: g('notes'), updatedAt: Date.now() });
      var k = dupKey(it), old = byKey[k];
      if (old) {
        var ch = false;
        ['type', 'price', 'qty', 'code', 'section', 'shelf', 'notes'].forEach(function (f) { if (it[f] && it[f] !== old[f]) { old[f] = it[f]; ch = true; } });
        if (ch) { old.updatedAt = Date.now(); updated++; } else same++;
        return;
      }
      byKey[k] = it;
      fresh.push(it);
      added++;
    });
    var skipped = same;
    if (window.ShelfBackup && (fresh.length || updated)) window.ShelfBackup.snapshot('Before importing a list');
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
    var rows = [['Brand', 'Flavor', 'Type', 'Size', 'Price', 'Qty', 'Code', 'Section', 'Shelf', 'Notes']].concat(
      items.slice().sort(function (a, b) { return cmp(a.brand, b.brand); }).map(function (i) { return [i.brand, i.flavor, i.type, i.size, i.price, i.qty, i.code, i.section, i.shelf, i.notes]; })
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
    var b = e.target.closest('[data-type],[data-nospot],[data-stock]');
    if (!b) return;
    if (b.hasAttribute('data-stock')) { var sv = b.getAttribute('data-stock'); stockF = stockF === sv ? '' : sv; typeF = ''; noSpot = false; }
    else if (b.hasAttribute('data-nospot')) { noSpot = !noSpot; typeF = ''; stockF = ''; }
    else { typeF = b.getAttribute('data-type'); noSpot = false; stockF = ''; }
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
    else if (w === 'dym') { var s = b.getAttribute('data-q'); $('#search').value = s; setQuery(s); renderList(); }
  }
  $('#emptyHost').addEventListener('click', openFromEmpty);
  $('#browseHost').addEventListener('click', function (e) {
    openFromEmpty(e);
    var li = e.target.closest('li[data-id]');
    if (!li || e.target.closest('summary')) return;
    var it = items.find(function (x) { return x.id === li.getAttribute('data-id'); });
    if (it) openSheet(it);
  });
  $('#browseHost').addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.getAttribute) openSecs[d.getAttribute('data-sec')] = d.open;
  }, true);
  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    var card = e.target.closest('.item');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    if (!b) {
      var pl = e.target.closest('[data-pm]');
      if (pl && window.ShelfMap) { window.ShelfMap.show(it, pl.getAttribute('data-pm')); return; }
      var lb = e.target.closest('.loc');
      if (lb && !lb.classList.contains('none') && window.ShelfMap && window.ShelfMap.has('main')) window.ShelfMap.show(it, 'main');
      return;
    }
    if (b.getAttribute('data-act') === 'edit') { openSheet(it); return; }
    if (b.getAttribute('data-act') === 'restock') { openSheet(it); setTimeout(function () { F.qty.focus(); F.qty.select(); }, 60); return; }
    if (b.getAttribute('data-act') === 'map') { window.ShelfMap.show(it); return; }
    if (b.getAttribute('data-armed') !== '1') {
      b.setAttribute('data-armed', '1');
      b.textContent = 'Tap again to delete';
      setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-armed'); b.textContent = 'Delete'; } }, 3000);
      return;
    }
    try {
      var tl = trashList(); tl.unshift({ t: Date.now(), it: rawOf(it) }); trashSet(tl);
      removeItem(id);
      toastAct('Deleted ' + it.brand, 'Undo', function () { var j = trashList().findIndex(function (e) { return e.it.id === id; }); if (j >= 0) untrash(j); });
    } catch (err) { toast('Could not delete. Try again.'); }
  });
  F.section.addEventListener('input', syncShelfPick);
  F.shelf.addEventListener('input', syncShelfPick);
  $('#shelfPick').addEventListener('click', function (e) {
    var b = e.target.closest('[data-shelf]');
    if (!b) return;
    F.shelf.value = b.getAttribute('data-shelf');
    syncShelfPick();
  });
  $('#sheet').addEventListener('submit', function (e) { e.preventDefault(); submit(false); });
  $('#saveNextBtn').addEventListener('click', function () { submit(true); });
  $('#cancelBtn').addEventListener('click', closeSheet);
  $('#sheetScrim').addEventListener('mousedown', function (e) { if (e.target === this) closeSheet(); });
  /* Printable checklist of one section, shelf by shelf, for checking the real shelf against the list. */
  function openPrint(k) {
    var rows = items.filter(function (i) { return i.section.toLowerCase() === k; }).sort(function (a, b) { return cmp(a.shelf, b.shelf) || cmp(a.brand, b.brand) || cmp(a.flavor, b.flavor); });
    if (!rows.length) return;
    var name = rows[0].section || 'No spot yet', ov = document.createElement('div');
    ov.className = 'printov';
    var cur = null, body = '';
    rows.forEach(function (i) {
      var sh = i.shelf === '0' ? 'On top' : (i.shelf ? 'Shelf ' + i.shelf : 'No shelf');
      if (sh !== cur) { cur = sh; body += '<tr class="ph"><td colspan="4">' + esc(sh) + '</td></tr>'; }
      body += '<tr><td class="pc">☐</td><td>' + esc(i.brand) + (i.flavor ? ' ' + esc(i.flavor) : '') + (i.size ? ' <small>' + esc(i.size) + '</small>' : '') + '</td><td>' + esc(i.code || '') + '</td><td class="pq">' + esc(i.qty || '') + '</td></tr>';
    });
    ov.innerHTML = '<div class="noprint pbar"><button class="btn" type="button" data-pgo>Print</button><button class="btn ghost" type="button" data-pclose>Close</button></div>' +
      '<h2>' + esc(name) + '</h2><p class="hint">' + rows.length + ' bottles · ' + esc(new Date().toLocaleDateString()) + '</p>' +
      '<table><thead><tr><th></th><th>Bottle</th><th>Code</th><th>Qty</th></tr></thead><tbody>' + body + '</tbody></table>';
    ov.addEventListener('click', function (e) {
      if (e.target.closest('[data-pclose]')) ov.remove();
      else if (e.target.closest('[data-pgo]')) { try { window.print(); } catch (err) {} }
    });
    document.body.appendChild(ov);
  }
  $('#browseHost').addEventListener('click', function (e) { var b = e.target.closest('[data-print]'); if (b) { e.preventDefault(); openPrint(b.getAttribute('data-print')); } });
  /* Barcode scan: a known code shows that bottle; a new code is linked to a bottle once, then works every time. */
  var scanCode = '';
  function setSearch(v) { var el = $('#search'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  function afterScan(code) {
    var k = normKey(code), hit = items.filter(function (i) { return normKey(i.code) === k || normKey(i.brand) === k; });
    if (hit.length) { setSearch(code); toast(hit.length === 1 ? 'Found ' + hit[0].brand + (hit[0].flavor ? ' ' + hit[0].flavor : '') : hit.length + ' bottles with that code'); return; }
    scanCode = code;
    $('#linkMsg').textContent = 'The barcode ' + code + ' is not linked to a bottle yet. Search for the bottle once and tap it, and from then on scanning finds it.';
    $('#linkSearch').value = ''; $('#linkList').innerHTML = '';
    $('#linkScrim').hidden = false;
    setTimeout(function () { $('#linkSearch').focus(); }, 40);
  }
  function renderLink() {
    var qv = $('#linkSearch').value, host = $('#linkList');
    if (!window.ShelfSearch.tokens(qv).length) { host.innerHTML = ''; return; }
    var res = window.ShelfSearch.run(items, qv).slice(0, 8).map(function (r) { return r.it; });
    host.innerHTML = res.length ? res.map(function (it) {
      return '<button class="linkrow" type="button" data-link="' + esc(it.id) + '"><b>' + esc(it.brand) + '</b>' + (it.flavor ? ' ' + esc(it.flavor) : '') + (it.size ? ' <small>' + esc(it.size) + '</small>' : '') + (it.code ? ' <small>(has code ' + esc(it.code) + ')</small>' : '') + '</button>';
    }).join('') : '<p class="hint">Nothing matches. Try fewer words, or add it as a new bottle.</p>';
  }
  $('#scanBtn').addEventListener('click', function () { if (window.ShelfScan) window.ShelfScan.open(afterScan); });
  $('#scanFormBtn').addEventListener('click', function () { if (window.ShelfScan) window.ShelfScan.open(function (c) { F.code.value = c; }); });
  $('#linkSearch').addEventListener('input', renderLink);
  $('#linkClose').addEventListener('click', function () { $('#linkScrim').hidden = true; });
  $('#linkAdd').addEventListener('click', function () { $('#linkScrim').hidden = true; openSheet(null, Object.assign({}, carry, { code: scanCode })); });
  $('#linkList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-link]'); if (!b) return;
    var it = items.filter(function (x) { return x.id === b.getAttribute('data-link'); })[0]; if (!it) return;
    var raw = rawOf(it); raw.code = scanCode; var upd = mk(raw);
    try { save(upd); } catch (err) { toast('Could not save. This phone is out of space.'); return; }
    $('#linkScrim').hidden = true;
    setSearch(scanCode);
    toast('Linked to ' + upd.brand);
  });
  /* Stock a shelf: pick a spot, scan bottles one after another, and each one is moved to that spot. */
  var stockCtx = null;
  function placeAt(it, c) {
    var raw = rawOf(it);
    if (!c.m || c.m === 'main') { raw.section = c.section; raw.shelf = c.shelf; }
    else {
      raw.places = (raw.places || []).filter(function (p) { return p.m !== c.m; });
      raw.places.push({ m: c.m, section: c.section, shelf: c.shelf });
    }
    return mk(raw);
  }
  function whereAt(it, c) {
    if (!c.m || c.m === 'main') return { section: it.section || '', shelf: it.shelf || '' };
    var p = (it.places || []).filter(function (x) { return x.m === c.m; })[0];
    return p ? { section: p.section || '', shelf: p.shelf || '' } : { section: '', shelf: '' };
  }
  function openStock() {
    var ms = window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : [];
    $('#stMapField').hidden = ms.length < 2;
    $('#stMap').innerHTML = ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    $('#stockScrim').hidden = false;
    setTimeout(function () { $('#stSection').focus(); }, 40);
  }
  function stockSpotLabel(c) { return (c.mapName ? c.mapName + ' · ' : '') + c.section + (c.shelf !== '' ? ' · shelf ' + c.shelf : ''); }
  $('#stockBtn').addEventListener('click', openStock);
  $('#stockClose').addEventListener('click', function () { $('#stockScrim').hidden = true; });
  $('#stockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var section = norm($('#stSection').value), shelf = norm($('#stShelf').value);
    if (!section) { toast('Type the aisle or section first.'); return; }
    var m = $('#stMapField').hidden ? 'main' : ($('#stMap').value || 'main');
    var c = { m: m, section: section, shelf: shelf, mapName: $('#stMapField').hidden ? '' : mapLabel(m) };
    if (!window.ShelfScan) return;
    var unknown = [], placed = 0;
    $('#stockScrim').hidden = true;
    window.ShelfScan.open(function (code) {
      var k = normKey(code), hit = items.filter(function (i) { return normKey(i.code) === k || normKey(i.brand) === k; });
      if (!hit.length) { if (unknown.indexOf(code) < 0) unknown.push(code); return { text: code + ' is not in your list', cls: 'bad' }; }
      var it = hit[0], name = it.brand + (it.flavor ? ' ' + it.flavor : ''), w = whereAt(it, c);
      if (w.section.toLowerCase() === c.section.toLowerCase() && String(w.shelf) === String(c.shelf)) return { text: name + ' is already here' };
      var before = it, upd = placeAt(it, c);
      try { save(upd); } catch (err) { toast('Could not save. This phone is out of space.'); return { text: 'Could not save ' + name, cls: 'bad' }; }
      placed++;
      return { text: name + ' added', cls: 'ok', undo: function () { try { save(placeAt(before, { m: c.m, section: w.section, shelf: w.shelf })); placed--; } catch (err) {} } };
    }, {
      continuous: true, doneText: 'Done',
      head: '<b>' + esc(stockSpotLabel(c)) + '</b><span>Scan each bottle on this shelf</span>',
      onDone: function () {
        toast(placed + ' bottle' + (placed === 1 ? '' : 's') + ' put on ' + stockSpotLabel(c) + (unknown.length ? '. ' + unknown.length + ' not in your list: ' + unknown.slice(0, 3).join(', ') + (unknown.length > 3 ? '...' : '') : ''));
        $('#stShelf').value = '';
        openStock();
      }
    });
  });
  $('#importBtn').addEventListener('click', openImport);
  $('#importUpdateOnly').addEventListener('change', fillMapper);
  $('#importText').addEventListener('input', function () { if ($('#importUpdateOnly').checked) fillMapper(); });
  $('#trashList').addEventListener('click', function (e) { var b = e.target.closest('[data-untrash]'); if (b) untrash(parseInt(b.getAttribute('data-untrash'), 10)); });
  (function () {
    var li = $('#lowAt'); if (!li) return;
    li.value = lowAt();
    li.addEventListener('change', function () { var v = parseInt(li.value, 10); try { localStorage.setItem(LOWKEY, String(v >= 0 ? v : 2)); } catch (e) {} li.value = lowAt(); renderAll(); });
  })();
  $('#importFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { $('#importText').value = String(r.result || ''); fillMapper(); };
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
  /* One-time repair: an earlier import put the price in Aisle and the stock count in Shelf. */
  window.addEventListener('load', function () {
    var K = 'shelf-finder-pricefix-v1', n = 0;
    try { if (localStorage.getItem(K)) return; } catch (e) { return; }
    items.forEach(function (i) {
      if (!i.price && /^\d+\.\d{1,2}$/.test(i.section)) {
        i.price = i.section; i.section = '';
        if (/^-?\d+$/.test(i.shelf)) i.shelf = '';
        n++;
      }
    });
    if (n) {
      if (window.ShelfBackup && window.ShelfBackup.snapshot) window.ShelfBackup.snapshot('Before fixing prices');
      saveLocal();
      items = items.map(mk);
      renderAll();
    }
    try { localStorage.setItem(K, '1'); } catch (e) {}
  });
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
  var APP_VERSION = 'v59';
  $('#verNote').textContent = 'Version ' + APP_VERSION + '. Tap to fetch the newest version. Your bottles and map are kept.';
  var FILES = ['./', './index.html', './style.css', './search.js', './app.js', './photo.js', './scan.js', './map.js', './backup.js', './manifest.webmanifest', './sw.js'];
  /* Force a truly fresh copy: re-download every file past the browser's own cache, drop the service
     worker and its caches, then reload. (Just unregistering is not enough: the browser would still
     hand back its own saved copies of the scripts for up to ten minutes.) */
  function hardUpdate(btn) {
    if (btn) { btn.textContent = 'Updating...'; btn.disabled = true; }
    var fetches = Promise.all(FILES.map(function (f) { return fetch(f, { cache: 'reload' }).catch(function () {}); }));
    var regs = 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }) : Promise.resolve();
    var cs = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
    Promise.all([fetches, regs, cs]).catch(function () {}).then(function () { location.replace(location.pathname + '?u=' + Date.now()); });
  }
  function askThenUpdate(btn, bar) {
    var go = function () { if (bar) bar.textContent = 'Updating...'; hardUpdate(btn); };
    if (window.ShelfBackup && window.ShelfBackup.confirmUpdate) window.ShelfBackup.confirmUpdate(go); else go();
  }
  $('#updateBtn').addEventListener('click', function () { askThenUpdate(this, null); });
  $('#updateBar').addEventListener('click', function () { askThenUpdate(null, this); });
  /* Tell the person when a newer version is online (checked on open and on return to the app). */
  function checkVersion() {
    if (!navigator.onLine || !window.fetch) return;
    fetch('./sw.js', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
      var m = /shelf-finder-v(\d+)/.exec(t), mine = parseInt(String(APP_VERSION).replace(/\D/g, ''), 10);
      var newer = !!(m && parseInt(m[1], 10) > mine);
      $('#updateBar').hidden = !newer;
      if (newer) $('#updateBar').textContent = 'A new version is ready. Tap to update.';
    }).catch(function () {});
  }
  checkVersion();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkVersion(); });
  if ('serviceWorker' in navigator) {
    var hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (r) { document.addEventListener('visibilitychange', function () { if (!document.hidden) r.update().catch(function () {}); }); r.update().catch(function () {}); }).catch(function () {}); });
  }
})();
