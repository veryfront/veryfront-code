import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, '"/');
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

      it("should always include sw.js", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "/sw.js");
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
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "networkFirst");
      });

      it("should include cacheFirst strategy", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "cacheFirst");
      });

      it("should include staleWhileRevalidate strategy", () => {
        const output = generateServiceWorker(createManifest());
        assertStringIncludes(output, "staleWhileRevalidate");
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
        const urlsMatch = output.match(/STATIC_CACHE_URLS = (\[[\s\S]*?\]);/);
        if (urlsMatch) {
          const urls = JSON.parse(urlsMatch[1]) as string[];
          const sorted = [...urls].sort();
          assertEquals(urls, sorted);
        }
      });
    });
  });
});
