/* Shelf Finder search. Precise on purpose: every word you type must match the START of a word in
   the bottle (so "bea" finds Beam but "bean" never finds Beam), brand and flavor count most, and
   notes/description count least. Spelling guesses are offered only when nothing matches, and are
   shown as a suggestion, never mixed into the results. */
(function (root) {
  'use strict';
  var FW = { brand: 4, flavor: 3, type: 1.5, size: 1, notes: 1, section: 0.8, shelf: 0.5 };

  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/['’`]/g, '').replace(/(\d)\s+(ml|cl|l|oz|pk|pack)\b/g, '$1$2');
  }
  function words(s) {
    return norm(s).split(/[^a-z0-9.]+/).map(function (w) { return w.replace(/^\.+|\.+$/g, ''); }).filter(Boolean);
  }
  function prepare(it) {
    var out = [], flat = {};
    Object.keys(FW).forEach(function (f) { words(it[f]).forEach(function (w) { out.push({ w: w, f: f }); }); });
    it._w = out;
    it._name = words(it.brand + ' ' + it.flavor).join(' ');
    return it;
  }
  function tokens(q) { return words(q); }

  function score(it, toks, phrase) {
    if (!it._w) prepare(it);
    var total = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], best = 0;
      for (var j = 0; j < it._w.length; j++) {
        var x = it._w[j], s = 0;
        if (x.w === t) s = 3 * FW[x.f];
        else if (x.w.indexOf(t) === 0) s = 1.5 * FW[x.f];
        if (s > best) best = s;
      }
      if (!best) return 0;
      total += best;
    }
    if (toks.length > 1 && (' ' + it._name + ' ').indexOf(' ' + phrase) >= 0) total += 4;
    return total;
  }

  function run(items, q) {
    var toks = tokens(q);
    if (!toks.length) return items.map(function (it) { return { it: it, s: 0 }; });
    var phrase = toks.join(' '), out = [];
    items.forEach(function (it) { var s = score(it, toks, phrase); if (s > 0) out.push({ it: it, s: s }); });
    out.sort(function (a, b) { return b.s - a.s || String(a.it.brand).localeCompare(String(b.it.brand), undefined, { numeric: true, sensitivity: 'base' }) || String(a.it.flavor).localeCompare(String(b.it.flavor), undefined, { numeric: true, sensitivity: 'base' }); });
    return out;
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* Only for a search with no results: a corrected spelling that does have results, or ''. */
  function didYouMean(items, q) {
    var toks = tokens(q);
    if (!toks.length) return '';
    var vocab = {};
    items.forEach(function (it) {
      if (!it._w) prepare(it);
      it._w.forEach(function (x) { if (x.f === 'brand' || x.f === 'flavor' || x.f === 'type') vocab[x.w] = (vocab[x.w] || 0) + 1; });
    });
    var keys = Object.keys(vocab), fixed = toks.map(function (t) {
      if (t.length < 3) return t;
      for (var k = 0; k < keys.length; k++) if (keys[k].indexOf(t) === 0) return t;
      var max = t.length >= 8 ? 2 : 1, best = null, bd = 99, bc = 0;
      keys.forEach(function (w) {
        var d = lev(t, w, max);
        if (d <= max && (d < bd || (d === bd && vocab[w] > bc))) { best = w; bd = d; bc = vocab[w]; }
      });
      return best || t;
    });
    var s = fixed.join(' ');
    return s !== toks.join(' ') && run(items, s).length ? s : '';
  }

  /* Highlight only the start of the words that matched. */
  function highlight(text, toks, esc) {
    text = String(text == null ? '' : text);
    if (!toks.length) return esc(text);
    var out = '', last = 0, m, re = /[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’.]*/g;
    while ((m = re.exec(text))) {
      var nw = norm(m[0]).replace(/^\.+|\.+$/g, ''), hit = 0;
      for (var i = 0; i < toks.length; i++) if (nw.indexOf(toks[i]) === 0 && toks[i].length > hit) hit = toks[i].length;
      if (!hit) continue;
      var plain = m[0].replace(/['’]/g, '').length === m[0].length;
      var len = plain ? Math.min(hit, m[0].length) : m[0].length;
      out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0].slice(0, len)) + '</mark>';
      last = m.index + len;
    }
    return out + esc(text.slice(last));
  }

  var api = { prepare: prepare, tokens: tokens, run: run, didYouMean: didYouMean, highlight: highlight, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShelfSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
