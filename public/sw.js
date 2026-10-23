/* Осколок offline shell.
   - Pages: network first; offline falls back to the last saved page shell (the app then opens in offline
     mode with the last profile). Music is not cached here: downloads live in the app's own
     «osk-offline-audio-v1» cache (src/offline/offlineStore.ts), which this worker never deletes.
   - /assets/* (file names carry a content hash): cache first.
   - Icons, fonts, textures: stale-while-revalidate.
   - /api, /downloads, version.json, audio and range requests are never touched. */
const BUILD = '__BUILD_ID__';
const SHELL = `oskolok-shell-${BUILD}`;
const STATIC = `oskolok-static-${BUILD}`;
const PRECACHE = ['/', '/app', '/manifest.webmanifest', '/logo-128.png', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('oskolok-') && k !== SHELL && k !== STATIC).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const bypass = url => url.origin !== self.location.origin || /^\/(api|downloads)(\/|$)/.test(url.pathname) || url.pathname === '/version.json' || url.pathname === '/sw.js';

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (bypass(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(SHELL).then(c => c.put(url.pathname.startsWith('/app') ? '/app' : url.pathname, copy)); }
      return response;
    }).catch(async () => (await caches.match(url.pathname)) || (await caches.match(url.pathname.startsWith('/app') ? '/app' : '/')) || Response.error()));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(STATIC).then(c => c.put(request, copy)); }
      return response;
    })));
    return;
  }
  if (/\.(png|webp|jpg|svg|ico|woff2|webmanifest)$/.test(url.pathname)) {
    event.respondWith(caches.open(STATIC).then(async cache => {
      const hit = await cache.match(request);
      const fresh = fetch(request).then(response => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => hit);
      return hit || fresh;
    }));
  }
});
