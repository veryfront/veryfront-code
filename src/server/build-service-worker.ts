import type {
  BuildManifest,
  ManifestChunkInfo,
} from "#veryfront/build/production-build/manifest.ts";
import { normalizeChunkPath } from "./utils/chunk-utils.ts";

function sanitizeCacheKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function sanitizeGeneratedComment(value: string | undefined): string {
  return (value ?? "unknown")
    .replace(/[\r\n\u2028\u2029]/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, 128) || "unknown";
}

function buildCacheVersion(manifest: BuildManifest): string {
  const manifestVersion = sanitizeCacheKey(manifest.version ?? "dev") || "dev";
  const buildStamp = sanitizeCacheKey(manifest.buildTime ?? "unknown") || "unknown";
  return `veryfront-sw-${manifestVersion}-${buildStamp}`;
}

function buildManifestAssets(manifest: BuildManifest): string[] {
  const assets = new Set<string>([
    "/_veryfront/router.js",
    "/_veryfront/prefetch.js",
    "/_veryfront/manifest.json",
  ]);

  const addAsset = (requestPath: string | null | undefined): void => {
    if (!requestPath) return;
    const candidate = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
    let url: URL;
    try {
      url = new URL(candidate, "https://service-worker.invalid");
    } catch {
      return;
    }

    if (
      url.origin !== "https://service-worker.invalid" || url.search || url.hash ||
      (!url.pathname.startsWith("/_veryfront/") && !url.pathname.startsWith("/_vf/assets/"))
    ) {
      return;
    }
    assets.add(url.pathname);
  };

  const chunks = manifest.chunks;
  if (chunks) {
    const chunkList = Object.values(chunks.chunks ?? {}) as ManifestChunkInfo[];
    for (const chunk of chunkList) {
      addAsset(normalizeChunkPath(chunk.file, "/_veryfront"));
      if (chunk.css) addAsset(normalizeChunkPath(chunk.css, "/_veryfront"));

      for (const dependency of chunk.imports ?? []) {
        addAsset(normalizeChunkPath(dependency, "/_veryfront/chunks"));
      }
    }

    for (const shared of chunks.shared ?? []) {
      addAsset(normalizeChunkPath(shared, "/_veryfront/chunks"));
    }
  }

  for (const route of manifest.routes ?? []) {
    if (!Array.isArray(route.chunks)) continue;

    for (const chunk of route.chunks) {
      addAsset(normalizeChunkPath(chunk, "/_veryfront/chunks"));
    }
  }

  return Array.from(assets).sort();
}

export function generateServiceWorker(manifest: BuildManifest): string {
  const cacheVersion = buildCacheVersion(manifest);
  const staticAssets = buildManifestAssets(manifest);
  const generationStamp = sanitizeGeneratedComment(manifest.buildTime);

  return `// Veryfront Service Worker
// Generated at: ${generationStamp}

const CACHE_VERSION = '${cacheVersion}';
const RUNTIME_CACHE = \`${"${CACHE_VERSION}"}-runtime\`;
const LEGACY_RUNTIME_CACHE = 'veryfront-runtime';
const LEGACY_BUILD_CACHE_PATTERN = /^veryfront-(?!sw-)[A-Za-z0-9._-]+-\\d{4}-\\d{2}-\\d{2}T\\d{6}\\.\\d{3}Z$/;

const STATIC_CACHE_URLS = ${JSON.stringify(staticAssets, null, 2)};
const STATIC_CACHE_PATHS = new Set(STATIC_CACHE_URLS);
const PRECACHE_CONCURRENCY = 8;

function isCacheableRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (!STATIC_CACHE_PATHS.has(url.pathname)) return false;
  if (url.search || url.hash) return false;
  if (request.headers.has('authorization') || request.headers.has('range')) return false;
  if (request.cache === 'no-store' || request.cache === 'reload') return false;
  return true;
}

function isCacheableResponse(response) {
  if (!response || response.status !== 200 || response.redirected) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;

  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  const cacheDirectives = new Set(cacheControl
    .split(',')
    .map(value => value.trim().split('=', 1)[0]));
  if (!cacheDirectives.has('public') && !cacheDirectives.has('immutable')) return false;
  if (cacheDirectives.has('private')) return false;
  if (cacheDirectives.has('no-store')) return false;
  if (cacheDirectives.has('no-cache')) return false;
  if (response.headers.has('set-cookie')) return false;

  const vary = (response.headers.get('vary') || '').toLowerCase()
    .split(',')
    .map(value => value.trim());
  if (vary.includes('*') || vary.includes('authorization') || vary.includes('cookie')) return false;
  return true;
}

async function precacheAssets() {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    for (let index = 0; index < STATIC_CACHE_URLS.length; index += PRECACHE_CONCURRENCY) {
      const batch = STATIC_CACHE_URLS.slice(index, index + PRECACHE_CONCURRENCY);
      await Promise.all(batch.map(async path => {
        const request = new Request(new URL(path, self.location.origin), {
          credentials: 'same-origin',
        });
        const response = await fetch(request);
        if (!isCacheableResponse(response)) {
          throw new TypeError('Static asset is not safely cacheable');
        }
        await cache.put(request, response);
      }));
    }
  } catch (error) {
    await caches.delete(RUNTIME_CACHE);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAssets()
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name =>
            (name.startsWith('veryfront-sw-') && name !== RUNTIME_CACHE) ||
            name === LEGACY_RUNTIME_CACHE || LEGACY_BUILD_CACHE_PATTERN.test(name)
          )
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!isCacheableRequest(request, url)) return;
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const { request } = event;
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    event.waitUntil(cache.put(request, response.clone()).catch(() => undefined));
  }
  return response;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
`;
}
