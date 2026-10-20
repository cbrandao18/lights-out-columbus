// Keeps the app usable with no signal. Never caches anything sent to the survey.
var CACHE = "collision-log-v6";
var SHELL = ["./", "index.html", "app.js", "config.js", "domains.js", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-512.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png", "vendor/leaflet/images/marker-shadow.png",
  "resources/logo.png", "resources/parking-broad-st.jpg", "resources/parking-nationwide.jpg", "resources/broad-st-route-1.jpg",
  "resources/nationwide-route-1.jpg", "resources/specimen-tag.pdf",
  "cards.html", "vendor/qrcode/qrcode.js", "vendor/jsqr/jsQR.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== CACHE + "-tiles"; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || /arcgis\.com$/.test(url.hostname)) return;
  var isTile = /tile\.openstreetmap\.org$/.test(url.hostname);
  var isOwn = url.origin === self.location.origin;
  if (isOwn) {
    // Network first so updates arrive; cache when offline.
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return r;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); }));
    return;
  }
  // CDN, fonts and map tiles: cache first, keep what we fetch.
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r.ok || r.type === "opaque") { var copy = r.clone(); caches.open(isTile ? CACHE + "-tiles" : CACHE).then(function (c) { c.put(req, copy); }); }
      return r;
    });
  }));
});
