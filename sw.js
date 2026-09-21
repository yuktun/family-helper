const CACHE = 'family-helper-static-v19';
const ASSETS = [
  './', './index.html', './styles.css?v=19', './app.js?v=19', './transport-controller.js',
  './transport/index.js', './transport/config.js', './transport/ids.js', './transport/preferences.js',
  './transport/eta.js', './transport/catalog.js', './transport/nearby.js', './transport/mtr-catalog.js',
  './transport/static-catalog.js', './transport/adapters/http.js', './transport/adapters/kmb.js',
  './transport/adapters/ctb.js', './transport/adapters/gmb.js', './transport/adapters/mtr.js',
  './assets/transport-catalog.json', './manifest.webmanifest', './assets/icon.svg',
  './assets/icon-192.png', './assets/icon-512.png',
];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
});
