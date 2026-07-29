import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateManifest, generateRedirects } from "./manifest.ts";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import { VeryfrontError } from "#veryfront/errors";

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
        chunks: 0,
        assets: 5,
        totalSize: 1048576,
        duration: 0,
      },
      enableSplitting: false,
      enablePrefetch: false,
      enableCompression: false,
      chunkManifest: null,
    };
    const validChunkManifest: ChunkManifest = {
      version: "1.0",
      routes: {
        "/": {
          entry: "entry.js",
          chunks: ["chunk-a.js"],
        },
      },
      chunks: {
        "entry.js": {
          name: "entry",
          file: "entry.js",
          imports: ["chunk-a.js"],
          size: 24,
          hash: "1234abcd",
        },
        "chunk-a.js": {
          name: "chunk-a",
          file: "chunk-a.js",
          imports: [],
          size: 12,
          hash: "5678abcd",
        },
      },
      shared: [],
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

      const [first, second] = result.routes;
      assertExists(first);
      assertExists(second);

      assertEquals(first.path, "/");
      assertEquals(first.template, "/");
      assertEquals(first.slug, "index");
      assertEquals(second.path, "/about");
      assertEquals(second.template, "/about");
    });

    it("maps generated dynamic paths back to their source template", () => {
      const result = generateManifest({
        ...baseOptions,
        routes: [
          {
            path: "/blog/hello%20world",
            templatePath: "/blog/[slug]",
            slug: "blog/hello%20world",
            file: "pages/blog/[slug].tsx",
            params: { slug: "hello world" },
          },
        ],
        stats: {
          ...baseOptions.stats,
          pages: 1,
          ssgPaths: ["/blog/hello%20world"],
        },
      });

      assertEquals(result.routes, [{
        path: "/blog/hello%20world",
        template: "/blog/[slug]",
        slug: "blog/hello%20world",
        chunks: [],
      }]);
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
        stats: {
          ...baseOptions.stats,
          pages: 3,
        },
      });

      assertEquals(result.routes.length, 3);

      const route = result.routes[2];
      assertExists(route);
      assertEquals(route.path, "/api/data");
      assertEquals(route.template, "/api/data");
    });

    it("should format stats with MB size", () => {
      const result = generateManifest(baseOptions);
      assertEquals(result.stats.pages, 2);
      assertEquals(result.stats.chunks, 0);
      assertEquals(result.stats.assets, 5);
      assertEquals(result.stats.totalSize, "1.00 MB");
    });

    it("should include chunks when splitting enabled with valid manifest", () => {
      const result = generateManifest({
        ...baseOptions,
        enableSplitting: true,
        chunkManifest: validChunkManifest,
        stats: {
          ...baseOptions.stats,
          chunks: 2,
        },
      });

      assertEquals(result.chunks !== null, true);

      const route = result.routes[0];
      assertExists(route);
      assertEquals(route.chunks, ["chunk-a.js"]);
    });

    it("resolves concrete dynamic routes through their template chunk identity", () => {
      const dynamicChunkManifest: ChunkManifest = {
        ...validChunkManifest,
        routes: {
          "/blog/[slug]": validChunkManifest.routes["/"]!,
        },
      };
      const result = generateManifest({
        ...baseOptions,
        routes: [
          {
            path: "/blog/hello",
            templatePath: "/blog/[slug]",
            slug: "blog/hello",
            file: "pages/blog/[slug].tsx",
            params: { slug: "hello" },
          },
          {
            path: "/blog/world",
            templatePath: "/blog/[slug]",
            slug: "blog/world",
            file: "pages/blog/[slug].tsx",
            params: { slug: "world" },
          },
        ],
        enableSplitting: true,
        chunkManifest: dynamicChunkManifest,
        stats: {
          ...baseOptions.stats,
          chunks: 2,
          ssgPaths: ["/blog/hello", "/blog/world"],
        },
      });

      assertEquals(
        result.routes.map((route) => ({
          path: route.path,
          template: route.template,
          chunks: route.chunks,
        })),
        [
          {
            path: "/blog/hello",
            template: "/blog/[slug]",
            chunks: ["chunk-a.js"],
          },
          {
            path: "/blog/world",
            template: "/blog/[slug]",
            chunks: ["chunk-a.js"],
          },
        ],
      );
      assertEquals(Object.keys(result.chunks!.routes), ["/blog/[slug]"]);
    });

    it("canonicalizes route and chunk ordering into a detached snapshot", () => {
      const unorderedManifest: ChunkManifest = {
        version: "1.0",
        routes: {
          "/": {
            entry: "entry.js",
            chunks: ["chunk-b.js", "chunk-a.js"],
            preload: ["chunk-b.js", "chunk-a.js"],
          },
        },
        chunks: {
          "entry.js": {
            name: "entry",
            file: "entry.js",
            imports: ["chunk-b.js", "chunk-a.js"],
            size: 24,
            hash: "1234abcd",
          },
          "chunk-b.js": {
            name: "chunk-b",
            file: "chunk-b.js",
            imports: [],
            size: 12,
            hash: "5678abcd",
          },
          "chunk-a.js": {
            name: "chunk-a",
            file: "chunk-a.js",
            imports: [],
            size: 12,
            hash: "90abcdef",
          },
        },
        shared: ["chunk-b.js", "chunk-a.js"],
      };
      const result = generateManifest({
        ...baseOptions,
        routes: [...baseOptions.routes].reverse(),
        enableSplitting: true,
        chunkManifest: unorderedManifest,
        stats: {
          ...baseOptions.stats,
          chunks: 3,
        },
      });

      assertEquals(result.routes.map((route) => route.path), ["/", "/about"]);
      assertEquals(Object.keys(result.chunks!.chunks), [
        "chunk-a.js",
        "chunk-b.js",
        "entry.js",
      ]);
      assertEquals(result.chunks!.chunks["entry.js"]?.imports, [
        "chunk-a.js",
        "chunk-b.js",
      ]);
      assertEquals(result.chunks!.routes["/"]?.chunks, [
        "chunk-a.js",
        "chunk-b.js",
      ]);
      assertEquals(result.chunks!.shared, ["chunk-a.js", "chunk-b.js"]);

      unorderedManifest.routes["/"]!.chunks.push("entry.js");
      unorderedManifest.chunks["entry.js"]!.imports.push("entry.js");
      unorderedManifest.shared.push("entry.js");
      assertEquals(result.chunks!.routes["/"]?.chunks, [
        "chunk-a.js",
        "chunk-b.js",
      ]);
      assertEquals(result.chunks!.chunks["entry.js"]?.imports, [
        "chunk-a.js",
        "chunk-b.js",
      ]);
      assertEquals(result.chunks!.shared, ["chunk-a.js", "chunk-b.js"]);
    });

    it("fails the build for an invalid chunk manifest", () => {
      const error = assertThrows(
        () =>
          generateManifest({
            ...baseOptions,
            enableSplitting: true,
            chunkManifest: { invalid: true } as never,
          }),
        VeryfrontError,
        "Invalid chunk manifest",
      );

      assertEquals(error.slug, "build-failed");
    });

    it("fails when the manifest route count disagrees with build stats", () => {
      const error = assertThrows(
        () =>
          generateManifest({
            ...baseOptions,
            stats: {
              ...baseOptions.stats,
              pages: 1,
            },
          }),
        VeryfrontError,
        "output manifest contains 2 routes",
      );

      assertEquals(error.slug, "build-failed");
    });

    it("fails when chunks reference a route that was not generated", () => {
      const mismatchedManifest: ChunkManifest = {
        ...validChunkManifest,
        routes: {
          "/missing": validChunkManifest.routes["/"]!,
        },
      };
      const error = assertThrows(
        () =>
          generateManifest({
            ...baseOptions,
            enableSplitting: true,
            chunkManifest: mismatchedManifest,
            stats: {
              ...baseOptions.stats,
              chunks: 2,
            },
          }),
        VeryfrontError,
        "route that was not generated",
      );

      assertEquals(error.slug, "build-failed");
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
