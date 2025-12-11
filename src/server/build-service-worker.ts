
import type { BuildManifest } from "../build/production-build/manifest.ts";

function sanitizeCacheKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function buildCacheVersion(manifest: BuildManifest): string {
  const manifestVersion = sanitizeCacheKey(manifest.version || "dev");
  const buildStamp = sanitizeCacheKey(manifest.buildTime || new Date().toISOString());
  return `veryfront-${manifestVersion}-${buildStamp}`;
}

function normalizeChunkPath(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return null;

  const candidate = value.replace(/^\.\

  if (candidate.startsWith("/")) {
    return candidate;
  }

  if (candidate.startsWith("_veryfront/")) {
    return `/${candidate}`;
  }

  if (candidate.startsWith("chunks/")) {
    return `/_veryfront/${candidate}`;
  }

  return `${base}/${candidate}`;
}

function buildManifestAssets(manifest: BuildManifest): string[] {
  const assets = new Set<string>([
    "/",
    "/_veryfront/router.js",
    "/_veryfront/prefetch.js",
    "/_veryfront/manifest.json",
    "/sw.js",
  ]);

  const addAsset = (requestPath: string | null | undefined) => {
    if (!requestPath) return;
    const normalized = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
    assets.add(normalized);
  };

  if (manifest.chunks) {
    for (const chunkInfo of Object.values(manifest.chunks.chunks || {})) {
      const chunk = chunkInfo as any;
      addAsset(normalizeChunkPath(chunk.file, "/_veryfront"));
      if (chunk.css) {
        addAsset(normalizeChunkPath(chunk.css, "/_veryfront"));
      }
      for (const dependency of chunk.imports || []) {
        addAsset(normalizeChunkPath(dependency, "/_veryfront/chunks"));
      }
    }

    for (const shared of manifest.chunks.shared || []) {
      addAsset(normalizeChunkPath(shared, "/_veryfront/chunks"));
    }
  }

  for (const route of manifest.routes || []) {
    if (Array.isArray(route.chunks)) {
      for (const chunk of route.chunks) {
        addAsset(normalizeChunkPath(chunk, "/_veryfront/chunks"));
      }
    }
  }

  return Array.from(assets).sort();
}

export function generateServiceWorker(manifest: BuildManifest): string {
  const cacheVersion = buildCacheVersion(manifest);
  const staticAssets = buildManifestAssets(manifest);

  return `// Veryfront Service Worker

const CACHE_VERSION = '${cacheVersion}';
const RUNTIME_CACHE = 'veryfront-runtime';

const STATIC_CACHE_URLS = ${JSON.stringify(staticAssets, null, 2)};

const CACHE_STRATEGIES = {
  networkFirst: [
    /\\/api\\
    /\\/_veryfront\\/data\\
  ],
  cacheFirst: [
    /\\.(?:png|jpg|jpeg|svg|gif|webp|woff2?)$/,
    /\\/_veryfront\\/chunks\\
    /\\/assets\\
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

  if (request.method !== 'GET') return;

  if (url.protocol === 'chrome-extension:') return;

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

self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
`;
}
