// NovaVista Service Worker
// Cache-first strategy for the app shell, network-first for API calls
// Update this version string whenever you deploy a new version of index.html

const CACHE_NAME    = 'novavista-v1';
const OFFLINE_URL   = '/';

// Files to cache immediately on install (the app shell)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// CDN scripts to cache (loaded by index.html)
const CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache local files
      await cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Failed to pre-cache some local URLs:', err);
      });
      // Cache CDN scripts individually (don't fail install if one is slow)
      for (const url of CDN_URLS) {
        await cache.add(url).catch(err => {
          console.warn('[SW] Failed to pre-cache CDN URL:', url, err);
        });
      }
    })
  );
  // Take control immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    )
  );
  // Claim all open clients so new SW activates immediately
  self.clients.claim();
});

// ── Fetch: smart caching strategy ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // NEVER cache: Anthropic API, Ollama, or any POST request
  if (
    url.hostname === 'api.anthropic.com' ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    event.request.method !== 'GET'
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // NEVER cache: Google Fonts CSS (changes frequently)
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // CDN scripts & Google Fonts files: cache-first (they don't change)
  if (
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell (index.html, manifest, icons):
  // Network-first so updates deploy immediately; fall back to cache offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests, serve the app shell
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── Background sync: notify when a new version is available ──────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
