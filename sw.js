const CACHE_NAME = '52wav-v6';
const POSTER_CACHE = '52wav-posters-v1';
const POSTER_LIMIT = 80;
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './data/peaks.json',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './offline.html'
];

const isPoster = (url) =>
  url.hostname === 'services.arcgisonline.com' && url.pathname.includes('/World_Imagery/MapServer/export');

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== POSTER_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function cachePoster(request) {
  const cache = await caches.open(POSTER_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  cache.put(request, response.clone()).then(async () => {
    const keys = await cache.keys();
    if (keys.length > POSTER_LIMIT) await cache.delete(keys[0]);
  });
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Summit still images are stable, so they are worth keeping between visits.
  if (isPoster(url)) {
    event.respondWith(cachePoster(event.request).catch(() => fetch(event.request)));
    return;
  }

  // Weather, radar, map tiles and the MapLibre CDN must stay live; leave them to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => caches.match('./offline.html'));
    })
  );
});
