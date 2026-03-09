import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  getPreloadHints,
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

    it("should handle partial matches", () => {
      assertEquals(isCriticalImport("my-react-lib/index.js"), true);
      assertEquals(isCriticalImport("chunks/veryfront-app.js"), true);
    });
  });

  describe("getPreloadHints", () => {
    it("should return hints for critical imports", () => {
      const output = {
        imports: [
          { path: "/out/chunks/react-abc.js", kind: "import-statement" as const },
          { path: "/out/chunks/lodash-xyz.js", kind: "import-statement" as const },
        ],
        bytes: 100,
        inputs: {},
        exports: [],
      };
      const hints = getPreloadHints(output, "/out");
      assertEquals(hints.length, 1);
      assertEquals(hints[0].includes("react"), true);
    });

    it("should return empty array when no critical imports", () => {
      const output = {
        imports: [
          { path: "/out/chunks/lodash-xyz.js", kind: "import-statement" as const },
          { path: "/out/chunks/date-fns-abc.js", kind: "import-statement" as const },
        ],
        bytes: 100,
        inputs: {},
        exports: [],
      };
      const hints = getPreloadHints(output, "/out");
      assertEquals(hints.length, 0);
    });

    it("should return empty array when no imports", () => {
      const output = {
        imports: [],
        bytes: 100,
        inputs: {},
        exports: [],
      };
      const hints = getPreloadHints(output, "/out");
      assertEquals(hints.length, 0);
    });
  });

  describe("extractEntryName edge cases", () => {
    it("should handle .js extension", () => {
      assertEquals(extractEntryName("src/app.js"), "app");
    });

    it("should handle files with multiple dots", () => {
      assertEquals(extractEntryName("src/my.component.tsx"), "my.component");
    });
  });

  describe("extractChunkName edge cases", () => {
    it("should handle hashed chunk names", () => {
      assertEquals(extractChunkName("chunks/shared-A1B2C3D4.js"), "shared-A1B2C3D4");
    });

    it("should handle paths with multiple segments", () => {
      assertEquals(extractChunkName("a/b/c/d/file.js"), "file");
    });
  });
});
