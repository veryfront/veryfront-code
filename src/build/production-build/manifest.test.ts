import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateManifest, generateRedirects } from "./manifest.ts";

describe("build/production-build/manifest", () => {
  describe("generateManifest", () => {
    const baseOptions = {
      routes: [
        { path: "/", slug: "index", file: "pages/index.tsx" },
        { path: "/about", slug: "about", file: "pages/about.tsx" },
      ],
      appRoutes: [],
      stats: {
        pages: 2,
        components: 0,
        chunks: 3,
        assets: 5,
        totalSize: 1048576,
        duration: 0,
      },
      enableSplitting: false,
      enablePrefetch: false,
      enableCompression: false,
      chunkManifest: null,
    };

    it("should generate manifest with correct version", () => {
      const result = generateManifest(baseOptions);
      assertEquals(result.version, "2.0.0");
    });

    it("should include buildTime as ISO string", () => {
      const result = generateManifest(baseOptions);
      assertEquals(typeof result.buildTime, "string");
      assertEquals(isNaN(Date.parse(result.buildTime)), false);
    });

    it("should set features from options", () => {
      const result = generateManifest({
        ...baseOptions,
        enableSplitting: true,
        enablePrefetch: true,
        enableCompression: true,
      });

      assertEquals(result.features.codeSplitting, false);
      assertEquals(result.features.prefetching, true);
      assertEquals(result.features.compression, true);
      assertEquals(result.features.streaming, true);
      assertEquals(result.features.clientRouting, true);
    });

    it("should map routes correctly", () => {
      const result = generateManifest(baseOptions);
      assertEquals(result.routes.length, 2);

      const [first, second] = result.routes;
      assertExists(first);
      assertExists(second);

      assertEquals(first.path, "/");
      assertEquals(first.slug, "index");
      assertEquals(second.path, "/about");
    });

    it("omits routes that were not generated", () => {
      const result = generateManifest({
        ...baseOptions,
        appRoutes: [
          {
            path: "/app-only",
            pageFile: "app/app-only/page.tsx",
            segments: ["app-only"],
            segmentDirs: ["app", "app-only"],
          },
        ],
        stats: {
          ...baseOptions.stats,
          pages: 1,
          ssgPaths: ["/"],
        },
      });

      assertEquals(result.routes.map((route) => route.path), ["/"]);
    });

    it("should include appRoutes", () => {
      const result = generateManifest({
        ...baseOptions,
        appRoutes: [
          {
            path: "/api/data",
            pageFile: "app/api/data/route.ts",
            segments: ["api", "data"],
            segmentDirs: ["app", "api", "data"],
          },
        ],
      });

      assertEquals(result.routes.length, 3);

      const route = result.routes[2];
      assertExists(route);
      assertEquals(route.path, "/api/data");
    });

    it("should format stats with MB size", () => {
      const result = generateManifest(baseOptions);
      assertEquals(result.stats.pages, 2);
      assertEquals(result.stats.chunks, 3);
      assertEquals(result.stats.assets, 5);
      assertEquals(result.stats.totalSize, "1.00 MB");
    });

    it("should include chunks when splitting enabled with valid manifest", () => {
      const chunkManifest = {
        version: "1.0",
        routes: { "/": { entry: "chunk-a.js", chunks: ["chunk-shared.js"] } },
        chunks: {
          "chunk-a.js": {
            name: "chunk-a",
            file: "chunk-a.js",
            imports: [],
            size: 1,
            hash: "deadbeef".repeat(8),
          },
          "chunk-shared.js": {
            name: "chunk-shared",
            file: "chunk-shared.js",
            imports: [],
            size: 1,
            hash: "c0ffee00".repeat(8),
          },
        },
        shared: ["chunk-shared.js"],
      };

      const result = generateManifest({
        ...baseOptions,
        enableSplitting: true,
        chunkManifest,
      });

      assertEquals(result.chunks !== null, true);

      const route = result.routes[0];
      assertExists(route);
      assertEquals(route.chunks, ["chunk-shared.js"]);
    });

    it("rejects an invalid chunk manifest instead of silently disabling chunks", () => {
      assertThrows(
        () =>
          generateManifest({
            ...baseOptions,
            enableSplitting: true,
            chunkManifest: { invalid: true } as never,
          }),
        TypeError,
        "chunk manifest",
      );
    });

    it("reports code splitting as disabled when no chunk manifest exists", () => {
      const result = generateManifest({
        ...baseOptions,
        enableSplitting: true,
        chunkManifest: null,
      });
      assertEquals(result.features.codeSplitting, false);
    });

    it("rejects duplicate generated route paths", () => {
      assertThrows(
        () =>
          generateManifest({
            ...baseOptions,
            appRoutes: [{
              path: "/about",
              pageFile: "app/about/page.tsx",
              segments: ["about"],
              segmentDirs: ["app", "about"],
            }],
          }),
        TypeError,
        "Duplicate build manifest route",
      );
    });
  });

  describe("generateRedirects", () => {
    it("should include SPA redirect rule", () => {
      const result = generateRedirects();
      assertEquals(result.includes("/*"), true);
      assertEquals(result.includes("/index.html"), true);
      assertEquals(result.includes("200"), true);
    });
  });
});
