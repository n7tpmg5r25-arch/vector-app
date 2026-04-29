// Vector | WA Service Worker — Free legislative intelligence for Washington State (lightweight offline shell cache)
// v3 (2026-04-28) — bumped to invalidate old manifest.json + PNG icon caches after PWA app-icon swap to vector-wa-app-icon.svg.
const CACHE_NAME = 'vector-wa-v3';

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

// Fetch — network-first with cache fallback (so data is always fresh when online)
self.addEventListener('fetch', (event) => {
  // Skip non-GET and Supabase API calls (always need fresh data)
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
