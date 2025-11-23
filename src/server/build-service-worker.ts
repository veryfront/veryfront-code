/**
 * Service Worker Generation
 */

import type { BuildManifest } from "../build/production-build/manifest.ts";

/**
 * Generate service worker with advanced caching
 */
export function generateServiceWorker(_manifest: BuildManifest): string {
  return `// Veryfront Service Worker
// Generated at: ${new Date().toISOString()}

const CACHE_VERSION = 'veryfront-v2';
const RUNTIME_CACHE = 'veryfront-runtime';

// Static resources to cache
const STATIC_CACHE_URLS = [
  '/',
  '/_veryfront/router.js',
  '/_veryfront/prefetch.js',
  '/_veryfront/manifest.json',
  '/sw.js',
];

// Cache strategies
const CACHE_STRATEGIES = {
  networkFirst: [
    /\\/api\\//,
    /\\/_veryfront\\/data\\//,
  ],
  cacheFirst: [
    /\\.(?:png|jpg|jpeg|svg|gif|webp|woff2?)$/,
    /\\/_veryfront\\/chunks\\//,
    /\\/assets\\//,
  ],
  staleWhileRevalidate: [
    /\\.(?:js|css)$/,
    /\\.html$/,
  ],
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(STATIC_CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name => name !== CACHE_VERSION && name !== RUNTIME_CACHE)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Chrome extensions
  if (url.protocol === 'chrome-extension:') return;

  // Determine cache strategy
  let strategy = 'networkFirst';

  for (const [strat, patterns] of Object.entries(CACHE_STRATEGIES)) {
    if (patterns.some(pattern => pattern.test(url.pathname))) {
      strategy = strat;
      break;
    }
  }

  event.respondWith(handleRequest(request, strategy));
});

async function handleRequest(request, strategy) {
  const cache = await caches.open(RUNTIME_CACHE);

  switch (strategy) {
    case 'networkFirst':
      try {
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cache.match(request);
      }

    case 'cacheFirst':
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;

    case 'staleWhileRevalidate':
      const cachedResponse = await cache.match(request);
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      });

      return cachedResponse || fetchPromise;

    default:
      return fetch(request);
  }
}

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
`;
}
