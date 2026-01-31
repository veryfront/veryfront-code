// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import type { BuildManifest } from "../../../src/build/production-build/index.ts";
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

function extractCacheVersion(source: string): string | null {
  const match = source.match(/const CACHE_VERSION = '([^']+)'/);
  return match?.[1] ?? null;
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
            "const CACHE_VERSION = 'veryfront-2.0.0-2024-01-01T000000.000Z'",
          ),
        );
      });

      it("should include runtime cache constant", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("const RUNTIME_CACHE = 'veryfront-runtime'"));
      });

      it("should include static cache URLs", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("STATIC_CACHE_URLS"));
        assert(code.includes('"/"'));
        assert(code.includes('"/_veryfront/router.js"'));
        assert(code.includes('"/_veryfront/prefetch.js"'));
        assert(code.includes('"/_veryfront/manifest.json"'));
        assert(code.includes('"/sw.js"'));
      });

      it("should include manifest assets in static cache", () => {
        const manifest = createTestManifest({
          routes: [{ path: "/", slug: "index", chunks: ["chunks/home-abc123.js"] }],
          chunks: {
            version: "1",
            routes: { "/": { chunks: ["chunks/home-abc123.js"] } },
            chunks: {
              "chunks/home-abc123.js": {
                file: "chunks/home-abc123.js",
                css: "chunks/home-abc123.css",
                imports: ["chunks/vendor-xyz.js"],
              },
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

      it("should define cache strategies object", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("CACHE_STRATEGIES"));
        assert(code.includes("networkFirst"));
        assert(code.includes("cacheFirst"));
        assert(code.includes("staleWhileRevalidate"));
      });

      it("should include networkFirst strategy for API routes", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("networkFirst:"));
        assert(code.includes("/\\/api\\//"));
        assert(code.includes("/\\/_veryfront\\/data\\//"));
      });

      it("should include cacheFirst strategy for assets", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("cacheFirst:"));
        assert(code.includes("png") && code.includes("jpg") && code.includes("webp"));
        assert(code.includes("/\\/_veryfront\\/chunks\\//"));
        assert(code.includes("/\\/assets\\//"));
      });

      it("should include staleWhileRevalidate strategy for code/HTML", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("staleWhileRevalidate:"));
        assert(code.includes("js|css"));
        assert(code.includes(".html"));
      });

      it("should include install event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('install'"));
        assert(code.includes("event.waitUntil"));
        assert(code.includes("caches.open(CACHE_VERSION)"));
        assert(code.includes("cache.addAll(STATIC_CACHE_URLS)"));
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

        assert(code.includes("name !== CACHE_VERSION"));
        assert(code.includes("name !== RUNTIME_CACHE"));
      });

      it("should include fetch event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('fetch'"));
        assert(code.includes("event.respondWith"));
        assert(code.includes("handleRequest(request, strategy)"));
      });

      it("should skip non-GET requests in fetch handler", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("request.method !== 'GET'"));
      });

      it("should skip chrome-extension URLs", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("url.protocol === 'chrome-extension:'"));
      });

      it("should include handleRequest function", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("async function handleRequest(request, strategy)"));
        assert(code.includes("caches.open(RUNTIME_CACHE)"));
      });

      it("should implement networkFirst strategy", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("case 'networkFirst':"));
        assert(code.includes("const response = await fetch(request)"));
        assert(code.includes("if (response.ok)"));
        assert(code.includes("cache.put(request, response.clone())"));
        assert(code.includes("return cache.match(request)"));
      });

      it("should implement cacheFirst strategy", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("case 'cacheFirst':"));
        assert(code.includes("const cached = await cache.match(request)"));
        assert(code.includes("if (cached) return cached"));
      });

      it("should implement staleWhileRevalidate strategy", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("case 'staleWhileRevalidate':"));
        assert(code.includes("const cachedResponse = await cache.match(request)"));
        assert(code.includes("const fetchPromise = fetch(request)"));
        assert(code.includes("return cachedResponse || fetchPromise"));
      });

      it("should include message event listener", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("self.addEventListener('message'"));
        assert(code.includes("event.data.type === 'SKIP_WAITING'"));
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

      it("should apply networkFirst strategy to navigation requests", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("let strategy = 'networkFirst'"));
        assert(code.includes("case 'networkFirst':"));
        assert(code.includes("const response = await fetch(request)"));
        assert(code.includes("return cache.match(request)"));
      });

      it("should apply cacheFirst strategy to static assets", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("png|jpg|jpeg|svg|gif|webp"));
        assert(code.includes("/\\/_veryfront\\/chunks\\//"));
        assert(code.includes("case 'cacheFirst':"));
        assert(code.includes("const cached = await cache.match(request)"));
        assert(code.includes("if (cached) return cached"));
      });

      it("should apply staleWhileRevalidate for API calls and dynamic content", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("js|css"));
        assert(code.includes(".html"));
        assert(code.includes("case 'staleWhileRevalidate':"));
        assert(code.includes("return cachedResponse || fetchPromise"));
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
        assert(code.includes("name !== CACHE_VERSION"));
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

      it("should ignore chrome-extension URLs", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("new URL(request.url)"));
        assert(code.includes("url.protocol === 'chrome-extension:'"));

        const protocolCheckIndex = code.indexOf("url.protocol === 'chrome-extension:'");
        const returnIndex = code.indexOf("return", protocolCheckIndex);
        assert(returnIndex > protocolCheckIndex);
      });

      it("should handle fetch errors gracefully in networkFirst", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("case 'networkFirst':"));

        const networkFirstIndex = code.indexOf("case 'networkFirst':");
        const tryIndex = code.indexOf("try", networkFirstIndex);
        const catchIndex = code.indexOf("catch", tryIndex);

        assert(tryIndex > networkFirstIndex);
        assert(catchIndex > tryIndex);
        assert(code.includes("return cache.match(request)"));
      });

      it("should create runtime cache for dynamic content", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(code.includes("const RUNTIME_CACHE = 'veryfront-runtime'"));
        assert(code.includes("caches.open(RUNTIME_CACHE)"));
        assert(code.includes("name !== RUNTIME_CACHE"));
      });

      it("should use versioned cache names", () => {
        const code = generateServiceWorker(createTestManifest());

        assert(
          code.includes(
            "const CACHE_VERSION = 'veryfront-2.0.0-2024-01-01T000000.000Z'",
          ),
        );
        assert(code.includes("caches.open(CACHE_VERSION)"));
        assert(code.includes("name !== CACHE_VERSION"));
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

      it("should store responses only when response.ok is true", () => {
        const code = generateServiceWorker(createTestManifest());

        const okChecks = code.match(/if \(response\.ok\)/g);
        assert(okChecks && okChecks.length >= 3, "Should have at least 3 response.ok checks");

        assert(code.includes("cache.put(request, response.clone())"));
      });
    });
  },
);
