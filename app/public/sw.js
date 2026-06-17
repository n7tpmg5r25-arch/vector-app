// Vector | WA Service Worker — Free legislative intelligence for Washington State (offline shell + fast repeat loads)
// v5 (2026-05-29, T159 perf) — fetch handler is now cache-first for immutable,
// content-hashed static assets (/_next/static, logos, fonts, images) and
// network-first for everything else. v4 was network-first for ALL requests,
// so it gave zero speed benefit online — every JS/CSS chunk still waited on the
// network on every load. Serving fingerprinted assets from cache makes repeat
// loads near-instant; because Next fingerprints those filenames, a cached copy
// is always correct (a new build produces new URLs). Bump invalidates v4.
const CACHE_NAME = 'vector-wa-v5';

// Same-origin assets that are safe to serve cache-first: their URLs are
// content-hashed / immutable, so a cached response can never be stale.
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/logos/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

// Pages and assets to cache for offline shell
const SHELL_ASSETS = [
  '/',
  '/manifest.json',
];

// Install — cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for immutable static assets (fast repeat loads),
// network-first for everything else (HTML/navigation stays fresh).
self.addEventListener('fetch', (event) => {
  // Skip non-GET and Supabase API calls (always need fresh data)
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;

  const url = new URL(event.request.url);
  // Only manage same-origin requests; let the browser handle third-party.
  if (url.origin !== self.location.origin) return;

  // Cache-first: serve the fingerprinted asset from cache instantly, and only
  // hit the network on a cache miss (then store it for next time).
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first with cache fallback for HTML / navigations / other GETs.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
