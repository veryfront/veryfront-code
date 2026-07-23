import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildManifest,
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  getChunkInfo,
  getPreloadHints,
  isCriticalImport,
  writeManifest,
} from "./manifest-builder.ts";
import type { ChunkManifest } from "./types.ts";

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
    it("should return a full SHA-256 hex hash", async () => {
      const hash = await calculateFileHash(new TextEncoder().encode("hello world"));
      assertEquals(hash.length, 64);
      assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
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
    it("identifies JavaScript bundle assets without package-name heuristics", () => {
      assertEquals(isCriticalImport("node_modules/react/index.js"), true);
      assertEquals(isCriticalImport("react-dom/client.js"), true);
      assertEquals(isCriticalImport("_veryfront/runtime.js"), true);
      assertEquals(isCriticalImport("lib/router/index.js"), true);
      assertEquals(isCriticalImport("lodash/debounce.js"), true);
      assertEquals(isCriticalImport("styles/app.css"), false);
      assertEquals(isCriticalImport("chunks/app.mjs"), false);
    });

    it("rejects non-bundle paths and malformed values", () => {
      assertEquals(isCriticalImport("assets/data.json"), false);
      assertEquals(isCriticalImport("chunks/app.js?cache=1"), false);
      assertEquals(isCriticalImport("chunks/app.js\0"), false);
    });
  });

  describe("getPreloadHints", () => {
    it("returns hints for every local static bundle import", () => {
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
      assertEquals(hints, ["chunks/react-abc.js", "chunks/lodash-xyz.js"]);
    });

    it("does not preload dynamic imports", () => {
      const output = {
        imports: [
          { path: "/out/chunks/lazy.js", kind: "dynamic-import" as const },
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

    it("does not generate preload links for external imports", () => {
      const output = {
        imports: [
          {
            path: "react",
            kind: "import-statement" as const,
            external: true,
          },
        ],
        bytes: 100,
        inputs: {},
        exports: [],
      };
      assertEquals(getPreloadHints(output, "/out"), []);
    });
  });

  describe("manifest assembly", () => {
    it("maps nested and custom output names back to their route", async () => {
      const outDir = await Deno.makeTempDir();
      const outputPath = `${outDir}/blog-post.js`;
      try {
        await Deno.writeTextFile(outputPath, "export default 1;");
        const manifest = await buildManifest(
          {
            inputs: {},
            outputs: {
              [outputPath]: {
                imports: [],
                exports: ["default"],
                inputs: {},
                bytes: 17,
                entryPoint: "/project/pages/blog/post.tsx",
              },
            },
          },
          new Map([["blog-post", "/blog/post"]]),
          outDir,
        );

        assertEquals(manifest.routes["/blog/post"]?.entry, "blog-post.js");
        assertEquals(manifest.routes["/post"], undefined);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("handles metafile outputs that omit imports", async () => {
      const outDir = await Deno.makeTempDir();
      const outputPath = `${outDir}/entry.js`;
      try {
        await Deno.writeTextFile(outputPath, "export default 1;");
        const chunk = await getChunkInfo(
          outputPath,
          {
            imports: undefined,
            exports: ["default"],
            inputs: {},
            bytes: 17,
          } as never,
          outDir,
        );
        assertEquals(chunk.imports, []);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects two outputs mapped to the same route", async () => {
      const outDir = await Deno.makeTempDir();
      const first = `${outDir}/first.js`;
      const second = `${outDir}/second.js`;
      try {
        await Deno.writeTextFile(first, "export default 1;");
        await Deno.writeTextFile(second, "export default 2;");
        await assertRejects(
          () =>
            buildManifest(
              {
                inputs: {},
                outputs: {
                  [first]: {
                    imports: [],
                    exports: ["default"],
                    inputs: {},
                    bytes: 17,
                    entryPoint: "/project/pages/first.tsx",
                  },
                  [second]: {
                    imports: [],
                    exports: ["default"],
                    inputs: {},
                    bytes: 17,
                    entryPoint: "/project/pages/second.tsx",
                  },
                },
              },
              new Map([
                ["first", "/same"],
                ["second", "/same"],
              ]),
              outDir,
            ),
          TypeError,
          "Duplicate chunk manifest route",
        );
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects entry outputs that are not mapped to a requested route", async () => {
      const outDir = await Deno.makeTempDir();
      const outputPath = `${outDir}/orphan.js`;
      try {
        await Deno.writeTextFile(outputPath, "export default 1;");
        await assertRejects(
          () =>
            buildManifest(
              {
                inputs: {},
                outputs: {
                  [outputPath]: {
                    imports: [],
                    exports: ["default"],
                    inputs: {},
                    bytes: 17,
                    entryPoint: "/project/pages/orphan.tsx",
                  },
                },
              },
              new Map(),
              outDir,
            ),
          TypeError,
          "not mapped",
        );
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("writes a validated manifest atomically", async () => {
      const outDir = await Deno.makeTempDir();
      const manifest: ChunkManifest = {
        version: "1.0",
        routes: { "/": { entry: "index.js", chunks: [] } },
        chunks: {
          "index.js": {
            name: "index",
            file: "index.js",
            imports: [],
            size: 16,
            hash: "01234567".repeat(8),
          },
        },
        shared: [],
      };
      try {
        await writeManifest(manifest, outDir);
        assertEquals(JSON.parse(await Deno.readTextFile(`${outDir}/manifest.json`)), manifest);
        const files = [];
        for await (const entry of Deno.readDir(outDir)) files.push(entry.name);
        assertEquals(files, ["manifest.json"]);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("does not replace an existing manifest with invalid data", async () => {
      const outDir = await Deno.makeTempDir();
      const manifestPath = `${outDir}/manifest.json`;
      try {
        await Deno.writeTextFile(manifestPath, "existing");
        await assertRejects(
          () =>
            writeManifest(
              { version: "1.0", routes: {}, chunks: {}, shared: ["missing.js"] },
              outDir,
            ),
          TypeError,
          "Invalid chunk manifest structure",
        );
        assertEquals(await Deno.readTextFile(manifestPath), "existing");
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects truncated content hashes", async () => {
      const outDir = await Deno.makeTempDir();
      try {
        await assertRejects(
          () =>
            writeManifest({
              version: "1.0",
              routes: { "/": { entry: "index.js", chunks: [] } },
              chunks: {
                "index.js": {
                  name: "index",
                  file: "index.js",
                  imports: [],
                  size: 1,
                  hash: "deadbeef",
                },
              },
              shared: [],
            }, outDir),
          TypeError,
          "Invalid chunk manifest structure",
        );
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
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
