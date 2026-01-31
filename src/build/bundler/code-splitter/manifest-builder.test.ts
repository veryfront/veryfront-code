import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  isCriticalImport,
} from "./manifest-builder.ts";

describe("build/bundler/code-splitter/manifest-builder", () => {
  describe("extractEntryName", () => {
    it("should extract filename without extension", () => {
      assertEquals(extractEntryName("src/pages/index.tsx"), "index");
      assertEquals(extractEntryName("src/pages/about.ts"), "about");
      assertEquals(extractEntryName("components/hero.jsx"), "hero");
      assertEquals(extractEntryName("pages/blog.mdx"), "blog");
    });

    it("should handle deeply nested paths", () => {
      assertEquals(extractEntryName("a/b/c/d/page.tsx"), "page");
    });

    it("should return unknown for extensionless files", () => {
      assertEquals(extractEntryName("src/Makefile"), "Makefile");
    });

    it("should throw for empty path segment", () => {
      assertThrows(() => extractEntryName(""));
    });
  });

  describe("extractChunkName", () => {
    it("should remove .js extension", () => {
      assertEquals(extractChunkName("dist/chunk-abc.js"), "chunk-abc");
    });

    it("should remove .css extension", () => {
      assertEquals(extractChunkName("dist/styles.css"), "styles");
    });

    it("should keep name if no known extension", () => {
      assertEquals(extractChunkName("dist/data.json"), "data.json");
    });

    it("should throw for empty path segment", () => {
      assertThrows(() => extractChunkName(""));
    });
  });

  describe("calculateFileHash", () => {
    it("should return 8-char hex hash", async () => {
      const hash = await calculateFileHash(new TextEncoder().encode("hello world"));
      assertEquals(hash.length, 8);
      assertEquals(/^[0-9a-f]{8}$/.test(hash), true);
    });

    it("should be deterministic", async () => {
      const content = new TextEncoder().encode("test content");
      const hash1 = await calculateFileHash(content);
      const hash2 = await calculateFileHash(content);
      assertEquals(hash1, hash2);
    });

    it("should differ for different content", async () => {
      const a = await calculateFileHash(new TextEncoder().encode("aaa"));
      const b = await calculateFileHash(new TextEncoder().encode("bbb"));
      assertEquals(a !== b, true);
    });
  });

  describe("isCriticalImport", () => {
    it("should mark react imports as critical", () => {
      assertEquals(isCriticalImport("node_modules/react/index.js"), true);
      assertEquals(isCriticalImport("react-dom/client.js"), true);
    });

    it("should mark veryfront imports as critical", () => {
      assertEquals(isCriticalImport("_veryfront/runtime.js"), true);
    });

    it("should mark router imports as critical", () => {
      assertEquals(isCriticalImport("lib/router/index.js"), true);
    });

    it("should not mark other imports as critical", () => {
      assertEquals(isCriticalImport("lodash/debounce.js"), false);
      assertEquals(isCriticalImport("components/button.js"), false);
    });
  });
});
