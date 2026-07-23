import "../../_helpers/contract-init.ts";
// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import type { BuildManifest } from "../../../src/build/production-build/index.ts";
import type { ChunkInfo } from "../../../src/build/bundler/code-splitter/types.ts";
import { generateServiceWorker } from "../../../src/server/build-service-worker.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

function createTestManifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return {
    version: "2.0.0",
    buildTime: "2024-01-01T00:00:00.000Z",
    features: {
      streaming: true,
      codeSplitting: false,
      clientRouting: true,
      prefetching: false,
      compression: false,
    },
    routes: [],
    chunks: null,
    stats: {
      pages: 0,
      chunks: 0,
      assets: 0,
      totalSize: "0.00 MB",
    },
    ...overrides,
  };
}

function createChunkInfo(file: string, overrides: Partial<ChunkInfo> = {}): ChunkInfo {
  return {
    name: file,
    file,
    imports: [],
    size: 0,
    hash: "test-hash",
    ...overrides,
  };
}

function extractCacheVersion(source: string): string | null {
  const match = source.match(/const CACHE_VERSION = '([^']+)'/);
  return match?.[1] ?? null;
}

function extractStaticCacheUrls(source: string): string[] {
  const match = source.match(/STATIC_CACHE_URLS = (\[[\s\S]*?\]);/);
  return JSON.parse(match?.[1] ?? "[]") as string[];
}

