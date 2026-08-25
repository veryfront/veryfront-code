import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateServiceWorker } from "./build-service-worker.ts";
import type { BuildManifest } from "#veryfront/build/production-build/manifest.ts";

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

const DEFAULT_STATIC_CACHE_URLS = [
  "/",
  "/_veryfront/manifest.json",
  "/_veryfront/prefetch.js",
  "/_veryfront/router.js",
  "/sw.js",
];

function parseStaticCacheUrls(output: string): string[] {
  const match = output.match(/STATIC_CACHE_URLS = (\[[\s\S]*?\]);/);
  assertExists(match, "STATIC_CACHE_URLS must be emitted as a parseable array literal");
  return JSON.parse(match[1]) as string[];
}

function parseCacheStrategy(output: string, name: string): RegExp[] {
  const match = output.match(new RegExp(`${name}:\\s*\\[([^\\]]*?)\\]`));
  assertExists(match, `the ${name} strategy must be emitted with its own pattern list`);
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line.startsWith("/") && line.endsWith("/"))
    .map((literal) => new RegExp(literal.slice(1, -1)));
}

function matchesAny(patterns: RegExp[], path: string): boolean {
  return patterns.some((pattern) => pattern.test(path));
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
        assertStringIncludes(
          output,
          "event.data.type === 'SKIP_WAITING'",
          "the message handler must call skipWaiting only when the page asks for it",
        );
      });
    });

    describe("cache version", () => {
      it("should include version in cache name", () => {
        const output = generateServiceWorker(createManifest({ version: "2.5.0" }));
        assertStringIncludes(output, "veryfront-2.5.0-");
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
        assertStringIncludes(output, "veryfront-1.0.0-betabuildspecial-");
      });

      it("should default to 'dev' when version is undefined", () => {
        const manifest = createManifest();
        // deno-lint-ignore no-explicit-any
        (manifest as any).version = undefined;
        const output = generateServiceWorker(manifest);
        assertStringIncludes(output, "veryfront-dev-");
      });
    });

    describe("default static assets", () => {
      it("should always include root path", () => {
        const urls = parseStaticCacheUrls(generateServiceWorker(createManifest()));
        assertEquals(
          urls.includes("/"),
          true,
          "the root document must be precached so offline navigation to / works",
        );
      });

      it("should always include router.js", () => {
        const urls = parseStaticCacheUrls(generateServiceWorker(createManifest()));
        assertEquals(
          urls.includes("/_veryfront/router.js"),
          true,
          "the client router must be precached",
        );
      });

      it("should always include prefetch.js", () => {
        const urls = parseStaticCacheUrls(generateServiceWorker(createManifest()));
        assertEquals(
          urls.includes("/_veryfront/prefetch.js"),
          true,
          "the prefetch runtime must be precached",
        );
      });

      it("should always include manifest.json", () => {
        const urls = parseStaticCacheUrls(generateServiceWorker(createManifest()));
        assertEquals(
          urls.includes("/_veryfront/manifest.json"),
          true,
          "the build manifest must be precached",
        );
      });

      it("should always include sw.js", () => {
        const urls = parseStaticCacheUrls(generateServiceWorker(createManifest()));
        assertEquals(
          urls.includes("/sw.js"),
          true,
          "the service worker itself must be precached",
        );
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
                "entry-main": {
                  file: "main.js",
                },
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
                "entry-main": {
                  file: "main.js",
                  css: "main.css",
                },
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
                "entry-main": {
                  file: "main.js",
                  imports: ["vendor-abc123.js"],
                },
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
        assertEquals(
          parseStaticCacheUrls(output),
          DEFAULT_STATIC_CACHE_URLS,
          "a route whose chunks field is not an array must contribute no cache entries",
        );
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
        const versionMatch = output.match(/const CACHE_VERSION = '([^']+)';/);
        assertExists(versionMatch, "CACHE_VERSION must be emitted as a single-quoted literal");
        assertMatch(
          versionMatch[1],
          /^veryfront-1\.0\.0-\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/,
          "a manifest without buildTime must fall back to a generated ISO timestamp stamp",
        );
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
                "entry-main": {
                  // deno-lint-ignore no-explicit-any
                  file: null as any,
                  // deno-lint-ignore no-explicit-any
                  css: undefined as any,
                },
              },
              shared: [],
            },
          }),
        );
        // Should not throw and should still have default assets
        assertStringIncludes(output, "/_veryfront/router.js");
      });
    });

    describe("cache strategies", () => {
      it("should include networkFirst strategy", () => {
        const patterns = parseCacheStrategy(
          generateServiceWorker(createManifest()),
          "networkFirst",
        );
        assert(
          matchesAny(patterns, "/api/v1"),
          "api requests must be routed to the networkFirst strategy",
        );
        assert(
          matchesAny(patterns, "/_veryfront/data/x"),
          "framework data requests must be routed to the networkFirst strategy",
        );
        assertEquals(
          matchesAny(patterns, "/logo.png"),
          false,
          "images must not be routed to the networkFirst strategy",
        );
      });

      it("should include cacheFirst strategy", () => {
        const patterns = parseCacheStrategy(generateServiceWorker(createManifest()), "cacheFirst");
        assert(
          matchesAny(patterns, "/_veryfront/chunks/a.js"),
          "immutable hashed chunks must be routed to the cacheFirst strategy",
        );
        assert(
          matchesAny(patterns, "/logo.png"),
          "images must be routed to the cacheFirst strategy",
        );
        assertEquals(
          matchesAny(patterns, "/api/v1"),
          false,
          "api requests must not be routed to the cacheFirst strategy",
        );
      });

      it("should include staleWhileRevalidate strategy", () => {
        const patterns = parseCacheStrategy(
          generateServiceWorker(createManifest()),
          "staleWhileRevalidate",
        );
        assert(
          matchesAny(patterns, "/x.css"),
          "stylesheets must be routed to the staleWhileRevalidate strategy",
        );
        assert(
          matchesAny(patterns, "/x.js"),
          "scripts must be routed to the staleWhileRevalidate strategy",
        );
        assertEquals(
          matchesAny(patterns, "/logo.png"),
          false,
          "images must not be routed to the staleWhileRevalidate strategy",
        );
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
                "/": { chunks: ["route-index.js"] },
              },
              chunks: {
                "entry-main": {
                  file: "main.js",
                  css: "main.css",
                  imports: ["vendor.js"],
                },
                "page-about": {
                  file: "about.js",
                },
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
        assertStringIncludes(output, "veryfront-3.0.0-");

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
        const urls = parseStaticCacheUrls(output);
        assertEquals(
          urls,
          [...urls].sort(),
          "the precache list must be emitted in sorted order",
        );
      });
    });
  });
});
