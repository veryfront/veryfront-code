import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateServiceWorker } from "./build-service-worker.ts";
import type { BuildManifest } from "#veryfront/build/production-build/manifest.ts";
import type { ChunkInfo } from "#veryfront/build/bundler/code-splitter/types.ts";

function createManifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return {
    version: "1.0.0",
    buildTime: "2025-01-01T00:00:00.000Z",
    features: {
      streaming: true,
      codeSplitting: true,
      clientRouting: true,
      prefetching: true,
      compression: true,
    },
    routes: [],
    chunks: null,
    stats: {
      pages: 1,
      chunks: 0,
      assets: 0,
      totalSize: "0 MB",
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

function extractStaticCacheUrls(output: string): string[] {
  const match = output.match(/STATIC_CACHE_URLS = (\[[\s\S]*?\]);/);
  return JSON.parse(match?.[1] ?? "[]") as string[];
}

interface WorkerHarness {
  listeners: Map<string, (event: unknown) => void>;
  getCacheWrites(): number;
}

function executeGeneratedWorker(
  source: string,
  fetchImpl: (request: Request) => Promise<Response>,
): WorkerHarness {
  const listeners = new Map<string, (event: unknown) => void>();
  let cacheWrites = 0;
  const cache = {
    match: async () => undefined,
    put: async () => {
      cacheWrites++;
    },
  };
  const workerGlobal = {
    location: { origin: "https://app.example" },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
  };
  const cacheStorage = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  };

  new Function("self", "caches", "fetch", source)(
    workerGlobal,
    cacheStorage,
    fetchImpl,
  );

  return { listeners, getCacheWrites: () => cacheWrites };
}

async function dispatchWorkerFetch(
  harness: WorkerHarness,
  request: Request,
): Promise<{ intercepted: boolean; response?: Response; backgroundTasks: number }> {
  const listener = harness.listeners.get("fetch");
  assertExists(listener);
  let responsePromise: Promise<Response> | undefined;
  const background: Promise<unknown>[] = [];

  listener({
    request,
    respondWith: (response: Promise<Response>) => {
      responsePromise = response;
    },
    waitUntil: (task: Promise<unknown>) => {
      background.push(task);
    },
  });

  const response = responsePromise ? await responsePromise : undefined;
  await Promise.all(background);
  return {
    intercepted: responsePromise !== undefined,
    response,
    backgroundTasks: background.length,
  };
}

describe("server/build-service-worker", () => {
  describe("generateServiceWorker", () => {
    describe("output structure", () => {
      it("should return valid JS with install handler", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "self.addEventListener('install'");
      });

      it("should return valid JS with activate handler", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "self.addEventListener('activate'");
      });

      it("should return valid JS with fetch handler", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "self.addEventListener('fetch'");
      });

      it("should return valid JS with message handler", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "self.addEventListener('message'");
      });

      it("should include SKIP_WAITING message handling", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "SKIP_WAITING");
      });
    });

    describe("cache version", () => {
      it("should include version in cache name", () => {
        const output = generateServiceWorker(createManifest({ version: "2.5.0" }));
        assertStringIncludes(output, "veryfront-sw-2.5.0-");
      });

      it("should include buildTime in cache name", () => {
        const output = generateServiceWorker(
          createManifest({ buildTime: "2025-01-01T00:00:00.000Z" }),
        );
        // Colons get stripped by sanitizeCacheKey
        assertStringIncludes(output, "2025-01-01T000000.000Z");
      });

      it("should sanitize special characters from version", () => {
        const output = generateServiceWorker(
          createManifest({ version: "1.0.0-beta+build@special!" }),
        );
        assertStringIncludes(output, "veryfront-sw-1.0.0-betabuildspecial-");
      });

      it("should default to 'dev' when version is undefined", () => {
        const manifest = createManifest();
        // deno-lint-ignore no-explicit-any
        (manifest as any).version = undefined;
        const output = generateServiceWorker(manifest);
        assertStringIncludes(output, "veryfront-sw-dev-");
      });

      it("keeps untrusted build metadata inside the generated comment", () => {
        const output = generateServiceWorker(
          createManifest({ buildTime: "safe\nself.pwned = true" }),
        );

        assertEquals(output.includes("\nself.pwned = true"), false);
        assertStringIncludes(output, "Generated at: safe self.pwned = true");
      });
    });

    describe("default static assets", () => {
      it("does not include the root navigation", () => {
        const output = generateServiceWorker(createManifest());
        assertEquals(extractStaticCacheUrls(output).includes("/"), false);
      });

      it("should always include router.js", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "/_veryfront/router.js");
      });

      it("should always include prefetch.js", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "/_veryfront/prefetch.js");
      });

      it("should always include manifest.json", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "/_veryfront/manifest.json");
      });

      it("does not include the service worker itself", () => {
        const output = generateServiceWorker(createManifest());
        assertEquals(extractStaticCacheUrls(output).includes("/sw.js"), false);
      });
    });

    describe("chunk files from manifest", () => {
      it("should include chunk files from manifest.chunks.chunks", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {
                "entry-main": createChunkInfo("main.js"),
              },
              shared: [],
            },
          }),
        );
        assertStringIncludes(output, "/_veryfront/main.js");
      });

      it("should include CSS files from chunks", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {
                "entry-main": createChunkInfo("main.js", { css: "main.css" }),
              },
              shared: [],
            },
          }),
        );
        assertStringIncludes(output, "/_veryfront/main.css");
      });

      it("should include import dependencies from chunks", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {
                "entry-main": createChunkInfo("main.js", {
                  imports: ["vendor-abc123.js"],
                }),
              },
              shared: [],
            },
          }),
        );
        assertStringIncludes(output, "/_veryfront/chunks/vendor-abc123.js");
      });

      it("should include shared chunks", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {},
              shared: ["shared-utils.js"],
            },
          }),
        );
        assertStringIncludes(output, "/_veryfront/chunks/shared-utils.js");
      });

      it("rejects chunk paths that normalize outside framework asset namespaces", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {
                external: createChunkInfo("//example.invalid/private.js"),
                traversal: createChunkInfo("/_veryfront/../api/private.js"),
              },
              shared: [],
            },
          }),
        );

        assertEquals(output.includes("example.invalid"), false);
        assertEquals(extractStaticCacheUrls(output).includes("/api/private.js"), false);
      });
    });

    describe("route chunks", () => {
      it("should include chunks from routes", () => {
        const output = generateServiceWorker(
          createManifest({
            routes: [
              { path: "/", slug: "index", chunks: ["page-index.js"] },
            ],
          }),
        );
        assertStringIncludes(output, "/_veryfront/chunks/page-index.js");
      });

      it("should skip routes without chunks array", () => {
        const manifest = createManifest({
          routes: [
            { path: "/", slug: "index", chunks: [] },
          ],
        });
        // deno-lint-ignore no-explicit-any
        (manifest.routes[0] as any).chunks = "not-an-array";
        const output = generateServiceWorker(manifest);
        // Should not throw, and default assets should still be present
        assertStringIncludes(output, "/_veryfront/router.js");
      });
    });

    describe("empty/undefined manifest fields", () => {
      it("should handle null chunks gracefully", () => {
        const output = generateServiceWorker(createManifest({ chunks: null }));
        assertStringIncludes(output, "CACHE_VERSION");
      });

      it("should handle undefined routes gracefully", () => {
        const manifest = createManifest();
        // deno-lint-ignore no-explicit-any
        (manifest as any).routes = undefined;
        const output = generateServiceWorker(manifest);
        assertStringIncludes(output, "CACHE_VERSION");
      });

      it("should handle undefined buildTime by using a fallback", () => {
        const manifest = createManifest();
        // deno-lint-ignore no-explicit-any
        (manifest as any).buildTime = undefined;
        const output = generateServiceWorker(manifest);
        assertStringIncludes(output, "veryfront-");
      });

      it("should handle chunks with undefined shared array", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {},
              // deno-lint-ignore no-explicit-any
              shared: undefined as any,
            },
          }),
        );
        assertStringIncludes(output, "STATIC_CACHE_URLS");
      });

      it("should skip null/undefined chunk paths", () => {
        const output = generateServiceWorker(
          createManifest({
            chunks: {
              version: "1.0.0",
              routes: {},
              chunks: {
                "entry-main": createChunkInfo(
                  // deno-lint-ignore no-explicit-any
                  null as any,
                  {
                    // deno-lint-ignore no-explicit-any
                    css: undefined as any,
                  },
                ),
              },
              shared: [],
            },
          }),
        );
        // Should not throw and should still have default assets
        assertStringIncludes(output, "/_veryfront/router.js");
      });
    });

    describe("cache safety", () => {
      it("uses cache-first delivery for manifest assets", () => {
        const output = generateServiceWorker(createManifest());
        const matchIndex = output.indexOf("await cache.match(request)");
        const fetchIndex = output.indexOf("await fetch(request)", matchIndex);

        assertEquals(matchIndex >= 0, true);
        assertEquals(fetchIndex > matchIndex, true);
      });

      it("does not precache navigations or the service worker itself", () => {
        const output = generateServiceWorker(createManifest());
        const urls = extractStaticCacheUrls(output);

        assertEquals(urls.includes("/"), false);
        assertEquals(urls.includes("/sw.js"), false);
      });

      it("only intercepts same-origin manifest assets without authorization", () => {
        const output = generateServiceWorker(createManifest());

        assertStringIncludes(output, "url.origin !== self.location.origin");
        assertStringIncludes(output, "request.headers.has('authorization')");
        assertStringIncludes(output, "STATIC_CACHE_PATHS.has(url.pathname)");
      });

      it("rejects private and explicitly uncacheable responses", () => {
        const output = generateServiceWorker(createManifest());

        assertStringIncludes(output, "cacheDirectives.has('private')");
        assertStringIncludes(output, "cacheDirectives.has('no-store')");
        assertStringIncludes(output, "cacheDirectives.has('no-cache')");
        assertStringIncludes(output, "response.headers.has('set-cookie')");
      });

      it("versions the runtime cache with the build", () => {
        const output = generateServiceWorker(createManifest());

        assertStringIncludes(output, "const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`");
      });

      it("limits cleanup to owned and recognized legacy caches", () => {
        const output = generateServiceWorker(createManifest());

        assertStringIncludes(output, "name.startsWith('veryfront-sw-')");
        assertStringIncludes(output, "name === LEGACY_RUNTIME_CACHE");
        assertStringIncludes(output, "LEGACY_BUILD_CACHE_PATTERN.test(name)");
      });

      it("discards a partial precache when installation fails", () => {
        const output = generateServiceWorker(createManifest());

        assertStringIncludes(output, "await caches.delete(RUNTIME_CACHE)");
        assertStringIncludes(output, "throw error");
      });

      it("bypasses sensitive and non-manifest requests at runtime", async () => {
        let fetches = 0;
        const harness = executeGeneratedWorker(
          generateServiceWorker(createManifest()),
          async () => {
            fetches++;
            return new Response("network");
          },
        );

        for (
          const request of [
            new Request("https://other.example/_veryfront/router.js"),
            new Request("https://app.example/api/account"),
            new Request("https://app.example/_veryfront/router.js?user=1"),
            new Request("https://app.example/_veryfront/router.js", {
              headers: { Authorization: "Bearer <TOKEN>" },
            }),
          ]
        ) {
          assertEquals((await dispatchWorkerFetch(harness, request)).intercepted, false);
        }
        assertEquals(fetches, 0);
        assertEquals(harness.getCacheWrites(), 0);
      });

      it("caches public manifest assets but not private responses", async () => {
        let cacheControl = "private, max-age=60";
        const harness = executeGeneratedWorker(
          generateServiceWorker(createManifest()),
          async () =>
            new Response("network", {
              headers: { "Cache-Control": cacheControl },
            }),
        );
        const request = new Request("https://app.example/_veryfront/router.js");

        const privateResult = await dispatchWorkerFetch(harness, request);
        assertEquals(privateResult.intercepted, true);
        assertEquals(privateResult.backgroundTasks, 0);
        assertEquals(harness.getCacheWrites(), 0);

        cacheControl = "public, max-age=31536000, immutable";
        const publicResult = await dispatchWorkerFetch(harness, request);
        assertEquals(publicResult.intercepted, true);
        assertEquals(publicResult.backgroundTasks, 1);
        assertEquals(harness.getCacheWrites(), 1);
      });
    });

    describe("combined scenario", () => {
      it("should include all asset types from a full manifest", () => {
        const output = generateServiceWorker(
          createManifest({
            version: "3.0.0",
            buildTime: "2025-06-15T12:00:00.000Z",
            chunks: {
              version: "3.0.0",
              routes: {
                "/": { entry: "route-index.js", chunks: ["route-index.js"] },
              },
              chunks: {
                "entry-main": createChunkInfo("main.js", {
                  css: "main.css",
                  imports: ["vendor.js"],
                }),
                "page-about": createChunkInfo("about.js"),
              },
              shared: ["shared-runtime.js"],
            },
            routes: [
              { path: "/", slug: "index", chunks: ["route-index.js"] },
              { path: "/about", slug: "about", chunks: ["route-about.js"] },
            ],
          }),
        );

        // Version
        assertStringIncludes(output, "veryfront-sw-3.0.0-");

        // Default assets
        assertStringIncludes(output, "/_veryfront/router.js");
        assertStringIncludes(output, "/_veryfront/prefetch.js");

        // Chunk files
        assertStringIncludes(output, "/_veryfront/main.js");
        assertStringIncludes(output, "/_veryfront/main.css");
        assertStringIncludes(output, "/_veryfront/about.js");

        // Import dependencies
        assertStringIncludes(output, "/_veryfront/chunks/vendor.js");

        // Shared chunks
        assertStringIncludes(output, "/_veryfront/chunks/shared-runtime.js");

        // Route chunks
        assertStringIncludes(output, "/_veryfront/chunks/route-index.js");
        assertStringIncludes(output, "/_veryfront/chunks/route-about.js");

        // Sorted output (STATIC_CACHE_URLS is sorted)
        const urlsMatch = output.match(/STATIC_CACHE_URLS = (\[[\s\S]*?\]);/);
        if (urlsMatch) {
          const urls = JSON.parse(urlsMatch[1] ?? "[]") as string[];
          const sorted = [...urls].sort();
          assertEquals(urls, sorted);
        }
      });
    });
  });
});