// Note: sanitizeOps and sanitizeResources disabled because global module caches
// create background intervals that persist across tests (LRU cleanup timers).
describe(
  "Service Worker Generation",
  {
    sanitizeOps: false,
    sanitizeResources: false,
  },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("generateServiceWorker()", () => {
      it("should generate valid service worker code", () => {
        const manifest = createTestManifest({
          routes: [{ path: "/", slug: "index", chunks: [] }],
        });
        const code = generateServiceWorker(manifest);

        assert(typeof code === "string");
        assert(code.length > 0);
      });

      it("should include cache version constant", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(
          code.includes(
            "const CACHE_VERSION = 'veryfront-sw-2.0.0-2024-01-01T000000.000Z'",
          ),
        );
      });

      it("should include runtime cache constant", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`"));
      });

      it("should include static cache URLs", () => {
        const code = generateServiceWorker(createTestManifest());
        const urls = extractStaticCacheUrls(code);

        assert(code.includes("STATIC_CACHE_URLS"));
        assert(!urls.includes("/"));
        assert(urls.includes("/_veryfront/router.js"));
        assert(urls.includes("/_veryfront/prefetch.js"));
        assert(urls.includes("/_veryfront/manifest.json"));
        assert(!urls.includes("/sw.js"));
      });

      it("should include manifest assets in static cache", () => {
        const manifest = createTestManifest({
          routes: [{ path: "/", slug: "index", chunks: ["chunks/home-abc123.js"] }],
          chunks: {
            version: "1",
            routes: {
              "/": {
                entry: "chunks/home-abc123.js",
                chunks: ["chunks/home-abc123.js"],
              },
            },
            chunks: {
              "chunks/home-abc123.js": createChunkInfo("chunks/home-abc123.js", {
                css: "chunks/home-abc123.css",
                imports: ["chunks/vendor-xyz.js"],
              }),
            },
            shared: ["chunks/shared-1.js"],
          },
        });

        const code = generateServiceWorker(manifest);

        assert(code.includes('"/_veryfront/chunks/home-abc123.js"'));
        assert(code.includes('"/_veryfront/chunks/home-abc123.css"'));
        assert(code.includes('"/_veryfront/chunks/vendor-xyz.js"'));
        assert(code.includes('"/_veryfront/chunks/shared-1.js"'));
      });

      it("should define explicit cache eligibility checks", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("function isCacheableRequest"));
        assert(code.includes("function isCacheableResponse"));
        assert(code.includes("STATIC_CACHE_PATHS.has(url.pathname)"));
      });

      it("should not intercept API or data routes", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(!extractStaticCacheUrls(code).some((path) => path.startsWith("/api/")));
        assert(
          !extractStaticCacheUrls(code).some((path) => path.startsWith("/_veryfront/data/")),
        );
      });

      it("should serve only manifest-listed assets from cache", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("STATIC_CACHE_PATHS.has(url.pathname)"));
        assert(code.includes("const cached = await cache.match(request)"));
        assert(code.includes("if (cached) return cached"));
      });

      it("should not broadly cache HTML or extension-matched routes", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(!code.includes("staleWhileRevalidate"));
        assert(!code.includes(".html$"));
        assert(!code.includes("png|jpg"));
      });

      it("should include install event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('install'"));
        assert(code.includes("event.waitUntil"));
        assert(code.includes("precacheAssets()"));
        assert(code.includes("caches.open(RUNTIME_CACHE)"));
        assert(code.includes("self.skipWaiting()"));
      });

      it("should include activate event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('activate'"));
        assert(code.includes("caches.keys()"));
        assert(code.includes("caches.delete(name)"));
        assert(code.includes("self.clients.claim()"));
      });

      it("should include cache cleanup in activate", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("name.startsWith('veryfront-sw-')"));
        assert(code.includes("name !== RUNTIME_CACHE"));
      });

      it("should include fetch event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('fetch'"));
        assert(code.includes("event.respondWith"));
        assert(code.includes("handleRequest(event)"));
      });

      it("should skip non-GET requests in fetch handler", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("request.method !== 'GET'"));
      });

      it("should skip cross-origin URLs", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("url.origin !== self.location.origin"));
      });

      it("should include handleRequest function", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("async function handleRequest(event)"));
        assert(code.includes("caches.open(RUNTIME_CACHE)"));
      });

      it("should reject private and uncacheable network responses", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("cacheDirectives.has('private')"));
        assert(code.includes("cacheDirectives.has('no-store')"));
        assert(code.includes("response.headers.has('set-cookie')"));
      });

      it("should implement cache-first delivery for approved assets", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("STATIC_CACHE_PATHS.has(url.pathname)"));
        assert(code.includes("const cached = await cache.match(request)"));
        assert(code.includes("if (cached) return cached"));
      });

      it("should keep background cache writes alive", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("event.waitUntil(cache.put(request, response.clone())"));
        assert(code.includes(".catch(() => undefined)"));
      });

      it("should include message event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('message'"));
        assert(code.includes("event.data?.type === 'SKIP_WAITING'"));
      });

      it("should include generation timestamp comment", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("Generated at:"));
        assert(/\d{4}-\d{2}-\d{2}/.test(code));
      });

      it("should handle empty manifest", () => {
        const code = generateServiceWorker(createTestManifest());

        assertEquals(typeof code, "string");
        assert(code.length > 100);
      });

      it("should handle manifest with routes", () => {
        const manifest = createTestManifest({
          routes: [
            { path: "/home", slug: "home", chunks: [] },
            { path: "/about", slug: "about", chunks: [] },
            { path: "/contact", slug: "contact", chunks: [] },
          ],
        });
        const code = generateServiceWorker(manifest);

        assertEquals(typeof code, "string");
      });

      it("should generate self-contained service worker", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(!code.includes("import "));
        assert(!code.includes("require("));
        assert(code.includes("self.addEventListener"));
        assert(code.includes("async function"));
      });

      it("should use proper ES syntax", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("const "));
        assert(code.includes("await "));
        assert(code.includes("async "));
        assert(code.includes("=>"));
      });
    });

    describe("Service Worker - Edge Cases", () => {
      it("should handle empty manifest gracefully", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener"));
        assert(code.includes("CACHE_VERSION"));
        assert(code.includes("RUNTIME_CACHE"));
        assertEquals(typeof code, "string");
        assert(code.length > 500);
      });

      it("should handle manifest with missing routes property", () => {
        const code = generateServiceWorker(createTestManifest({ routes: [] }));

        assert(code.includes("STATIC_CACHE_URLS"));
        assert(code.includes("handleRequest"));
        assertEquals(typeof code, "string");
      });

      it("should handle manifest with null chunks", () => {
        const code = generateServiceWorker(createTestManifest({ chunks: null }));

        assert(code.includes("self.addEventListener"));
        assert(code.includes("CACHE_VERSION"));
        assertEquals(typeof code, "string");
        assert(code.length > 500);
      });

      it("should pass navigation requests through to the network", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(!extractStaticCacheUrls(code).includes("/"));
        assert(code.includes("STATIC_CACHE_PATHS.has(url.pathname)"));
      });

      it("should apply cache-first delivery to manifest assets", () => {
        const code = generateServiceWorker(
          createTestManifest({
            routes: [{ path: "/", slug: "index", chunks: ["app.js"] }],
          }),
        );

        assert(extractStaticCacheUrls(code).includes("/_veryfront/chunks/app.js"));
        assert(code.includes("const cached = await cache.match(request)"));
        assert(code.includes("if (cached) return cached"));
      });

      it("should pass API and dynamic content through", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(!extractStaticCacheUrls(code).includes("/api/data"));
        assert(!extractStaticCacheUrls(code).includes("/page.html"));
        assert(!code.includes("staleWhileRevalidate"));
      });

      it("should call skipWaiting immediately on install", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('install'"));
        assert(code.includes("self.skipWaiting()"));

        const installIndex = code.indexOf("addEventListener('install'");
        const skipWaitingIndex = code.indexOf("self.skipWaiting()");
        assert(skipWaitingIndex > installIndex);
      });

      it("should call clients.claim on activate", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('activate'"));
        assert(code.includes("self.clients.claim()"));

        const activateIndex = code.indexOf("addEventListener('activate'");
        const claimIndex = code.indexOf("self.clients.claim()");
        assert(claimIndex > activateIndex);
      });

      it("should cleanup old caches on activate", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("caches.keys()"));
        assert(code.includes("name.startsWith('veryfront-sw-')"));
        assert(code.includes("name !== RUNTIME_CACHE"));
        assert(code.includes("caches.delete(name)"));
        assert(code.includes("Promise.all"));
      });

      it("should pass through non-GET requests", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("request.method !== 'GET'"));

        const methodCheckIndex = code.indexOf("request.method !== 'GET'");
        const returnIndex = code.indexOf("return", methodCheckIndex);
        assert(returnIndex > methodCheckIndex);
        assert(returnIndex < methodCheckIndex + 50);
      });

      it("should ignore every cross-origin URL", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("new URL(request.url)"));
        assert(code.includes("url.origin !== self.location.origin"));

        const originCheckIndex = code.indexOf("url.origin !== self.location.origin");
        const returnIndex = code.indexOf("return", originCheckIndex);
        assert(returnIndex > originCheckIndex);
      });

      it("should consult the cache before starting a network request", () => {
        const code = generateServiceWorker(createTestManifest());

        const cacheIndex = code.indexOf("await cache.match(request)");
        const fetchIndex = code.indexOf("await fetch(request)", cacheIndex);
        assert(cacheIndex >= 0);
        assert(fetchIndex > cacheIndex);
      });

      it("should create a versioned runtime cache for build assets", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`"));
        assert(code.includes("caches.open(RUNTIME_CACHE)"));
        assert(code.includes("name !== RUNTIME_CACHE"));
      });

      it("should use versioned cache names", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(
          code.includes(
            "const CACHE_VERSION = 'veryfront-sw-2.0.0-2024-01-01T000000.000Z'",
          ),
        );
        assert(code.includes("const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`"));
        assert(code.includes("caches.open(RUNTIME_CACHE)"));
        assert(code.includes("name !== RUNTIME_CACHE"));
      });

      it("should bump cache version when manifest changes", () => {
        const firstCode = generateServiceWorker(
          createTestManifest({ buildTime: "2024-01-01T00:00:00.000Z" }),
        );
        const secondCode = generateServiceWorker(
          createTestManifest({ buildTime: "2024-02-02T00:00:00.000Z" }),
        );

        const firstVersion = extractCacheVersion(firstCode);
        const secondVersion = extractCacheVersion(secondCode);

        assert(firstVersion && secondVersion);
        assert(firstVersion !== secondVersion);
      });

      it("should store only complete and explicitly public responses", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("response.status !== 200"));
        assert(code.includes("cacheDirectives.has('public')"));
        assert(code.includes("cacheDirectives.has('private')"));
        assert(code.includes("cache.put(request, response.clone())"));
      });
    });
  },
);
