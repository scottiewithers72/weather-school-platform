// Service worker — app shell cache; API and video always go to network.
const CACHE = 'earthsphere-app-v1';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/app-engine.js',
               '/app/manifest.json', '/assets/logo-earthsphere.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.origin.includes('mediadelivery')) return; // network only
  e.respondWith(
    caches.match(e.request).then((hit) => hit ||
      fetch(e.request).then((res) => {
        if (e.request.method === 'GET' && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('/app/index.html'))
    )
  );
});
