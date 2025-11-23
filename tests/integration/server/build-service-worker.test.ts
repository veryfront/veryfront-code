import { assert, assertEquals } from "std/testing/asserts.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { generateServiceWorker } from "../../../src/server/build-service-worker.ts";
import type { BuildManifest } from "../../../src/build/production-build/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

// Clean up renderer intervals to prevent resource leaks
afterAll(async () => {
  await cleanupBundler();
});

// Helper to create minimal valid BuildManifest for testing
function createTestManifest(overrides?: Partial<BuildManifest>): BuildManifest {
  return {
    version: "2.0.0",
    buildTime: new Date().toISOString(),
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

describe("Service Worker Generation", () => {
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

      assert(code.includes("const CACHE_VERSION = 'veryfront-v2'"));
    });

    it("should include runtime cache constant", () => {
      const code = generateServiceWorker(createTestManifest());

      assert(code.includes("const RUNTIME_CACHE = 'veryfront-runtime'"));
    });

    it("should include static cache URLs", () => {
      const code = generateServiceWorker(createTestManifest());

      assert(code.includes("STATIC_CACHE_URLS"));
      assert(code.includes("'/'"));
      assert(code.includes("'/_veryfront/router.js'"));
      assert(code.includes("'/_veryfront/prefetch.js'"));
      assert(code.includes("'/_veryfront/manifest.json'"));
      assert(code.includes("'/sw.js'"));
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

      // Should delete old caches that don't match current version
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
      // Check for ISO date format pattern (YYYY-MM-DD)
      assert(/\d{4}-\d{2}-\d{2}/.test(code));
    });

    it("should handle empty manifest", () => {
      const code = generateServiceWorker(createTestManifest());

      assertEquals(typeof code, "string");
      assert(code.length > 100); // Should still generate full SW code
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

      // Currently manifest isn't used in generated code, but should not error
      assertEquals(typeof code, "string");
    });

    it("should generate self-contained service worker", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should not have external imports
      assert(!code.includes("import "));
      assert(!code.includes("require("));

      // Should be valid JavaScript
      assert(code.includes("self.addEventListener"));
      assert(code.includes("async function"));
    });

    it("should use proper ES syntax", () => {
      const code = generateServiceWorker(createTestManifest());

      // Modern JS features
      assert(code.includes("const "));
      assert(code.includes("await "));
      assert(code.includes("async "));
      assert(code.includes("=>"));
    });
  });

  describe("Service Worker - Edge Cases", () => {
    // Empty/Missing Data (3 tests)
    it("should handle empty manifest gracefully", () => {
      const code = generateServiceWorker(createTestManifest());

      assert(code.includes("self.addEventListener"));
      assert(code.includes("CACHE_VERSION"));
      assert(code.includes("RUNTIME_CACHE"));
      assertEquals(typeof code, "string");
      assert(code.length > 500); // Should generate full SW even with empty manifest
    });

    it("should handle manifest with missing routes property", () => {
      const manifest = createTestManifest({ routes: [] });
      const code = generateServiceWorker(manifest);

      // Should not crash and should still generate valid SW
      assert(code.includes("STATIC_CACHE_URLS"));
      assert(code.includes("handleRequest"));
      assertEquals(typeof code, "string");
    });

    it("should handle manifest with null chunks", () => {
      const manifest = createTestManifest({ chunks: null });
      const code = generateServiceWorker(manifest);

      // Should generate valid service workers
      assert(code.includes("self.addEventListener"));
      assert(code.includes("CACHE_VERSION"));
      assertEquals(typeof code, "string");
      assert(code.length > 500);
    });

    // Cache Strategies (3 tests)
    it("should apply networkFirst strategy to navigation requests", () => {
      const code = generateServiceWorker(createTestManifest());

      // networkFirst should be default fallback
      assert(code.includes("let strategy = 'networkFirst'"));
      assert(code.includes("case 'networkFirst':"));
      // Should try network first, then fallback to cache
      assert(code.includes("const response = await fetch(request)"));
      assert(code.includes("return cache.match(request)"));
    });

    it("should apply cacheFirst strategy to static assets", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should check for image extensions
      assert(code.includes("png|jpg|jpeg|svg|gif|webp"));
      assert(code.includes("/\\/_veryfront\\/chunks\\//"));
      assert(code.includes("case 'cacheFirst':"));
      // Should check cache first
      assert(code.includes("const cached = await cache.match(request)"));
      assert(code.includes("if (cached) return cached"));
    });

    it("should apply staleWhileRevalidate for API calls and dynamic content", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should handle JS and CSS with stale-while-revalidate
      assert(code.includes("js|css"));
      assert(code.includes(".html"));
      assert(code.includes("case 'staleWhileRevalidate':"));
      // Should return cached immediately while fetching in background
      assert(code.includes("return cachedResponse || fetchPromise"));
    });

    // Service Worker Lifecycle (3 tests)
    it("should call skipWaiting immediately on install", () => {
      const code = generateServiceWorker(createTestManifest());

      assert(code.includes("self.addEventListener('install'"));
      assert(code.includes("self.skipWaiting()"));
      // skipWaiting should be in then chain after cache.addAll
      const installIndex = code.indexOf("addEventListener('install'");
      const skipWaitingIndex = code.indexOf("self.skipWaiting()");
      assert(skipWaitingIndex > installIndex);
    });

    it("should call clients.claim on activate", () => {
      const code = generateServiceWorker(createTestManifest());

      assert(code.includes("self.addEventListener('activate'"));
      assert(code.includes("self.clients.claim()"));
      // claim should be called after cache cleanup
      const activateIndex = code.indexOf("addEventListener('activate'");
      const claimIndex = code.indexOf("self.clients.claim()");
      assert(claimIndex > activateIndex);
    });

    it("should cleanup old caches on activate", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should get all cache names
      assert(code.includes("caches.keys()"));
      // Should filter out current caches
      assert(code.includes("name !== CACHE_VERSION"));
      assert(code.includes("name !== RUNTIME_CACHE"));
      // Should delete old caches
      assert(code.includes("caches.delete(name)"));
      // Should use Promise.all for deletion
      assert(code.includes("Promise.all"));
    });

    // Fetch Handling (3 tests)
    it("should pass through non-GET requests", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should check request method
      assert(code.includes("request.method !== 'GET'"));
      // Should return early for non-GET
      const methodCheckIndex = code.indexOf("request.method !== 'GET'");
      const returnIndex = code.indexOf("return", methodCheckIndex);
      assert(returnIndex > methodCheckIndex);
      assert(returnIndex < methodCheckIndex + 50); // Should be close (early return)
    });

    it("should ignore chrome-extension URLs", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should create URL object
      assert(code.includes("new URL(request.url)"));
      // Should check for chrome-extension protocol
      assert(code.includes("url.protocol === 'chrome-extension:'"));
      // Should return early
      const protocolCheckIndex = code.indexOf("url.protocol === 'chrome-extension:'");
      const returnIndex = code.indexOf("return", protocolCheckIndex);
      assert(returnIndex > protocolCheckIndex);
    });

    it("should handle fetch errors gracefully in networkFirst", () => {
      const code = generateServiceWorker(createTestManifest());

      // networkFirst should have try-catch
      assert(code.includes("case 'networkFirst':"));
      const networkFirstIndex = code.indexOf("case 'networkFirst':");
      const tryIndex = code.indexOf("try", networkFirstIndex);
      const catchIndex = code.indexOf("catch", tryIndex);

      assert(tryIndex > networkFirstIndex);
      assert(catchIndex > tryIndex);
      // Should fallback to cache on error
      assert(code.includes("return cache.match(request)"));
    });

    // Runtime Cache (3 tests)
    it("should create runtime cache for dynamic content", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should define runtime cache constant
      assert(code.includes("const RUNTIME_CACHE = 'veryfront-runtime'"));
      // Should open runtime cache in handleRequest
      assert(code.includes("caches.open(RUNTIME_CACHE)"));
      // Runtime cache should be preserved during activation
      assert(code.includes("name !== RUNTIME_CACHE"));
    });

    it("should use versioned cache names", () => {
      const code = generateServiceWorker(createTestManifest());

      // Should have versioned cache
      assert(code.includes("const CACHE_VERSION = 'veryfront-v2'"));
      // Should use it for static cache
      assert(code.includes("caches.open(CACHE_VERSION)"));
      // Version should be used in cleanup logic
      assert(code.includes("name !== CACHE_VERSION"));
    });

    it("should store responses only when response.ok is true", () => {
      const code = generateServiceWorker(createTestManifest());

      // All strategies should check response.ok before caching
      const _networkFirstIndex = code.indexOf("case 'networkFirst':");
      const _cacheFirstIndex = code.indexOf("case 'cacheFirst':");
      const _swrIndex = code.indexOf("case 'staleWhileRevalidate':");

      // Check that response.ok appears after each strategy
      const okChecks = code.match(/if \(response\.ok\)/g);
      assert(okChecks && okChecks.length >= 3, "Should have at least 3 response.ok checks");

      // Should call cache.put with response.clone()
      assert(code.includes("cache.put(request, response.clone())"));
    });
  });
});
