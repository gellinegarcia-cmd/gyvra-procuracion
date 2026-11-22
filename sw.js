// Service worker mínimo: guarda el "cascarón" de la app para que abra rápido y se pueda instalar.
// NO cachea las llamadas al backend (script.google.com): esas siempre van a internet.
var CACHE = "gyvra-shell-v2";
var SHELL = ["./", "index.html", "fechas.js", "manifest.json", "logo.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Archivos de la app: primero internet (para tener siempre la última versión), si no hay conexión, la copia guardada.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) { var copia = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match("index.html"); });
      })
    );
    return;
  }

  // Íconos de Tabler (CDN): copia guardada primero.
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.match(req).then(function (r) {
        return r || fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) { var copia = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
          return res;
        });
      })
    );
  }
  // Todo lo demás (incluido el backend de Apps Script) pasa directo, sin cache.
});
