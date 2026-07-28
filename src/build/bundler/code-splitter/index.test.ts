import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CodeSplitter,
  convertPathToName,
  createCodeSplitter,
  generatePreloadLinks,
  getChunksForRoute,
  loadChunkManifest,
  validateChunkManifest,
} from "./index.ts";
import type { ChunkManifest } from "./types.ts";

describe("build/bundler/code-splitter/index", () => {
  describe("createCodeSplitter", () => {
    it("should return a CodeSplitter instance", () => {
      const splitter = createCodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });
  });

  describe("convertPathToName", () => {
    it("should convert root path to index", () => {
      assertEquals(convertPathToName("/"), "index");
    });

    it("should strip leading slash and replace slashes with dashes", () => {
      assertEquals(convertPathToName("/about"), "about");
      assertEquals(convertPathToName("/blog/post"), "blog-post");
      assertEquals(convertPathToName("/a/b/c"), "a-b-c");
    });
  });

  describe("getChunksForRoute", () => {
    const manifest: ChunkManifest = {
      version: "1.0",
      routes: {
        "/": {
          entry: "index.js",
          chunks: ["chunks/shared-abc.js"],
          css: ["styles/index.css"],
        },
        "/about": {
          entry: "about.js",
          chunks: ["chunks/shared-abc.js", "chunks/about-dep.js"],
        },
      },
      chunks: {},
      shared: [],
    };

    it("should return chunks for a known route", () => {
      const chunks = getChunksForRoute(manifest, "/");
      assertEquals(chunks.includes("index.js"), true);
      assertEquals(chunks.includes("chunks/shared-abc.js"), true);
      assertEquals(chunks.includes("styles/index.css"), true);
    });

    it("should return empty array for unknown route", () => {
      const chunks = getChunksForRoute(manifest, "/not-found");
      assertEquals(chunks, []);
    });

    it("should include css, entry, and chunks for about route", () => {
      const chunks = getChunksForRoute(manifest, "/about");
      assertEquals(chunks.includes("about.js"), true);
      assertEquals(chunks.includes("chunks/shared-abc.js"), true);
      assertEquals(chunks.includes("chunks/about-dep.js"), true);
    });
  });

  describe("generatePreloadLinks", () => {
    const manifest: ChunkManifest = {
      version: "1.0",
      routes: {
        "/": {
          entry: "index.js",
          chunks: [],
          preload: ["chunks/shared-abc.js"],
          css: ["styles/main.css"],
        },
        "/about": {
          entry: "about.js",
          chunks: [],
        },
      },
      chunks: {},
      shared: [],
    };

    it("should generate modulepreload link for entry", () => {
      const links = generatePreloadLinks(manifest, "/");
      assertEquals(links.includes('rel="modulepreload"'), true);
      assertEquals(links.includes("index.js"), true);
    });

    it("should generate modulepreload link for preload chunks", () => {
      const links = generatePreloadLinks(manifest, "/");
      assertEquals(links.includes("chunks/shared-abc.js"), true);
    });

    it("should generate preload link for CSS", () => {
      const links = generatePreloadLinks(manifest, "/");
      assertEquals(links.includes('rel="preload"'), true);
      assertEquals(links.includes('as="style"'), true);
      assertEquals(links.includes("styles/main.css"), true);
    });

    it("should return empty string for unknown route", () => {
      assertEquals(generatePreloadLinks(manifest, "/not-found"), "");
    });

    it("should prepend baseUrl when provided", () => {
      const links = generatePreloadLinks(manifest, "/", "https://cdn.example.com");
      assertEquals(links.includes("https://cdn.example.com/index.js"), true);
    });

    it("should generate links without preload or css arrays", () => {
      const links = generatePreloadLinks(manifest, "/about");
      assertEquals(links.includes("about.js"), true);
    });

    it("escapes safe URL delimiter characters in generated attributes", () => {
      const links = generatePreloadLinks({
        ...manifest,
        routes: {
          "/": {
            entry: "entry&variant.js",
            chunks: [],
          },
        },
      }, "/");

      assertEquals(links.includes("entry&amp;variant.js"), true);
    });

    it("rejects unsafe manifest paths instead of emitting HTML", () => {
      assertThrows(
        () =>
          generatePreloadLinks({
            ...manifest,
            routes: {
              "/": {
                entry: 'entry.js" onload="alert(1)',
                chunks: [],
              },
            },
          }, "/"),
        TypeError,
        "safe relative asset path",
      );
    });

    it("rejects non-HTTP preload base URLs", () => {
      assertThrows(
        () => generatePreloadLinks(manifest, "/", "javascript:alert(1)"),
        TypeError,
        "HTTP(S)",
      );
    });
  });

  describe("validateChunkManifest", () => {
    const validManifest: ChunkManifest = {
      version: "1.0",
      routes: {
        "/": {
          entry: "index.js",
          chunks: [],
        },
      },
      chunks: {
        "index.js": {
          name: "index",
          file: "index.js",
          imports: [],
          size: 12,
          hash: "1234abcd",
        },
      },
      shared: [],
    };

    it("accepts a complete bounded manifest", () => {
      assertEquals(validateChunkManifest(validManifest), validManifest);
    });

    it("rejects routes that reference missing entry chunks", () => {
      assertThrows(
        () =>
          validateChunkManifest({
            ...validManifest,
            chunks: {},
          }),
        TypeError,
        "unknown entry chunk",
      );
    });

    it("wraps malformed on-disk manifests as build errors", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "vf-chunk-manifest-" });
      const manifestPath = `${tempDir}/manifest.json`;
      try {
        await Deno.writeTextFile(manifestPath, '{"version":"future"}');
        await assertRejects(
          () => loadChunkManifest(manifestPath),
          Error,
          "Failed to load chunk manifest",
        );
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });
  });
});
