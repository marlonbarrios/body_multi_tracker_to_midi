// Service worker: makes Body Multi-Tracker installable as a Chrome app and lets it start offline.
// App files: network first (so edits show up), cache as fallback.
// Libraries + the pose model from CDNs: cache first (they're versioned and big).
const CACHE = 'bmt-v8';
const APP = ['./', 'index.html', 'sketch.js', 'points.js', 'pose.js', 'midi.js', 'notes.js', 'mapping.js', 'osc.js', 'ui.js',
  'manifest.webmanifest', 'favicon.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // 'no-cache' = always ask the server if there's a newer file (cheap: unchanged files answer
    // "not modified"), so a push to GitHub shows up on the next reload, not after the 10-min cache.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|storage\.googleapis\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
