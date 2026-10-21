/* Shelf Finder service worker. Same-origin only.
   - Pages, scripts, styles, manifest and the layout file are network-first, so a push shows up on the
     next online open. Offline falls back to the cached copy.
   - Big static files (OCR engine, images) are cache-first, so they are not re-downloaded every time.
   - Only successful same-origin responses are cached. Bump CACHE when changing any cached file. */
var CACHE = 'shelf-finder-v68';
var ASSETS = ['./', './index.html', './style.css', './search.js', './app.js', './photo.js', './scan.js', './map.js', './backup.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function store(req, res) {
  if (res && res.ok && res.type === 'basic') {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var networkFirst = req.mode === 'navigate' || /\/$/.test(url.pathname) || /\.(?:html|js|css|json|webmanifest)$/.test(url.pathname) && url.pathname.indexOf('/vendor/') < 0;
  if (networkFirst) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(function (res) { return store(req, res); })
        .catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (m) { return m || caches.match('./index.html'); }); })
    );
  } else {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { return store(req, res); }); }));
  }
});
