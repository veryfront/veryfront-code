import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildManifest,
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

    it("should preserve extensionless filenames", () => {
      assertEquals(extractEntryName("src/Makefile"), "Makefile");
    });

    it("should support Windows separators and case-insensitive extensions", () => {
      assertEquals(extractEntryName(String.raw`C:\project\pages\index.TSX`), "index");
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

    it("should support Windows separators and case-insensitive extensions", () => {
      assertEquals(extractChunkName(String.raw`C:\dist\chunks\shared.JS`), "shared");
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
      assertEquals(hints[0]?.includes("react"), true);
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

    it("ignores external imports and returns stable path ordering", () => {
      const output = {
        imports: [
          { path: "/out/router-z.js", kind: "import-statement" as const },
          {
            path: "react",
            kind: "import-statement" as const,
            external: true,
          },
          { path: "/out/react-a.js", kind: "import-statement" as const },
        ],
        bytes: 100,
        inputs: {},
        exports: [],
      };

      assertEquals(getPreloadHints(output, "/out"), [
        "react-a.js",
        "router-z.js",
      ]);
    });

    it("rejects duplicate bundled imports", () => {
      const output = {
        imports: [
          { path: "/out/router.js", kind: "import-statement" as const },
          { path: "/out/router.js", kind: "dynamic-import" as const },
        ],
        bytes: 100,
        inputs: {},
        exports: [],
      };

      assertThrows(
        () => getPreloadHints(output, "/out"),
        TypeError,
        "duplicate import",
      );
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

  describe("buildManifest", () => {
    it("maps routes by emitted entry name rather than source basename", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-manifest-builder-" });
      const outputFile = `${outDir}/blog-post.js`;
      try {
        await Deno.writeTextFile(outputFile, "export default 1;");
        const manifest = await buildManifest(
          {
            inputs: {},
            outputs: {
              [outputFile]: {
                imports: [],
                exports: ["default"],
                entryPoint: "/project/pages/blog/index.tsx",
                inputs: {},
                bytes: 17,
              },
            },
          },
          new Map([["blog-post", "/blog/post"]]),
          outDir,
        );

        assertEquals(manifest.routes["/blog/post"]?.entry, "blog-post.js");
        assertEquals(manifest.routes["/index"], undefined);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects emitted entries without a route mapping", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-manifest-builder-" });
      const outputFile = `${outDir}/orphan.js`;
      try {
        await Deno.writeTextFile(outputFile, "export default 1;");
        await assertRejects(
          () =>
            buildManifest(
              {
                inputs: {},
                outputs: {
                  [outputFile]: {
                    imports: [],
                    exports: ["default"],
                    entryPoint: "/project/pages/index.tsx",
                    inputs: {},
                    bytes: 17,
                  },
                },
              },
              new Map(),
              outDir,
            ),
          TypeError,
          "No route mapping",
        );
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("produces deterministic chunks, routes, imports, and shared ordering", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-manifest-builder-" });
      const firstFile = `${outDir}/a.js`;
      const secondFile = `${outDir}/b.js`;
      const sharedFile = `${outDir}/chunks/router-shared.js`;
      const firstContent = "export const a = 1;";
      const secondContent = "export const b = 2;";
      const sharedContent = "export const shared = 3;";
      try {
        await Deno.mkdir(`${outDir}/chunks`);
        await Promise.all([
          Deno.writeTextFile(firstFile, firstContent),
          Deno.writeTextFile(secondFile, secondContent),
          Deno.writeTextFile(sharedFile, sharedContent),
        ]);

        const outputFor = (
          file: string,
          content: string,
          entryPoint?: string,
        ) => ({
          imports: file === sharedFile ? [] : [
            {
              path: "react",
              kind: "import-statement" as const,
              external: true,
            },
            {
              path: sharedFile,
              kind: "import-statement" as const,
            },
          ],
          exports: [],
          entryPoint,
          inputs: {},
          bytes: new TextEncoder().encode(content).byteLength,
        });
        const routeMap = new Map([
          ["a", "/a"],
          ["b", "/b"],
        ]);
        const reverseOrder = {
          [sharedFile]: outputFor(sharedFile, sharedContent),
          [secondFile]: outputFor(secondFile, secondContent, "/project/b.ts"),
          [firstFile]: outputFor(firstFile, firstContent, "/project/a.ts"),
        };
        const forwardOrder = {
          [firstFile]: reverseOrder[firstFile]!,
          [secondFile]: reverseOrder[secondFile]!,
          [sharedFile]: reverseOrder[sharedFile]!,
        };

        const first = await buildManifest(
          { inputs: {}, outputs: reverseOrder },
          routeMap,
          outDir,
        );
        const second = await buildManifest(
          { inputs: {}, outputs: forwardOrder },
          routeMap,
          outDir,
        );

        assertEquals(JSON.stringify(first), JSON.stringify(second));
        assertEquals(Object.keys(first.routes), ["/a", "/b"]);
        assertEquals(Object.keys(first.chunks), [
          "a.js",
          "b.js",
          "chunks/router-shared.js",
        ]);
        assertEquals(first.routes["/a"]?.chunks, ["chunks/router-shared.js"]);
        assertEquals(first.routes["/a"]?.preload, ["chunks/router-shared.js"]);
        assertEquals(first.shared, ["chunks/router-shared.js"]);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects route entries for which the bundler emitted no JavaScript", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-manifest-builder-" });
      try {
        await assertRejects(
          () =>
            buildManifest(
              { inputs: {}, outputs: {} },
              new Map([["missing", "/missing"]]),
              outDir,
            ),
          TypeError,
          "No JavaScript output was emitted",
        );
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects chunk files whose size disagrees with bundler metadata", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-manifest-builder-" });
      const outputFile = `${outDir}/index.js`;
      try {
        await Deno.writeTextFile(outputFile, "export default 1;");
        await assertRejects(
          () =>
            buildManifest(
              {
                inputs: {},
                outputs: {
                  [outputFile]: {
                    imports: [],
                    exports: ["default"],
                    entryPoint: "/project/index.ts",
                    inputs: {},
                    bytes: 999,
                  },
                },
              },
              new Map([["index", "/"]]),
              outDir,
            ),
          TypeError,
          "does not match bundler metadata",
        );
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("rejects chunk files reached through a directory symlink escape", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-manifest-builder-" });
      const outDir = `${root}/out`;
      const outsideDir = `${root}/outside`;
      const outputFile = `${outDir}/linked/escaped.js`;
      const content = "export default 1;";
      try {
        await Deno.mkdir(outDir);
        await Deno.mkdir(outsideDir);
        await Deno.writeTextFile(`${outsideDir}/escaped.js`, content);
        await Deno.symlink(outsideDir, `${outDir}/linked`, { type: "dir" });

        await assertRejects(
          () =>
            buildManifest(
              {
                inputs: {},
                outputs: {
                  [outputFile]: {
                    imports: [],
                    exports: ["default"],
                    entryPoint: "/project/index.ts",
                    inputs: {},
                    bytes: new TextEncoder().encode(content).byteLength,
                  },
                },
              },
              new Map([["escaped", "/"]]),
              outDir,
            ),
          TypeError,
          "resolved outside",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  });
});
