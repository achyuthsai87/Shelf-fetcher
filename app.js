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
      places: (Array.isArray(o.places) ? o.places : []).map(function (p) { var q = norm(p && p.q), r = { m: norm(p && p.m), section: norm(p && p.section), shelf: norm(p && p.shelf) }; if (q) r.q = q; return r; }).filter(function (p) { return p.m && (p.section || p.shelf); })
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
    try { logRecent(i >= 0 ? prev[i] : null, it); } catch (e) {}
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
  var noSpot = false, stockF = '', spotF = null;
  var LOWKEY = 'shelf-finder-low-v1';
  var AISLETYPE = 'shelf-finder-aisletype-v1', LASTSTOCK = 'shelf-finder-laststock-v1';
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
      if (spotF && !atSpotLoose(it, spotF)) return false;
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
    if (spotF) h += '<button class="chip" type="button" data-spot="clear" aria-pressed="true">' + esc(spotF.section + (spotF.shelf !== '' ? ' · shelf ' + shelfLab(spotF.shelf) : '')) + ' ✕</button>';
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
  /* Extra places: a bottle can also sit on any map (including the main one) in as many spots as needed, each with an optional count. */
  function placeRowHtml(p) {
    var ms = window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : [];
    var pm = p.m || (ms.filter(function (m) { return m.id !== 'main'; })[0] || { id: 'main' }).id;
    var names = window.ShelfMap && window.ShelfMap.zoneNames ? window.ShelfMap.zoneNames(pm) : [];
    return '<div class="placerow">' +
      '<select data-pmap aria-label="Map">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === pm ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select>' +
      '<button class="tbtn" type="button" data-prm aria-label="Remove this place">Remove</button>' +
      '<input data-ps list="dl-pm-' + esc(pm) + '" placeholder="Section" value="' + esc(p.section || '') + '" autocapitalize="characters">' +
      '<datalist id="dl-pm-' + esc(pm) + '">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<input data-pf placeholder="Shelf (0 = on top, 3-2 = shelf 3 section 2)" value="' + esc(p.shelf || '') + '">' +
      '<input data-pq inputmode="numeric" placeholder="How many here (optional)" value="' + esc(p.q || '') + '"></div>';
  }
  function renderPlaces(it) {
    var host = $('#placesHost'), pl = (it && it.places) || [];
    host.hidden = false;
    host.innerHTML = '<span class="hint">Also kept in other places (another map, a back stack, a display). Add as many as you need.</span><div id="placeRows">' + pl.map(placeRowHtml).join('') + '</div><button class="btn ghost" type="button" id="placeAdd">Add another place</button>';
  }
  $('#placesHost').addEventListener('click', function (e) {
    if (e.target.closest('#placeAdd')) { $('#placeRows').insertAdjacentHTML('beforeend', placeRowHtml({})); return; }
    var rm = e.target.closest('[data-prm]'); if (rm) rm.closest('.placerow').remove();
  });
  $('#placesHost').addEventListener('change', function (e) {
    var sl = e.target.closest('[data-pmap]'); if (!sl) return;
    var row = sl.closest('.placerow'), id = sl.value, names = window.ShelfMap.zoneNames ? window.ShelfMap.zoneNames(id) : [];
    var dl = row.querySelector('datalist'); dl.id = 'dl-pm-' + id; row.querySelector('[data-ps]').setAttribute('list', dl.id);
    dl.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  });
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
      var xp = (it.places || []).map(function (p, pi) {
        var nm = mapLabel(p.m);
        if (!nm) return '';
        return '<button class="pill" type="button" data-pm="' + esc(p.m) + '" data-pi="' + pi + '">' + esc(nm) + ' · ' + hl(p.section || '') + (p.shelf ? (p.section ? ' · ' : '') + (p.shelf === '0' ? 'on top' : 'shelf ' + hl(shelfLab(p.shelf))) : '') + (p.q ? ' · ' + esc(p.q) + ' here' : '') + '</button>';
      }).join('');
      var loc = it.section || it.shelf
        ? '<div class="loc"><span class="sec">' + (it.section ? hl(it.section) : 'Shelf') + '</span>' + (it.shelf ? '<span class="shelf">' + (it.shelf === '0' && it.section ? 'On top' : (it.section ? 'Shelf ' : '') + hl(shelfLab(it.shelf))) + '</span>' : '') + '</div>'
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
  /* Recent activity: the last bottles added, placed on a shelf, given a barcode or edited, so you can see where you stopped. */
  var RECENTKEY = 'shelf-finder-recent-v1';
  function recentList() { try { var l = JSON.parse(localStorage.getItem(RECENTKEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function logRecent(old, it) {
    if (old && JSON.stringify(rawOf(Object.assign({}, old, { updatedAt: 0 }))) === JSON.stringify(rawOf(Object.assign({}, it, { updatedAt: 0 })))) return;
    var spots = itemSpots(it), olds = old ? itemSpots(old) : [];
    var fresh = spots.filter(function (s) { return !olds.some(function (o) { return o.m === s.m && sameSpot(o.section, o.shelf, s.section, s.shelf); }); });
    var e = { id: it.id, t: Date.now(), added: !old, code: !!(it.code && (!old || it.code !== old.code)), at: fresh[0] ? { m: fresh[0].m, section: fresh[0].section, shelf: fresh[0].shelf } : null };
    var list = recentList().filter(function (x) {
      if (x.id !== it.id) return true;
      e.added = e.added || x.added; e.code = e.code || x.code; if (!e.at && x.at) e.at = x.at; return false;
    });
    list.unshift(e);
    try { localStorage.setItem(RECENTKEY, JSON.stringify(list.slice(0, 40))); } catch (x) {}
  }
  function agoText(t) {
    var d = new Date(t), now = new Date(), mins = Math.round((now - d) / 60000), hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (d.toDateString() === now.toDateString()) return hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return 'Yesterday ' + hm;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hm;
  }
  function recentSpot(at) { return (at.m && at.m !== 'main' ? mapLabel(at.m) + ' · ' : '') + spotText(at); }
  var recentMore = false;
  function renderRecent() {
    var host = $('#recentHost'); if (!host) return;
    var list = recentList().map(function (e) { return { e: e, it: items.find(function (x) { return x.id === e.id; }) }; }).filter(function (r) { return r.it; });
    if (!list.length) { host.innerHTML = ''; return; }
    var lastPlaced = list.filter(function (r) { return r.e.at; })[0], today = new Date().toDateString();
    var nToday = list.filter(function (r) { return r.e.at && new Date(r.e.t).toDateString() === today; }).length;
    var shown = list.slice(0, recentMore ? 25 : 6);
    host.innerHTML = '<div class="glass card recent"><h2>Where you left off</h2>' +
      (lastPlaced ? '<p class="hint">Last shelf: <b>' + esc(recentSpot(lastPlaced.e.at)) + '</b> · ' + esc(agoText(lastPlaced.e.t)) + (nToday ? ' · ' + nToday + ' placed today' : '') + '</p><button class="btn block" type="button" data-resume="1">Continue at ' + esc(recentSpot(lastPlaced.e.at)) + '</button>' : '') +
      '<ul class="recentlist">' + shown.map(function (r) {
        var e = r.e, what = [];
        if (e.added) what.push('Added'); if (e.code) what.push('Barcode saved'); if (e.at) what.push('Placed at ' + recentSpot(e.at)); if (!what.length) what.push('Edited');
        return '<li data-rid="' + esc(r.it.id) + '"><b>' + esc(r.it.brand) + (r.it.flavor ? ' ' + esc(r.it.flavor) : '') + '</b>' + (r.it.size ? ' <small>' + esc(r.it.size) + '</small>' : '') + '<span class="rwhat">' + esc(what.join(' · ')) + '</span><em>' + esc(agoText(e.t)) + '</em></li>';
      }).join('') + '</ul>' + (list.length > 6 ? '<button class="btn ghost block" type="button" data-rmore="1">' + (recentMore ? 'Show fewer' : 'Show more') + '</button>' : '') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var host = e.target.closest ? e.target.closest('#recentHost') : null; if (!host) return;
    if (e.target.closest('[data-rmore]')) { recentMore = !recentMore; renderRecent(); return; }
    if (e.target.closest('[data-resume]')) {
      var lp = recentList().filter(function (x) { return x.at && items.some(function (i) { return i.id === x.id; }); })[0];
      openStock('stock');
      if (lp) {
        if ($('#stMap').querySelector('[value="' + (lp.at.m || 'main') + '"]')) $('#stMap').value = lp.at.m || 'main';
        $('#stSection').value = lp.at.section || ''; $('#stShelf').value = lp.at.shelf || ''; syncStockUI();
      }
      return;
    }
    var li = e.target.closest('li[data-rid]');
    if (li) { var it = items.find(function (x) { return x.id === li.getAttribute('data-rid'); }); if (it) openSheet(it); }
  });

  function renderAll() {
    renderTrash();
    renderRecent();
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
  /* A shelf can be written 3-2 (shelf 3, section 2 counted from the left). */
  function shelfParts(v) { var m = /^\s*(\d+)\s*[-.,/]\s*(\d+)\s*$/.exec(String(v == null ? '' : v)); return m ? { shelf: m[1], slot: m[2] } : null; }
  function shelfLab(v) { var m = shelfParts(v); return m ? m.shelf + ', section ' + m.slot : String(v == null ? '' : v); }
  function syncShelfPick() {
    var host = $('#shelfPick'), info = window.ShelfMap && window.ShelfMap.zoneInfo ? window.ShelfMap.zoneInfo(F.section.value) : null;
    if (!info || info.shelves < 2) { host.innerHTML = ''; host.hidden = true; return; }
    var raw = String(F.shelf.value || '').trim(), pr = shelfParts(raw), cur = pr ? pr.shelf : raw, h = '', cn = pr || /^\d+$/.test(raw) ? parseInt(cur, 10) : -1, sec = '';
    for (var i = 0; i <= info.shelves; i++) h += '<button class="chip" type="button" data-shelf="' + i + '" aria-pressed="' + (cur === String(i)) + '">' + i + '</button>';
    var cc = info.cells && cn >= 1 ? info.cells[cn - 1] : 1;
    if (cc > 1) { sec = '<span class="hint">Section on shelf ' + cn + ' (counted from the left of the map)</span><div class="chips">'; for (var j = 1; j <= cc; j++) sec += '<button class="chip" type="button" data-slot="' + j + '" aria-pressed="' + (pr && pr.slot === String(j)) + '">' + j + '</button>'; sec += '</div>'; }
    host.innerHTML = '<span class="hint">Shelf (0 = on top of the box, 1 = the ' + (info.topFirst ? 'top' : 'bottom') + ' shelf)</span><div class="chips">' + h + '</div>' + sec;
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
        return { m: r.querySelector('[data-pmap]').value, section: r.querySelector('[data-ps]').value, shelf: r.querySelector('[data-pf]').value, q: r.querySelector('[data-pq]').value };
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
    var b = e.target.closest('[data-type],[data-nospot],[data-stock],[data-spot]');
    if (!b) return;
    if (b.hasAttribute('data-spot')) { spotF = null; }
    else if (b.hasAttribute('data-stock')) { var sv = b.getAttribute('data-stock'); stockF = stockF === sv ? '' : sv; typeF = ''; noSpot = false; spotF = null; }
    else if (b.hasAttribute('data-nospot')) { noSpot = !noSpot; typeF = ''; stockF = ''; spotF = null; }
    else { typeF = b.getAttribute('data-type'); noSpot = false; stockF = ''; spotF = null; }
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
      if (pl && window.ShelfMap) { window.ShelfMap.show(it, pl.getAttribute('data-pm'), parseInt(pl.getAttribute('data-pi'), 10)); return; }
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
    var sb = e.target.closest('[data-slot]');
    if (sb) { var pr0 = shelfParts(F.shelf.value), base = pr0 ? pr0.shelf : String(F.shelf.value || '').trim(); F.shelf.value = base + '-' + sb.getAttribute('data-slot'); syncShelfPick(); return; }
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
      var sh = i.shelf === '0' ? 'On top' : (i.shelf ? 'Shelf ' + shelfLab(i.shelf) : 'No shelf');
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
    var lab = parseLabel(code);
    if (lab) { labelPopup(lab); return; }
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
  /* Barcode lookup: the number is sent to public product databases and nothing else leaves the phone. */
  function timedFetch(url) {
    return new Promise(function (res, rej) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; rej(new Error('timeout')); } }, 4500);
      fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http')); }).then(function (j) { if (!done) { done = true; clearTimeout(t); res(j); } }, function (e) { if (!done) { done = true; clearTimeout(t); rej(e); } });
    });
  }
  function sizeFrom(t) { var m = /(\d+(?:\.\d+)?)\s*(ml|l|liter|litre|oz|fl\.?\s*oz)\b/i.exec(t || ''); return m ? m[1] + m[2].toLowerCase().replace(/\s+/g, '') : ''; }
  function lookupCode(code) {
    var c = encodeURIComponent(code);
    return timedFetch('https://api.upcitemdb.com/prod/trial/lookup?upc=' + c).then(function (j) {
      var p = j && j.items && j.items[0]; if (!p || !p.title) throw new Error('none');
      var name = String(p.title).trim(); if (p.brand && name.toLowerCase().indexOf(String(p.brand).toLowerCase()) < 0) name = p.brand + ' ' + name;
      return { name: name, size: norm(p.size) || sizeFrom(name), type: '' };
    }).catch(function () {
      return timedFetch('https://world.openfoodfacts.org/api/v2/product/' + c + '.json?fields=product_name,brands,quantity').then(function (j) {
        var p = j && j.product; if (!p || !p.product_name) throw new Error('none');
        var name = String(p.product_name).trim(); if (p.brands && name.toLowerCase().indexOf(String(p.brands).split(',')[0].toLowerCase()) < 0) name = String(p.brands).split(',')[0].trim() + ' ' + name;
        return { name: name, size: norm(p.quantity) || sizeFrom(name), type: '' };
      });
    }).catch(function () { return null; });
  }
  function popup(html, wire) {
    var ov = document.createElement('div'); ov.className = 'popov';
    ov.innerHTML = '<div class="popcard" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(ov);
    var card = ov.firstChild, vv = window.visualViewport, scanEl = document.getElementById('scanOv');
    /* Keep the pop-up inside the part of the screen the keyboard leaves free, with the typing box at the top. */
    function fit() { if (!vv) return; ov.style.top = vv.offsetTop + 'px'; ov.style.height = vv.height + 'px'; ov.style.bottom = 'auto'; }
    function mode() { ov.classList.toggle('top', !!card.querySelector('input:not([type=checkbox])')); }
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
    var mo = window.MutationObserver ? new MutationObserver(mode) : null; if (mo) mo.observe(card, { childList: true, subtree: true });
    mode();
    /* The camera screen behind stops reacting while the pop-up is open. */
    if (scanEl) scanEl.setAttribute('inert', '');
    wire(ov, function () {
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
      if (mo) mo.disconnect();
      ov.remove();
      var s = document.getElementById('scanOv');
      if (s && !document.querySelector('.popov')) { s.removeAttribute('inert'); var ti = document.getElementById('scanType'); if (ti) try { ti.setAttribute('inputmode', 'none'); ti.focus({ preventScroll: true }); } catch (e) {} }
    });
  }
  /* Spots a bottle has: its own Aisle and Shelf on the main map, plus every extra place. */
  function sameSpot(sec1, sh1, sec2, sh2) { return String(sec1 || '').trim().toLowerCase() === String(sec2 || '').trim().toLowerCase() && String(sh1 || '').trim() === String(sh2 || '').trim(); }
  function itemSpots(it) {
    var out = [];
    if (it.section || it.shelf) out.push({ m: 'main', section: it.section, shelf: it.shelf, primary: true });
    (it.places || []).forEach(function (p, k) { out.push({ m: p.m, section: p.section, shelf: p.shelf, idx: k }); });
    return out;
  }
  function hasSpot(it) { return itemSpots(it).length > 0; }
  function itemHere(it, c) { return itemSpots(it).some(function (s) { return s.m === (c.m || 'main') && sameSpot(s.section, s.shelf, c.section, c.shelf); }); }
  function spotText(s) { return (s.section || '') + (s.shelf !== '' && s.shelf != null ? (s.section ? ' · ' : '') + (String(s.shelf) === '0' ? 'on top' : 'shelf ' + shelfLab(s.shelf)) : ''); }
  function copyRaw(it) { var r = rawOf(it); if (r.places) r.places = r.places.map(function (p) { return Object.assign({}, p); }); return r; }
  /* Put a bottle at a spot: by default it is moved there; with c.add it is kept where it is and gets one more place. */
  function placeAt(it, c) {
    var raw = copyRaw(it), main = !c.m || c.m === 'main';
    if (c.add) {
      raw.places = raw.places || [];
      if (!(main && !raw.section && !raw.shelf)) { raw.places.push({ m: c.m || 'main', section: c.section, shelf: c.shelf }); return mk(raw); }
      raw.section = c.section; raw.shelf = c.shelf; return mk(raw);
    }
    if (main) { raw.section = c.section; raw.shelf = c.shelf; }
    else {
      raw.places = raw.places || [];
      var at = -1; raw.places.forEach(function (p, k) { if (at < 0 && p.m === c.m) at = k; });
      if (at >= 0) raw.places[at] = { m: c.m, section: c.section, shelf: c.shelf }; else raw.places.push({ m: c.m, section: c.section, shelf: c.shelf });
    }
    return mk(raw);
  }
  function takeOff(it, c) {
    var raw = copyRaw(it), main = !c.m || c.m === 'main';
    if (main && sameSpot(raw.section, raw.shelf, c.section, c.shelf)) { raw.section = ''; raw.shelf = ''; return mk(raw); }
    var at = -1; (raw.places || []).forEach(function (p, k) { if (at < 0 && p.m === (c.m || 'main') && sameSpot(p.section, p.shelf, c.section, c.shelf)) at = k; });
    if (at >= 0) raw.places.splice(at, 1);
    return mk(raw);
  }
  function placedStats() { var n = items.filter(hasSpot).length; return { placed: n, total: items.length }; }
  function progressText() { var s = placedStats(); return 'Placed ' + s.placed + ' of ' + s.total + (s.total ? ' (' + Math.floor(100 * s.placed / s.total) + '%)' : ''); }
  /* Shelf labels: a QR code that holds one spot. Scanning it picks that spot. */
  function labelText(m, section, shelf) { return 'SF1|' + m + '|' + section + '|' + shelf; }
  function parseLabel(code) {
    var p = String(code || '').split('|');
    if (p[0] !== 'SF1' || p.length < 4) return null;
    var ms = window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : [];
    return { m: p[1] || 'main', section: p[2] || '', shelf: p.slice(3).join('|'), mapName: ms.length > 1 ? mapLabel(p[1] || 'main') : '' };
  }
  /* Whether a bottle sits at a spot, matching the shelf level (3 also matches 3-2) unless the spot names a section on the shelf. */
  function shelfLevelOf(v) { var m = String(v == null ? '' : v).match(/\d+/); return m ? parseInt(m[0], 10) : -1; }
  function atSpotLoose(it, c) {
    return itemSpots(it).some(function (s) {
      if (s.m !== (c.m || 'main') || String(s.section || '').trim().toLowerCase() !== String(c.section || '').trim().toLowerCase()) return false;
      if (c.shelf === '' || c.shelf == null) return true;
      var cp = shelfParts(c.shelf), sp = shelfParts(s.shelf);
      if (shelfLevelOf(s.shelf) !== shelfLevelOf(c.shelf)) return false;
      return cp ? !!sp && sp.slot === cp.slot : true;
    });
  }
  function labelPopup(lab) {
    var where = (lab.mapName ? lab.mapName + ' · ' : '') + lab.section + (lab.shelf !== '' ? ' · shelf ' + shelfLab(lab.shelf) : '');
    var n = items.filter(function (it) { return atSpotLoose(it, lab); }).length;
    popup('<h3>' + esc(where) + '</h3><p>' + n + ' bottle' + (n === 1 ? '' : 's') + ' listed here.</p><div class="popbtns"><button class="btn grow" data-lshow type="button">Show bottles</button></div><div class="popbtns"><button class="btn grow" data-lstock type="button">Stock this shelf</button><button class="btn grow" data-lcheck type="button">Check this shelf</button></div><div class="popbtns"><button class="btn ghost grow" data-lclose type="button">Cancel</button></div>', function (ov, close) {
      ov.addEventListener('click', function (e) {
        var t = e.target.closest('button'); if (!t) return;
        if (t.hasAttribute('data-lshow')) { close(); spotF = { m: lab.m, section: lab.section, shelf: lab.shelf }; typeF = ''; noSpot = false; stockF = ''; setSearch(''); showTab('find'); renderChips(); renderList(); }
        else if (t.hasAttribute('data-lstock') || t.hasAttribute('data-lcheck')) {
          close(); openStock(t.hasAttribute('data-lcheck') ? 'check' : 'stock');
          if (lab.m && $('#stMap').querySelector('[value="' + lab.m + '"]')) $('#stMap').value = lab.m;
          $('#stSection').value = lab.section; $('#stShelf').value = lab.shelf; syncStockUI();
        } else close();
      });
    });
  }
  var stockMode = 'stock';
  function openStock(mode) {
    stockMode = mode === 'check' ? 'check' : 'stock';
    var ms = window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : [];
    $('#stockTitle').textContent = stockMode === 'check' ? 'Check a shelf' : 'Stock a shelf';
    $('#stockHint').textContent = stockMode === 'check'
      ? 'Pick the spot, then scan everything that is on it. When you tap Done you see what is missing, what belongs somewhere else, and what is not in your list.'
      : 'Pick the spot, then scan each bottle on it. Every bottle you scan is moved to that spot. Tap Done when the shelf is finished. You can also scan a printed shelf label to switch spots.';
    $('#stOptions').hidden = stockMode === 'check';
    $('#stProgress').hidden = stockMode === 'check';
    $('#stProgress').textContent = progressText();
    $('#stockGo').textContent = stockMode === 'check' ? 'Start checking' : 'Start scanning';
    $('#stMapField').hidden = ms.length < 2;
    $('#stMap').innerHTML = ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    var last = readJSON(LASTSTOCK);
    if (last.section) {
      if ($('#stMap').querySelector('[value="' + last.m + '"]')) $('#stMap').value = last.m;
      $('#stSection').value = last.section; $('#stShelf').value = last.shelf || '';
    }
    var known = {}; items.forEach(function (i) { if (i.type) known[i.type.toLowerCase()] = i.type; });
    $('#dl-types').innerHTML = Object.keys(known).sort().map(function (k) { return '<option value="' + esc(known[k]) + '">'; }).join('');
    $('#stTypeField').hidden = stockMode === 'check';
    syncStockUI();
    $('#stockScrim').hidden = false;
    setTimeout(function () { (last.section ? $('#stockGo') : ($('#stSecSel').hidden ? $('#stSection') : $('#stSecSel'))).focus(); }, 40);
  }
  function stMapId() { return $('#stMapField').hidden ? 'main' : ($('#stMap').value || 'main'); }
  function syncStType() { $('#stType').value = aisleType(stMapId(), norm($('#stSection').value)); }
  /* Aisle and shelf are picked from the map's own boxes, so they follow any change to the map. */
  function fillAisles() {
    var SM = window.ShelfMap, names = SM && SM.zoneNames ? SM.zoneNames(stMapId()).slice().sort(cmp) : [], sel = $('#stSecSel'), cur = norm($('#stSection').value), low = cur.toLowerCase();
    var found = names.filter(function (n) { return n.toLowerCase() === low; })[0], custom = !!cur && !found;
    if (found) { cur = found; $('#stSection').value = found; }
    sel.innerHTML = '<option value="">Choose an aisle</option>' + names.map(function (n) { return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '<option value="__new__"' + (custom ? ' selected' : '') + '>Other... (type a name)</option>';
    sel.hidden = !names.length; $('#stSection').hidden = !!names.length && !custom;
  }
  function drawShelfPick() {
    var host = $('#stShelfPick'), sec = norm($('#stSection').value), info = window.ShelfMap && window.ShelfMap.zoneInfo && sec ? window.ShelfMap.zoneInfo(sec, stMapId()) : null;
    if (!info) { host.hidden = true; host.innerHTML = ''; $('#stShelf').hidden = !sec && !$('#stSecSel').hidden && $('#stSecSel').value !== '__new__'; return; }
    $('#stShelf').hidden = true;
    if (info.shelves < 2) { host.hidden = true; host.innerHTML = ''; $('#stShelf').value = ''; return; }
    var raw = norm($('#stShelf').value), pr = shelfParts(raw), lvl = shelfLevelOf(raw), h = '', i;
    for (i = 0; i <= info.shelves; i++) h += '<button class="chip" type="button" data-stsh="' + i + '" aria-pressed="' + (lvl === i) + '">' + (i === 0 ? 'Top' : i) + '</button>';
    var cc = info.cells && lvl >= 1 ? info.cells[lvl - 1] : 1;
    if (cc > 1) { h += '</div><span class="hint">Section on shelf ' + lvl + '</span><div class="chips">'; for (i = 1; i <= cc; i++) h += '<button class="chip" type="button" data-stsl="' + i + '" aria-pressed="' + (!!pr && pr.slot === String(i)) + '">' + i + '</button>'; }
    host.innerHTML = '<span class="hint">1 = the ' + (info.topFirst ? 'top' : 'bottom') + ' shelf</span><div class="chips">' + h + '</div>';
    host.hidden = false;
  }
  function syncStockUI() { fillAisles(); syncStType(); drawShelfPick(); }
  $('#stSection').addEventListener('input', function () { syncStType(); drawShelfPick(); });
  $('#stSecSel').addEventListener('change', function () {
    var other = this.value === '__new__';
    $('#stSection').value = other ? '' : this.value; $('#stShelf').value = '';
    $('#stSection').hidden = !other; if (other) $('#stSection').focus();
    syncStType(); drawShelfPick();
  });
  $('#stMap').addEventListener('change', function () { $('#stShelf').value = ''; syncStockUI(); });
  $('#stShelfPick').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var lvl = shelfLevelOf($('#stShelf').value);
    if (b.hasAttribute('data-stsh')) $('#stShelf').value = b.getAttribute('data-stsh');
    else if (b.hasAttribute('data-stsl')) $('#stShelf').value = (lvl >= 0 ? lvl : 1) + '-' + b.getAttribute('data-stsl');
    drawShelfPick();
  });
  function stockSpotLabel(c) { return (c.mapName ? c.mapName + ' · ' : '') + c.section + (c.shelf !== '' ? ' · shelf ' + shelfLab(c.shelf) : ''); }
  /* Set the type (Whiskey, Vodka...) of every bottle that sits in the named boxes, so the type filter works. */
  function parseBoxNames(raw) {
    var names = [];
    String(raw || '').split(/[,;\n&+]+|\s+and\s+/i).forEach(function (t) {
      t = t.trim(); if (!t) return;
      var m = /^([A-Za-z]*)\s*(\d+)\s*[-–]\s*(?:[A-Za-z]*)\s*(\d+)$/.exec(t), a, b, n;
      if (m) { a = parseInt(m[2], 10); b = parseInt(m[3], 10); }
      if (m && b >= a && b - a < 200) { for (n = a; n <= b; n++) names.push((m[1] + n).toLowerCase()); }
      else names.push(t.toLowerCase());
    });
    return names;
  }
  function openTypeByAisle() {
    var ms = window.ShelfMap && window.ShelfMap.maps ? window.ShelfMap.maps() : [];
    var known = {}; items.forEach(function (i) { if (i.type) known[i.type.toLowerCase()] = i.type; });
    var opts = Object.keys(known).sort().map(function (k) { return '<option value="' + esc(known[k]) + '"></option>'; }).join('');
    popup('<h3>Set bottle type by aisle</h3><p>Tap the boxes, or a whole letter like All A. Every bottle listed in them gets the type.</p>' +
      (ms.length > 1 ? '<label class="hint" for="tbMap">Map</label><select id="tbMap">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</select>' : '') +
      '<div id="tbBoxes" class="tbboxes"></div>' +
      '<input id="tbType" list="tbTypes" placeholder="Type: Whiskey" autocomplete="off"><datalist id="tbTypes">' + opts + '</datalist>' +
      '<label class="chk"><input type="checkbox" id="tbBlank" checked> Only bottles with no type yet</label>' +
      '<p class="hint" id="tbInfo"></p>' +
      '<div class="popbtns"><button class="btn grow" data-tbgo type="button">Set type</button><button class="btn ghost grow" data-tbclose type="button">Cancel</button></div>', function (ov, close) {
      var sel = {};
      function mapId() { return ov.querySelector('#tbMap') ? ov.querySelector('#tbMap').value : 'main'; }
      function boxNames() {
        var m = mapId(), seen = {}, out = [];
        (window.ShelfMap && window.ShelfMap.zoneNames ? window.ShelfMap.zoneNames(m) : []).forEach(function (n) { var k = n.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(n); } });
        items.forEach(function (it) { itemSpots(it).forEach(function (sp) { var n = String(sp.section || '').trim(), k = n.toLowerCase(); if (sp.m === m && n && !seen[k]) { seen[k] = 1; out.push(n); } }); });
        return out.sort(cmp);
      }
      function groupOf(n) { var g = /^[A-Za-z]+/.exec(n); return g ? g[0].toUpperCase() : '#'; }
      function draw() {
        var names = boxNames(), groups = {}, order = [];
        names.forEach(function (n) { var g = groupOf(n); if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(n); });
        ov.querySelector('#tbBoxes').innerHTML = order.map(function (g) {
          var all = groups[g].every(function (n) { return sel[n.toLowerCase()]; });
          return '<div class="tbgrp"><button class="chip" type="button" data-tbgrp="' + esc(g) + '" aria-pressed="' + all + '">' + (g === '#' ? 'All numbered' : 'All ' + esc(g)) + '</button>' +
            groups[g].map(function (n) { return '<button class="chip" type="button" data-tbbox="' + esc(n) + '" aria-pressed="' + !!sel[n.toLowerCase()] + '">' + esc(n) + '</button>'; }).join('') + '</div>';
        }).join('') || '<p class="hint">No boxes on this map yet.</p>';
        info();
      }
      function pick() {
        var m = mapId(), only = ov.querySelector('#tbBlank').checked;
        return items.filter(function (it) {
          if (only && it.type) return false;
          return itemSpots(it).some(function (sp) { return sp.m === m && sel[String(sp.section || '').trim().toLowerCase()]; });
        });
      }
      function info() { var n = pick().length, c = Object.keys(sel).filter(function (k) { return sel[k]; }).length; ov.querySelector('#tbInfo').textContent = c + ' box' + (c === 1 ? '' : 'es') + ' picked. ' + n + ' bottle' + (n === 1 ? '' : 's') + ' would change.'; }
      ov.addEventListener('change', function (e) { if (e.target.id === 'tbMap') { sel = {}; draw(); } else info(); });
      ov.addEventListener('input', info);
      ov.addEventListener('click', function (e) {
        var t = e.target.closest('button'); if (!t) return;
        if (t.hasAttribute('data-tbclose')) { close(); return; }
        if (t.hasAttribute('data-tbbox')) { var k = t.getAttribute('data-tbbox').toLowerCase(); sel[k] = !sel[k]; draw(); return; }
        if (t.hasAttribute('data-tbgrp')) {
          var g = t.getAttribute('data-tbgrp'), mine = boxNames().filter(function (n) { return groupOf(n) === g; }), all = mine.every(function (n) { return sel[n.toLowerCase()]; });
          mine.forEach(function (n) { sel[n.toLowerCase()] = !all; }); draw(); return;
        }
        if (!t.hasAttribute('data-tbgo')) return;
        var type = ov.querySelector('#tbType').value.trim(), hit = pick();
        if (!type) { toast('Type the bottle type first, like Whiskey.'); return; }
        if (!hit.length) { toast('No bottles found in those boxes.'); return; }
        if (window.ShelfBackup && window.ShelfBackup.snapshot) window.ShelfBackup.snapshot('Before setting bottle types');
        var prev = items.slice(), ids = {}; hit.forEach(function (it) { ids[it.id] = 1; });
        var now = Date.now();
        items = items.map(function (it) { if (!ids[it.id]) return it; var r = copyRaw(it); r.type = type; r.updatedAt = now; return mk(r); });
        if (!saveLocal()) { items = prev; toast('This phone has no room left to save.'); return; }
        close(); renderAll(); toast(hit.length + ' bottle' + (hit.length === 1 ? '' : 's') + ' set to ' + type + '.');
      });
      draw();
    });
  }
  $('#typeBtn').addEventListener('click', openTypeByAisle);
  $('#stockBtn').addEventListener('click', function () { openStock('stock'); });
  $('#checkBtn').addEventListener('click', function () { openStock('check'); });
  $('#stockClose').addEventListener('click', function () { $('#stockScrim').hidden = true; });

  function showCheckReport(c, expected, scannedIds, misplaced, unknown) {
    var missing = expected.filter(function (it) { return !scannedIds[it.id]; });
    function nm(it) { return it.brand + (it.flavor ? ' ' + it.flavor : ''); }
    function rows(list, btn, label) {
      return list.map(function (it) { return '<div class="logrow2"><span>' + esc(nm(it)) + (btn === 'move' ? '<small> now listed at ' + esc(itemSpots(it).map(spotText).join(', ') || 'no spot') + '</small>' : '') + '</span><button class="tbtn" type="button" data-' + btn + '="' + esc(it.id) + '">' + label + '</button></div>'; }).join('');
    }
    var found = expected.length - missing.length;
    var html = '<h3>' + esc(stockSpotLabel(c)) + '</h3><p><b>' + found + '</b> of ' + expected.length + ' listed bottles scanned.</p>' +
      (missing.length ? '<h4>Not scanned (' + missing.length + ')</h4><p class="hint">Listed here but not seen. They may be sold out or moved.</p>' + rows(missing, 'off', 'Take off') + '<button class="btn ghost" type="button" data-offall>Take all off this shelf</button>' : '') +
      (misplaced.length ? '<h4>Here but listed elsewhere (' + misplaced.length + ')</h4>' + rows(misplaced, 'move', 'Move here') + '<button class="btn ghost" type="button" data-moveall>Move all here</button>' : '') +
      (unknown.length ? '<h4>Not in your list (' + unknown.length + ')</h4><p class="hint">' + unknown.map(esc).join(', ') + '</p>' : '') +
      (!missing.length && !misplaced.length && !unknown.length ? '<p>Everything matches.</p>' : '') +
      '<div class="popbtns"><button class="btn grow" type="button" data-rclose>Close</button></div>';
    popup(html, function (ov, close) {
      ov.querySelector('.popcard').classList.add('wide');
      function applyOne(id, fn) { var it = items.filter(function (x) { return x.id === id; })[0]; if (it) try { save(fn(it)); } catch (err) { toast('Could not save. This phone is out of space.'); } }
      ov.addEventListener('click', function (e) {
        var t = e.target.closest('button'); if (!t) return;
        if (t.hasAttribute('data-rclose')) { close(); return; }
        if (t.hasAttribute('data-off')) { applyOne(t.getAttribute('data-off'), function (it) { return takeOff(it, c); }); t.closest('.logrow2').remove(); return; }
        if (t.hasAttribute('data-move')) { applyOne(t.getAttribute('data-move'), function (it) { return placeAt(it, c); }); t.closest('.logrow2').remove(); return; }
        if (t.hasAttribute('data-offall')) { missing.forEach(function (it) { applyOne(it.id, function (x) { return takeOff(x, c); }); }); close(); toast(missing.length + ' taken off ' + stockSpotLabel(c)); return; }
        if (t.hasAttribute('data-moveall')) { misplaced.forEach(function (it) { applyOne(it.id, function (x) { return placeAt(x, c); }); }); close(); toast(misplaced.length + ' moved to ' + stockSpotLabel(c)); }
      });
    });
  }

  /* Quick controls on the scanner: shelf buttons, Next shelf, Next aisle, and a remembered type per aisle. */
  var stockCtl = null;
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null') || {}; } catch (e) { return {}; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function aisleKey(m, section) { return (m || 'main') + '|' + String(section || '').trim().toLowerCase(); }
  function aisleType(m, section) { return readJSON(AISLETYPE)[aisleKey(m, section)] || ''; }
  function saveAisleType(m, section, type) { var o = readJSON(AISLETYPE), k = aisleKey(m, section); if (type) o[k] = type; else delete o[k]; writeJSON(AISLETYPE, o); }
  function saveLastSpot(c) { writeJSON(LASTSTOCK, { m: c.m || 'main', section: c.section, shelf: c.shelf }); }
  function quickBar(c) {
    var SM = window.ShelfMap, info = SM && SM.zoneInfo ? SM.zoneInfo(c.section, c.m) : null, h = '', i, pr = shelfParts(c.shelf), lvl = shelfLevelOf(c.shelf);
    if (info && info.shelves >= 2) {
      for (i = 0; i <= info.shelves; i++) h += '<button class="chip" type="button" data-qshelf="' + i + '" aria-pressed="' + (lvl === i) + '">' + i + '</button>';
      var cc = info.cells && lvl >= 1 ? info.cells[lvl - 1] : 1;
      if (cc > 1) { h += '<br>'; for (i = 1; i <= cc; i++) h += '<button class="chip" type="button" data-qslot="' + i + '" aria-pressed="' + (!!pr && pr.slot === String(i)) + '">s' + i + '</button>'; }
    }
    var names = SM && SM.zoneNames ? SM.zoneNames(c.m) : [];
    h += '<br>' + (info && info.shelves >= 2 ? '<button class="chip" type="button" data-qnext="1">Next shelf</button>' : '') + (names.length > 1 ? '<button class="chip" type="button" data-qaisle="1">Next aisle</button>' : '');
    return '<div class="qbar">' + h + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#scanOv [data-qshelf],#scanOv [data-qslot],#scanOv [data-qnext],#scanOv [data-qaisle]');
    if (!b || !stockCtl) return;
    var c = stockCtl.c, SM = window.ShelfMap, info = SM.zoneInfo(c.section, c.m), lvl = shelfLevelOf(c.shelf);
    if (b.hasAttribute('data-qshelf')) c.shelf = b.getAttribute('data-qshelf');
    else if (b.hasAttribute('data-qslot')) c.shelf = (lvl >= 0 ? lvl : 1) + '-' + b.getAttribute('data-qslot');
    else if (b.hasAttribute('data-qnext')) {
      var nl = lvl < 0 ? 1 : lvl + 1;
      if (info && nl > info.shelves) { toast('That was the last shelf. Tap Next aisle.'); return; }
      c.shelf = String(nl);
    } else {
      var names = SM.zoneNames(c.m).slice().sort(cmp), at = names.map(function (n) { return n.toLowerCase(); }).indexOf(String(c.section).toLowerCase()), nx = names[(at + 1) % names.length], ni = SM.zoneInfo(nx, c.m);
      c.section = nx; c.shelf = ni && ni.shelves >= 2 ? '1' : ''; c.type = aisleType(c.m, nx);
    }
    saveLastSpot(c);
    stockCtl.refresh();
    if (window.ShelfScan && window.ShelfScan.log) window.ShelfScan.log({ text: 'Now on ' + stockSpotLabel(c) });
    var ti = document.getElementById('scanType'); if (ti) try { ti.focus({ preventScroll: true }); } catch (err) {}
  });
  function typeOnto(it, c) { if (!c.type || it.type) return it; var r = copyRaw(it); r.type = c.type; return mk(r); }

  $('#stockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var section = norm($('#stSection').value), shelf = norm($('#stShelf').value);
    if (!section) { toast('Type the aisle or section first.'); return; }
    var m = $('#stMapField').hidden ? 'main' : ($('#stMap').value || 'main');
    var check = stockMode === 'check';
    var c = { m: m, section: section, shelf: shelf, mapName: $('#stMapField').hidden ? '' : mapLabel(m), add: !check && $('#stAdd').checked, type: check ? '' : norm($('#stType').value) };
    if (!check) saveAisleType(m, section, c.type);
    saveLastSpot(c);
    var keepPlaced = !check && $('#stKeep').checked;
    if (!window.ShelfScan) return;
    var unknown = [], placed = 0, skipped = {}, scannedIds = {}, misplaced = [], expected = [];
    function expectedNow() { return items.filter(function (it) { return itemHere(it, c); }); }
    if (check) expected = expectedNow();
    function headHtml() {
      return '<b>' + esc(stockSpotLabel(c)) + '</b><span>' + (check ? 'Checking: ' + Object.keys(scannedIds).length + ' scanned of ' + expected.length + ' listed' : progressText() + (c.type ? ' · ' + esc(c.type) : '') + ' · scan each bottle') + '</span>' + (check ? '' : quickBar(c));
    }
    stockCtl = check ? null : { c: c, refresh: function () { window.ShelfScan.setHead(headHtml()); } };
    function stockUnknown(code, k) {
      window.ShelfScan.hold(true);
      function resume() { window.ShelfScan.hold(false); }
      function cancel(close) { skipped[k] = 1; if (unknown.indexOf(code) < 0) unknown.push(code); close(); resume(); window.ShelfScan.log({ text: code + ' skipped (not in your list)', cls: 'bad' }); }
      function create(info, close) {
        var raw = { id: newId(), brand: info.name, size: info.size || '', type: info.type || c.type || '', code: code };
        if (!c.m || c.m === 'main') { raw.section = c.section; raw.shelf = c.shelf; } else raw.places = [{ m: c.m, section: c.section, shelf: c.shelf }];
        var it = mk(raw);
        try { save(it); } catch (err) { toast('Could not save. This phone is out of space.'); close(); resume(); return; }
        placed++; close(); resume(); window.ShelfScan.setHead(headHtml());
        window.ShelfScan.log({ text: info.name + ' added as a new bottle', cls: 'ok', undo: function () { try { removeItem(it.id); placed--; window.ShelfScan.setHead(headHtml()); } catch (err) {} } });
      }
      popup('', function (ov, close) {
        var card = ov.querySelector('.popcard');
        function main() {
          card.innerHTML = '<h3>Not found</h3><p>The barcode <b>' + esc(code) + '</b> is not linked to a bottle yet. Link it to a bottle in your list, or add it as a new bottle.</p><div class="popbtns"><button class="btn grow" data-plink type="button">Link to a bottle</button></div><div class="popbtns"><button class="btn grow" data-padd type="button">Add item</button><button class="btn ghost" data-pcancel type="button">Cancel</button></div>';
          card.querySelector('[data-pcancel]').addEventListener('click', function () { cancel(close); });
          card.querySelector('[data-plink]').addEventListener('click', link);
          card.querySelector('[data-padd]').addEventListener('click', add);
        }
        function add() {
          card.innerHTML = '<h3>Looking it up</h3><p>Finding the name for <b>' + esc(code) + '</b>...</p>';
          lookupCode(code).then(function (info) {
            if (info) { create(info, close); return; }
            card.innerHTML = '<h3>No details found</h3><p>No product details exist online for <b>' + esc(code) + '</b>. Type the name once and the barcode is remembered.</p><input class="popin" id="popName" placeholder="Bottle name and size" autocomplete="off"><div class="popbtns"><button class="btn grow" data-psave type="button">Add item</button><button class="btn ghost" data-pcancel type="button">Cancel</button></div>';
            var inp = card.querySelector('#popName'); setTimeout(function () { inp.focus(); }, 40);
            card.querySelector('[data-pcancel]').addEventListener('click', function () { cancel(close); });
            card.querySelector('[data-psave]').addEventListener('click', function () { var n = norm(inp.value); if (!n) { inp.focus(); return; } create({ name: n, size: sizeFrom(n) }, close); });
          });
        }
        function link() {
          card.innerHTML = '<h3>Which bottle is it?</h3><input class="popin" id="popQ" type="search" placeholder="Search the name or item number" autocomplete="off" autocapitalize="off" spellcheck="false"><p class="hint" id="popOnline"></p><div id="popRes" class="poplist"></div><div class="popbtns"><button class="btn ghost" data-pback type="button">Back</button><button class="btn ghost" data-pcancel type="button">Cancel</button></div>';
          var q = card.querySelector('#popQ'), res = card.querySelector('#popRes'), on = card.querySelector('#popOnline'), typed = false;
          function render() {
            var qv = q.value;
            if (!window.ShelfSearch.tokens(qv).length) { res.innerHTML = ''; return; }
            var list = window.ShelfSearch.run(items, qv).slice(0, 6).map(function (r) { return r.it; });
            res.innerHTML = list.length ? list.map(function (it) {
              return '<button class="linkrow" type="button" data-pick="' + esc(it.id) + '"><b>' + esc(it.brand) + '</b>' + (it.flavor ? ' ' + esc(it.flavor) : '') + (it.size ? ' <small>' + esc(it.size) + '</small>' : '') + (it.code ? ' <small>(has a barcode)</small>' : '') + '</button>';
            }).join('') : '<p class="hint">Nothing matches. Try fewer words.</p>';
          }
          q.addEventListener('input', function () { typed = true; render(); });
          setTimeout(function () { q.focus(); }, 40);
          on.textContent = 'Looking up the name online to help...';
          lookupCode(code).then(function (info) {
            if (!card.contains(on)) return;
            if (info && !typed) { on.textContent = 'Online name: ' + info.name; q.value = info.name.replace(/['’`]/g, '').replace(/\d+(?:\.\d+)?\s*(?:ml|l|oz|fl\.?\s*oz)\b/ig, '').trim().split(/\s+/).slice(0, 2).join(' '); render(); } else on.textContent = info ? 'Online name: ' + info.name : '';
          });
          card.querySelector('[data-pback]').addEventListener('click', main);
          card.querySelector('[data-pcancel]').addEventListener('click', function () { cancel(close); });
          res.addEventListener('click', function (e) {
            var b = e.target.closest('[data-pick]'); if (!b) return;
            var it = items.filter(function (x) { return x.id === b.getAttribute('data-pick'); })[0]; if (!it) return;
            var snap = copyRaw(it), raw = copyRaw(it); raw.code = code;
            var upd = mk(raw); if (!itemHere(upd, c)) upd = placeAt(upd, c); upd = typeOnto(upd, c);
            try { save(upd); } catch (err) { toast('Could not save. This phone is out of space.'); return; }
            placed++; close(); resume(); window.ShelfScan.setHead(headHtml());
            window.ShelfScan.log({ text: it.brand + (it.flavor ? ' ' + it.flavor : '') + ' linked and added', cls: 'ok', undo: function () { try { save(mk(snap)); placed--; window.ShelfScan.setHead(headHtml()); } catch (err) {} } });
          });
        }
        main();
      });
    }
    $('#stockScrim').hidden = true;
    window.ShelfScan.open(function (code) {
      /* A printed shelf label switches the spot. */
      var lab = parseLabel(code);
      if (lab) {
        c.m = lab.m; c.section = lab.section; c.shelf = lab.shelf; c.mapName = lab.mapName;
        if (check) { scannedIds = {}; misplaced = []; unknown = []; expected = expectedNow(); }
        window.ShelfScan.setHead(headHtml());
        return { text: 'Now on ' + stockSpotLabel(c) };
      }
      var k = normKey(code), hit = items.filter(function (i) { return normKey(i.code) === k || normKey(i.brand) === k; });
      if (!hit.length) {
        if (skipped[k]) return null;
        if (check) { if (unknown.indexOf(code) < 0) unknown.push(code); return { text: code + ' is not in your list', cls: 'bad' }; }
        stockUnknown(code, k); return null;
      }
      var it = hit[0], name = it.brand + (it.flavor ? ' ' + it.flavor : '');
      if (check) {
        if (scannedIds[it.id]) return null;
        scannedIds[it.id] = 1;
        var here = itemHere(it, c);
        if (!here && misplaced.indexOf(it) < 0) misplaced.push(it);
        window.ShelfScan.setHead(headHtml());
        return here ? { text: name + ' is here', cls: 'ok' } : { text: name + ' is listed at ' + (itemSpots(it).map(spotText).join(', ') || 'no spot'), cls: 'bad' };
      }
      if (itemHere(it, c)) return { text: name + ' is already here' };
      if (keepPlaced && hasSpot(it)) return { text: name + ' already has a spot (' + itemSpots(it).map(spotText).join(', ') + '), left as is' };
      var snap = copyRaw(it), upd = typeOnto(placeAt(it, c), c);
      try { save(upd); } catch (err) { toast('Could not save. This phone is out of space.'); return { text: 'Could not save ' + name, cls: 'bad' }; }
      placed++; window.ShelfScan.setHead(headHtml());
      return { text: name + (c.add ? ' added as another place' : ' added'), cls: 'ok', undo: function () { try { save(mk(snap)); placed--; window.ShelfScan.setHead(headHtml()); } catch (err) {} } };
    }, {
      continuous: true, doneText: 'Done', head: headHtml(),
      onDone: function () {
        stockCtl = null; saveLastSpot(c);
        if (check) { showCheckReport(c, expected, scannedIds, misplaced, unknown); return; }
        toast(placed + ' bottle' + (placed === 1 ? '' : 's') + ' put on ' + stockSpotLabel(c) + (unknown.length ? '. ' + unknown.length + ' not in your list: ' + unknown.slice(0, 3).join(', ') + (unknown.length > 3 ? '...' : '') : ''));
        openStock('stock');
      }
    });
  });
  /* Shelf labels: one QR per shelf, to print and stick on the shelf. Scanning it picks that spot. */
  var qrPromise = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrPromise) qrPromise = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/qr/qrcode.js';
      s.onload = function () { res(window.qrcode); }; s.onerror = function () { qrPromise = null; rej(new Error('qr')); };
      document.head.appendChild(s);
    });
    return qrPromise;
  }
  function qrSvg(text) { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ scalable: true, margin: 0 }); }
  function labelList(mapId) {
    var m = window.ShelfMap.mapOf(mapId), out = [];
    ((m && m.zones) || []).forEach(function (z) {
      var shelfy = z.kind !== 'flat' && z.kind !== 'low', n = shelfy ? (z.shelves || 5) : 0, k;
      if (!shelfy) out.push({ section: z.name, shelf: '' });
      else for (k = 1; k <= n; k++) out.push({ section: z.name, shelf: String(k) });
    });
    out.sort(function (a, b) { return cmp(a.section, b.section) || cmp(a.shelf, b.shelf); });
    return out;
  }
  function openLabels() {
    if (!window.ShelfMap) return;
    var ms = window.ShelfMap.maps(), ov = document.createElement('div'); ov.className = 'printov';
    function body(id) {
      var list = labelList(id);
      if (!list.length) return '<p class="hint">This map has no sections yet. Draw some in Edit sections first.</p>';
      return '<div class="labgrid">' + list.map(function (l) {
        return '<div class="lab">' + qrSvg(labelText(id, l.section, l.shelf)) + '<b>' + esc(l.section) + '</b><span>' + (l.shelf === '' ? '&nbsp;' : 'Shelf ' + esc(l.shelf)) + '</span></div>';
      }).join('') + '</div>';
    }
    ov.innerHTML = '<div class="noprint pbar"><button class="btn" type="button" data-pgo>Print</button><button class="btn ghost" type="button" data-pclose>Close</button></div>' +
      (ms.length > 1 ? '<div class="noprint"><label class="hint" for="labMap">Map</label> <select id="labMap">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</select></div>' : '') +
      '<h2>Shelf labels</h2><p class="hint noprint">Print, cut and stick one on each shelf. Scan it in Stock a shelf, Check a shelf, or the Find scanner to jump to that shelf.</p><div id="labBody"><p class="hint">Making labels...</p></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target.closest('[data-pclose]')) ov.remove();
      else if (e.target.closest('[data-pgo]')) { try { window.print(); } catch (err) {} }
    });
    var cur = 'main';
    function draw() { $('#labBody').innerHTML = body(cur); }
    loadQR().then(draw, function () { $('#labBody').innerHTML = '<p class="hint">Could not load the label maker. Check the connection and try again.</p>'; });
    var sel = ov.querySelector('#labMap'); if (sel) sel.addEventListener('change', function () { cur = sel.value; draw(); });
  }
  $('#labelsBtn').addEventListener('click', openLabels);
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
  var APP_VERSION = 'v78';
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
