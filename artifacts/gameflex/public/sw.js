/* Service Worker for GameFlex — offline caching and background sync
   Simple cache-first strategy for static assets and network-first for API/navigation
*/
const CACHE_NAME = 'gameflex-static-v1';
const RUNTIME = 'gameflex-runtime';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== RUNTIME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Always try cache first for known precached resources
  if (PRECACHE_URLS.includes(new URL(request.url).pathname)) {
    event.respondWith(caches.match(request).then((r) => r || fetch(request)));
    return;
  }

  // Navigation requests: network-first with fallback to cache
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(RUNTIME).then((cache) => cache.put(request, copy));
        return resp;
      }).catch(() => caches.match(request).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // For other GET requests, use cache-first then network and put into runtime cache
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(RUNTIME).then((cache) => cache.put(request, copy));
        return resp;
      }).catch(() => cached))
    );
  }
});

self.addEventListener('sync', (event) => {
  // Placeholder for background sync tasks; apps can postMessage to the SW to queue work.
  // Example tag handling could be added here when background sync is required.
});

self.addEventListener('message', (event) => {
  // Allow clients to trigger skipWaiting
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
