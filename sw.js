// sw.js — offline shell. Bump CACHE when any file below changes; the new worker
// installs, drops older caches, and the app offers a reload.

const CACHE = 'lifting-tracker-v4';

// Served from a local server means someone is working on the app, and the file
// they just saved has to win. The deployed app keeps its offline-first cache.
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/metrics.js',
  './js/charts.js',
  './js/ui.js',
  './js/seed.js',
  './js/timer.js',
  './js/views/plan.js',
  './js/views/log.js',
  './js/views/progress.js',
  './js/views/setup.js',
  './js/views/welcome.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; add individually so one miss cannot break install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // One network attempt, shared between the response and the cache refill.
  const fromNetwork = fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => null);

  // In development the network is the only source of truth.
  if (DEV) {
    event.respondWith(fromNetwork.then((res) => res || caches.match(req).then((hit) => hit || Response.error())));
    return;
  }

  // Navigations: network first so an update lands promptly, cache as the fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fromNetwork.then((res) => res || caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  // Everything else: stale while revalidate. Answer from the cache at once, so
  // the app opens instantly and works with no signal, but always ask the network
  // as well so the NEXT load is current. Plain cache-first never notices that a
  // file changed at all — it will happily serve the first CSS it ever saw until
  // the cache name changes underneath it.
  event.waitUntil(fromNetwork);
  event.respondWith(
    caches.match(req).then((hit) => hit || fromNetwork.then((res) => res || Response.error())),
  );
});
