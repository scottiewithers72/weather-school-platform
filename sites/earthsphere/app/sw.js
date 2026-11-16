// Companion app service worker: app shell + lesson pictures cached for offline practice.
// Activity text is stored by the app itself (localStorage); API calls always go to the network.
const SHELL_CACHE = 'companion-shell-v10';
const MEDIA_CACHE = 'companion-media-v1';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/app-engine.js', '/app/manifest.json',
               '/app/icon-192.png', '/app/icon-512.png', '/app/media/common/finish-week.jpg',
               '/app/media/common/finish-graduation.jpg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE)
    .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => ![SHELL_CACHE, MEDIA_CACHE].includes(k)).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;                       // always live
  if (url.pathname.startsWith('/app/media/')) {                       // pictures: cache-first
    e.respondWith(caches.open(MEDIA_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/app/')) {                             // shell: network-first, fall back to cache
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(async () => (await caches.match(e.request)) || caches.match('/app/index.html')));
  }
});
