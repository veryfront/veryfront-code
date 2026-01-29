import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateManifest, generateRedirects } from "./manifest.ts";

describe("build/production-build/manifest", () => {
  describe("generateManifest", () => {
    const baseOptions = {
      routes: [
        { path: "/", slug: "index", file: "pages/index.tsx", type: "page" as const },
        { path: "/about", slug: "about", file: "pages/about.tsx", type: "page" as const },
      ],
      appRoutes: [],
      stats: { pages: 2, chunks: 3, assets: 5, totalSize: 1048576 },
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
      assertEquals(result.features.codeSplitting, true);
      assertEquals(result.features.prefetching, true);
      assertEquals(result.features.compression, true);
      assertEquals(result.features.streaming, true);
      assertEquals(result.features.clientRouting, true);
    });

    it("should map routes correctly", () => {
      const result = generateManifest(baseOptions);
      assertEquals(result.routes.length, 2);
      assertEquals(result.routes[0].path, "/");
      assertEquals(result.routes[0].slug, "index");
      assertEquals(result.routes[1].path, "/about");
    });

    it("should include appRoutes", () => {
      const result = generateManifest({
        ...baseOptions,
        appRoutes: [
          { path: "/api/data", handler: "api/data.ts", method: "GET" },
        ],
      });
      assertEquals(result.routes.length, 3);
      assertEquals(result.routes[2].path, "/api/data");
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
        routes: { "/": { chunks: ["chunk-a.js"] } },
        chunks: { "chunk-a.js": { file: "chunk-a.js" } },
        shared: ["shared.js"],
      };
      const result = generateManifest({
        ...baseOptions,
        enableSplitting: true,
        chunkManifest,
      });
      assertEquals(result.chunks !== null, true);
      assertEquals(result.routes[0].chunks, ["chunk-a.js"]);
    });

    it("should return null chunks for invalid manifest", () => {
      const result = generateManifest({
        ...baseOptions,
        enableSplitting: true,
        chunkManifest: { invalid: true } as unknown as null,
      });
      assertEquals(result.chunks, null);
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
