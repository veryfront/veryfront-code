import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  analyzeProjectChunks,
  type ChunkAnalysis,
  generateChunkManifest,
} from "./chunk-optimizer.ts";
import {
  MAX_IMPORTS_PER_PAGE,
  MAX_MANIFEST_CHUNKS,
  MAX_TOTAL_MANIFEST_PAGE_CHUNK_REFERENCES,
} from "./chunk-optimizer/limits.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";

describe("rendering/chunk-optimizer", () => {
  describe("generateChunkManifest", () => {
    it("should generate empty manifest for empty analysis", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map(),
        sharedDeps: new Map(),
        suggestedChunks: [],
      };

      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.version, "1.0");
      assertEquals(Object.keys(manifest.chunks).length, 0);
      assertEquals(Object.keys(manifest.pages).length, 0);
      assertEquals(manifest.chunks["constructor"], undefined);
      assertEquals(manifest.pages["toString"], undefined);
    });

    it("should include chunks from suggestions", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map(),
        sharedDeps: new Map(),
        suggestedChunks: [
          { name: "common", deps: ["react", "lodash"], pages: [], benefit: 5000 },
        ],
      };

      const manifest = generateChunkManifest(analysis);
      const chunk = manifest.chunks.common;

      assertExists(chunk);
      assertEquals(chunk.deps, ["react", "lodash"]);
      assertEquals(chunk.size, 5000);
    });

    it("should map pages to their chunks and deps", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map([
          [
            "/pages/index.mdx",
            {
              path: "/pages/index.mdx",
              local: ["./utils"],
              remote: ["https://esm.sh/react"],
              shared: ["lodash"],
            },
          ],
        ]),
        sharedDeps: new Map([["lodash", 2]]),
        suggestedChunks: [
          {
            name: "common",
            deps: ["lodash"],
            pages: ["/pages/index.mdx"],
            benefit: 1000,
          },
        ],
      };

      const manifest = generateChunkManifest(analysis);
      const page = manifest.pages["/pages/index.mdx"];

      assertExists(page);
      assertEquals(page.chunks.includes("common"), true);
      assertEquals(page.deps.local, ["./utils"]);
      assertEquals(page.deps.shared, ["lodash"]);
    });

    it("should assign page to chunk when page has matching dep", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map([
          [
            "/pages/about.mdx",
            {
              path: "/pages/about.mdx",
              local: [],
              remote: ["https://esm.sh/react"],
              shared: [],
            },
          ],
        ]),
        sharedDeps: new Map(),
        suggestedChunks: [
          {
            name: "react-vendor",
            deps: ["https://esm.sh/react"],
            pages: ["/pages/about.mdx"],
            benefit: 200000,
          },
        ],
      };

      const manifest = generateChunkManifest(analysis);
      const page = manifest.pages["/pages/about.mdx"];

      assertExists(page);
      assertEquals(page.chunks, ["react-vendor"]);
    });

    it("defines prototype-shaped page and chunk names as ordinary own properties", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map([
          [
            "__proto__",
            {
              path: "__proto__",
              local: [],
              remote: [],
              shared: ["pkg"],
            },
          ],
        ]),
        sharedDeps: new Map([["pkg", 1]]),
        suggestedChunks: [
          {
            name: "__proto__",
            deps: ["pkg"],
            pages: ["__proto__"],
            benefit: 1,
          },
        ],
      };

      const manifest = generateChunkManifest(analysis);
      assertEquals(Object.hasOwn(manifest.chunks, "__proto__"), true);
      assertEquals(Object.hasOwn(manifest.pages, "__proto__"), true);
      const chunk = manifest.chunks.__proto__;
      const page = manifest.pages.__proto__;
      assertExists(chunk);
      assertExists(page);
      assertEquals(chunk.deps, ["pkg"]);
      assertEquals(page.chunks, ["__proto__"]);
    });

    it("rejects duplicate chunk names instead of silently overwriting them", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map(),
        sharedDeps: new Map(),
        suggestedChunks: [
          { name: "common", deps: ["a"], pages: [], benefit: 1 },
          { name: "common", deps: ["b"], pages: [], benefit: 2 },
        ],
      };

      assertThrows(
        () => generateChunkManifest(analysis),
        TypeError,
        "Duplicate chunk",
      );
    });

    it("detaches manifest dependency arrays from the analysis input", () => {
      const imports = {
        path: "/pages/index.mdx",
        local: ["./local.ts"],
        remote: [] as string[],
        shared: ["pkg"],
      };
      const suggestion = {
        name: "common",
        deps: ["pkg"],
        pages: [imports.path],
        benefit: 1,
      };
      const analysis: ChunkAnalysis = {
        pages: new Map([[imports.path, imports]]),
        sharedDeps: new Map([["pkg", 1]]),
        suggestedChunks: [suggestion],
      };

      const manifest = generateChunkManifest(analysis);
      imports.local.push("./later.ts");
      suggestion.deps.push("later");

      const page = manifest.pages[imports.path];
      const chunk = manifest.chunks.common;
      assertExists(page);
      assertExists(chunk);
      assertEquals(page.deps.local, ["./local.ts"]);
      assertEquals(chunk.deps, ["pkg"]);
    });

    it("allows suggested chunks to exceed the per-page import cap", () => {
      const dependencies = Array.from(
        { length: MAX_IMPORTS_PER_PAGE + 1 },
        (_, index) => `pkg-${index}`,
      );
      const analysis: ChunkAnalysis = {
        pages: new Map([
          [
            "/pages/index.mdx",
            {
              path: "/pages/index.mdx",
              local: [],
              remote: [],
              shared: ["pkg-0", `pkg-${MAX_IMPORTS_PER_PAGE}`],
            },
          ],
        ]),
        sharedDeps: new Map(),
        suggestedChunks: [
          {
            name: "common",
            deps: dependencies,
            pages: ["/pages/index.mdx"],
            benefit: dependencies.length,
          },
        ],
      };

      const manifest = generateChunkManifest(analysis);
      const chunk = manifest.chunks.common;
      const page = manifest.pages["/pages/index.mdx"];
      assertExists(chunk);
      assertExists(page);
      assertEquals(chunk.deps.length, MAX_IMPORTS_PER_PAGE + 1);
      assertEquals(page.chunks, ["common"]);
    });

    it("enforces the page dependency cap across local remote and shared entries", () => {
      const local = Array.from({ length: 4_000 }, (_, index) => `./local-${index}.ts`);
      const remote = Array.from(
        { length: 3_000 },
        (_, index) => `https://example.test/${index}.js`,
      );
      const shared = Array.from({ length: 3_001 }, (_, index) => `pkg-${index}`);
      const analysis: ChunkAnalysis = {
        pages: new Map([
          [
            "/pages/index.mdx",
            {
              path: "/pages/index.mdx",
              local,
              remote,
              shared,
            },
          ],
        ]),
        sharedDeps: new Map(),
        suggestedChunks: [],
      };

      assertThrows(
        () => generateChunkManifest(analysis),
        RangeError,
        `at most ${MAX_IMPORTS_PER_PAGE} total entries`,
      );
    });

    it("rejects manifests that exceed the aggregate page-chunk reference budget", () => {
      const chunkCount = MAX_MANIFEST_CHUNKS;
      const pageCount = Math.floor(
        MAX_TOTAL_MANIFEST_PAGE_CHUNK_REFERENCES / chunkCount,
      ) + 1;
      const suggestedChunks = Array.from(
        { length: chunkCount },
        (_, index) => ({
          name: `chunk-${index}`,
          deps: ["shared"],
          pages: [],
          benefit: 1,
        }),
      );
      const pages: ChunkAnalysis["pages"] = new Map();
      for (let index = 0; index < pageCount; index++) {
        const path = `/pages/page-${index}.mdx`;
        pages.set(path, {
          path,
          local: [],
          remote: [],
          shared: ["shared"],
        });
      }
      const analysis: ChunkAnalysis = {
        pages,
        sharedDeps: new Map([["shared", pageCount]]),
        suggestedChunks,
      };

      assertThrows(
        () => generateChunkManifest(analysis),
        RangeError,
        "page-chunk reference limit",
      );
    });

    it("rejects non-finite chunk sizes", () => {
      const analysis: ChunkAnalysis = {
        pages: new Map(),
        sharedDeps: new Map(),
        suggestedChunks: [
          { name: "broken", deps: [], pages: [], benefit: Number.NaN },
        ],
      };

      assertThrows(
        () => generateChunkManifest(analysis),
        RangeError,
        "finite",
      );
    });

    it("does not invoke accessor-backed manifest values", () => {
      let reads = 0;
      const suggestion = Object.defineProperties({}, {
        name: {
          enumerable: true,
          get() {
            reads++;
            throw new Error("must not execute");
          },
        },
        deps: { enumerable: true, value: [] },
        pages: { enumerable: true, value: [] },
        benefit: { enumerable: true, value: 1 },
      });
      const analysis = {
        pages: new Map(),
        sharedDeps: new Map(),
        suggestedChunks: [suggestion],
      } as unknown as ChunkAnalysis;

      assertThrows(
        () => generateChunkManifest(analysis),
        TypeError,
        "suggestion",
      );
      assertEquals(reads, 0);
    });

    it("does not invoke accessor-backed dependency entries", () => {
      let reads = 0;
      const deps: string[] = [];
      Object.defineProperty(deps, "0", {
        enumerable: true,
        get() {
          reads++;
          throw new Error("must not execute");
        },
      });
      deps.length = 1;
      const analysis: ChunkAnalysis = {
        pages: new Map(),
        sharedDeps: new Map(),
        suggestedChunks: [
          { name: "broken", deps, pages: [], benefit: 1 },
        ],
      };

      assertThrows(
        () => generateChunkManifest(analysis),
        TypeError,
        "dense string data properties",
      );
      assertEquals(reads, 0);
    });

    it("does not invoke accessor-backed page data", () => {
      let reads = 0;
      const page = Object.defineProperties({}, {
        path: {
          enumerable: true,
          get() {
            reads++;
            throw new Error("must not execute");
          },
        },
        local: { enumerable: true, value: [] },
        remote: { enumerable: true, value: [] },
        shared: { enumerable: true, value: [] },
      });
      const analysis = {
        pages: new Map([["/page.mdx", page]]),
        sharedDeps: new Map(),
        suggestedChunks: [],
      } as unknown as ChunkAnalysis;

      assertThrows(
        () => generateChunkManifest(analysis),
        TypeError,
        "matching path",
      );
      assertEquals(reads, 0);
    });
  });

  describe("analyzeProjectChunks", () => {
    type FSLike = {
      readDir(
        path: string,
      ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
      readTextFile(path: string): Promise<string>;
    };

    /** Simple mock FS: pass explicit file contents and dir listings. */
    function createMockFS(
      files: Record<string, string>,
      dirListings: Record<string, Array<{ name: string; isFile: boolean }>>,
    ): FSLike {
      return {
        async *readDir(path: string) {
          const entries = dirListings[path];
          if (!entries) return;
          for (const entry of entries) {
            yield {
              name: entry.name,
              isFile: entry.isFile,
              isDirectory: !entry.isFile,
            };
          }
        },
        async readTextFile(path: string) {
          const content = files[path];
          if (content !== undefined) return content;
          throw new Error("not found: " + path);
        },
      };
    }

    it("returns empty analysis for empty project", async () => {
      const fs = createMockFS({}, {});
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 0);
      assertEquals(analysis.sharedDeps.size, 0);
      assertEquals(analysis.suggestedChunks.length, 0);
    });

    it("discovers MDX files and analyzes imports", async () => {
      const fs = createMockFS(
        {
          "/project/pages/index.mdx":
            'import React from "react";\nimport lodash from "lodash";\nimport local from "./local.ts";\n',
        },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 1);
      const page = analysis.pages.get("/project/pages/index.mdx");
      assertExists(page);
      assertEquals(page.shared.includes("react"), true);
      assertEquals(page.shared.includes("lodash"), true);
      assertEquals(page.local.includes("./local.ts"), true);
    });

    it("parses every literal ESM dependency without matching examples", async () => {
      const source = [
        "---",
        "example: |",
        '  import frontmatter from "frontmatter-example";',
        "---",
        "<!--",
        'import commented from "html-comment-example";',
        "-->",
        'import "side-effect";',
        'export { value } from "exported-package";',
        'const lazy = import("./lazy.ts");',
        "const example = 'import fake from \"string-example\"';",
        'const htmlMarker = "<!--";',
        'import afterMarker from "after-marker";',
        '// import ignored from "comment-example";',
        "",
        '    import indented from "indented-example";',
        "",
        "```js",
        'import fenced from "fenced-example";',
        "```",
        "~~~js",
        'import tildeFenced from "tilde-fenced-example";',
        "~~~",
        'import React from "react";',
        'import EscapedReact from "\\x72eact";',
        'import LiteralBackslash from "./literal\\\\x2ejs";',
        'import ReactAgain from "react";',
      ].join("\n");
      const fs = createMockFS(
        { "/project/pages/index.mdx": source },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );

      const analysis = await analyzeProjectChunks("/project", fs);
      const page = analysis.pages.get("/project/pages/index.mdx");
      assertExists(page);
      assertEquals(page.local, ["./lazy.ts", "./literal\\x2ejs"]);
      assertEquals(page.remote, []);
      assertEquals(page.shared, [
        "side-effect",
        "exported-package",
        "after-marker",
        "react",
      ]);
      assertEquals(analysis.sharedDeps.get("react"), 1);
      assertEquals(analysis.sharedDeps.has("string-example"), false);
      assertEquals(analysis.sharedDeps.has("comment-example"), false);
      assertEquals(analysis.sharedDeps.has("indented-example"), false);
      assertEquals(analysis.sharedDeps.has("fenced-example"), false);
      assertEquals(analysis.sharedDeps.has("frontmatter-example"), false);
      assertEquals(analysis.sharedDeps.has("html-comment-example"), false);
      assertEquals(analysis.sharedDeps.has("tilde-fenced-example"), false);
    });

    it("rejects malformed escaped import specifiers", async () => {
      const fs = createMockFS(
        { "/project/pages/index.mdx": 'import invalid from "\\xZZ";' },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        SyntaxError,
        "escaped module specifier",
      );
    });

    it("does not hide imports behind unsupported or unclosed frontmatter markers", async () => {
      const fs = createMockFS(
        {
          "/project/pages/unclosed.mdx": '---\nimport visible from "visible-after-unclosed";\n',
          "/project/pages/toml.mdx": '+++\nimport visible from "visible-after-toml-marker";\n+++\n',
        },
        {
          "/project/pages": [
            { name: "unclosed.mdx", isFile: true },
            { name: "toml.mdx", isFile: true },
          ],
        },
      );

      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(
        analysis.sharedDeps.has("visible-after-unclosed"),
        true,
      );
      assertEquals(
        analysis.sharedDeps.has("visible-after-toml-marker"),
        true,
      );
    });

    it("detects shared deps used by multiple pages", async () => {
      const fs = createMockFS(
        {
          "/project/pages/a.mdx": 'import lodash from "lodash";\n',
          "/project/pages/b.mdx": 'import lodash from "lodash";\n',
        },
        {
          "/project/pages": [
            { name: "a.mdx", isFile: true },
            { name: "b.mdx", isFile: true },
          ],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 2);
      assertEquals(analysis.sharedDeps.get("lodash"), 2);
      const common = analysis.suggestedChunks.find((c) => c.name === "common");
      assertExists(common);
      assertEquals(common.deps.includes("lodash"), true);
    });

    it("detects react vendor chunk", async () => {
      const fs = createMockFS(
        {
          "/project/pages/index.mdx": 'import React from "react";\n',
        },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      const reactVendor = analysis.suggestedChunks.find((c) => c.name === "react-vendor");
      assertExists(reactVendor);
      assertEquals(reactVendor.deps.includes("react"), true);
    });

    it("does not classify React ecosystem libraries as the React runtime", async () => {
      const fs = createMockFS(
        {
          "/project/pages/index.mdx":
            'import query from "@tanstack/react-query";\nimport ui from "@headlessui/react";\nimport nested from "some-package/react";\n',
        },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );

      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(
        analysis.suggestedChunks.some((chunk) => chunk.name === "react-vendor"),
        false,
      );
      const ui = analysis.suggestedChunks.find((chunk) => chunk.name === "ui-vendor");
      assertExists(ui);
      assertEquals(ui.deps, ["@headlessui/react"]);
    });

    it("does not place a dependency into overlapping suggested chunks", async () => {
      const fs = createMockFS(
        {
          "/project/pages/a.mdx": 'import React from "react";\n',
          "/project/pages/b.mdx": 'import React from "react";\n',
        },
        {
          "/project/pages": [
            { name: "a.mdx", isFile: true },
            { name: "b.mdx", isFile: true },
          ],
        },
      );

      const analysis = await analyzeProjectChunks("/project", fs);
      const react = analysis.suggestedChunks.find((chunk) => chunk.name === "react-vendor");
      assertExists(react);
      assertEquals(react.deps, ["react"]);
      assertEquals(
        analysis.suggestedChunks.some((chunk) =>
          chunk.name === "common" && chunk.deps.includes("react")
        ),
        false,
      );
    });

    it("keeps project aliases local and runtime schemes out of chunks", async () => {
      const fs = createMockFS(
        {
          "/project/pages/a.mdx":
            'import local from "@/components/local.ts";\nimport fs from "node:fs";\n',
          "/project/pages/b.mdx": 'import fs from "node:fs";\n',
        },
        {
          "/project/pages": [
            { name: "b.mdx", isFile: true },
            { name: "a.mdx", isFile: true },
          ],
        },
      );

      const analysis = await analyzeProjectChunks("/project", fs);
      const page = analysis.pages.get("/project/pages/a.mdx");
      assertExists(page);
      assertEquals(page.local, ["@/components/local.ts"]);
      assertEquals(page.shared, ["node:fs"]);
      assertEquals(analysis.sharedDeps.get("node:fs"), 2);
      assertEquals(
        analysis.suggestedChunks.some((chunk) => chunk.deps.includes("node:fs")),
        false,
      );
    });

    it("detects remote URL imports", async () => {
      const fs = createMockFS(
        {
          "/project/pages/index.mdx":
            'import x from "https://esm.sh/react";\nimport y from "HTTPS://esm.sh/react-dom@19";\n',
        },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      const page = analysis.pages.get("/project/pages/index.mdx");
      assertExists(page);
      assertEquals(page.remote, [
        "https://esm.sh/react",
        "HTTPS://esm.sh/react-dom@19",
      ]);
      const react = analysis.suggestedChunks.find((chunk) => chunk.name === "react-vendor");
      assertExists(react);
      assertEquals(react.deps, [
        "HTTPS://esm.sh/react-dom@19",
        "https://esm.sh/react",
      ]);
    });

    it("skips hidden directories except .veryfront", async () => {
      const fs = createMockFS(
        {
          "/project/.veryfront/config.mdx": 'import y from "lodash";\n',
        },
        {
          "/project/pages": [{ name: ".hidden", isFile: false }],
          "/project/pages/.hidden": [{ name: "secret.mdx", isFile: true }],
          "/project/.veryfront": [{ name: "config.mdx", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.has("/project/pages/.hidden/secret.mdx"), false);
      assertEquals(analysis.pages.has("/project/.veryfront/config.mdx"), true);
    });

    it("skips generated build directories under .veryfront", async () => {
      const fs = createMockFS(
        {
          "/project/.veryfront/page.mdx": "",
          "/project/.veryfront/compiled/artifact.mdx": "",
        },
        {
          "/project/.veryfront": [
            { name: "compiled", isFile: false },
            { name: "page.mdx", isFile: true },
          ],
          "/project/.veryfront/compiled": [{ name: "artifact.mdx", isFile: true }],
        },
      );

      const analysis = await analyzeProjectChunks("/project", fs);

      assertEquals(
        analysis.pages.has("/project/.veryfront/compiled/artifact.mdx"),
        false,
        "build artifacts under .veryfront/compiled must never be treated as authored pages",
      );
      assertEquals(
        analysis.pages.has("/project/.veryfront/page.mdx"),
        true,
        "a sibling authored page under .veryfront is still scanned",
      );
    });

    it("uses structural .veryfront ancestry instead of substring matching", async () => {
      const projectDir = "/workspace/.veryfront-project";
      const fs = createMockFS(
        {
          [`${projectDir}/pages/a.mdx`]: "",
          [`${projectDir}/pages/b.mdx`]: "",
          [`${projectDir}/pages/cache/c.mdx`]: "",
        },
        {
          [`${projectDir}/pages`]: [
            { name: "b.mdx", isFile: true },
            { name: "cache", isFile: false },
            { name: "a.mdx", isFile: true },
          ],
          [`${projectDir}/pages/cache`]: [{ name: "c.mdx", isFile: true }],
        },
      );

      const analysis = await analyzeProjectChunks(projectDir, fs);
      assertEquals([...analysis.pages.keys()], [
        `${projectDir}/pages/a.mdx`,
        `${projectDir}/pages/b.mdx`,
        `${projectDir}/pages/cache/c.mdx`,
      ]);
    });

    it("rejects unsafe directory entry names before joining paths", async () => {
      const fs: FSLike = {
        async *readDir(path: string) {
          if (path === "/project/pages") {
            yield {
              name: "../escape.mdx",
              isFile: true,
              isDirectory: false,
            };
          }
        },
        async readTextFile() {
          return "";
        },
      };

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        TypeError,
        "directory entry name",
      );
    });

    it("does not invoke directory-entry accessors", async () => {
      let reads = 0;
      const hostile = Object.defineProperties({}, {
        name: {
          enumerable: true,
          get() {
            reads++;
            throw new Error("must not execute");
          },
        },
        isFile: { enumerable: true, value: true },
        isDirectory: { enumerable: true, value: false },
      });
      const fs: FSLike = {
        async *readDir(path: string) {
          if (path === "/project/pages") yield hostile as never;
        },
        async readTextFile() {
          return "";
        },
      };

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        TypeError,
        "directory entry",
      );
      assertEquals(reads, 0);
    });

    it("does not invoke filesystem capability accessors", async () => {
      let reads = 0;
      const fs = Object.defineProperties({}, {
        readDir: {
          get() {
            reads++;
            throw new Error("must not execute");
          },
        },
        readTextFile: {
          value: async () => "",
        },
      }) as unknown as FSLike;

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        TypeError,
        "data method",
      );
      assertEquals(reads, 0);
    });

    it("rejects ambiguous directory-entry types", async () => {
      const fs: FSLike = {
        async *readDir(path: string) {
          if (path === "/project/pages") {
            yield {
              name: "ambiguous.mdx",
              isFile: true,
              isDirectory: true,
            };
          }
        },
        async readTextFile() {
          return "";
        },
      };

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        TypeError,
        "both files and directories",
      );
    });

    it("rejects duplicate names within one directory snapshot", async () => {
      const fs: FSLike = {
        async *readDir(path: string) {
          if (path === "/project/pages") {
            yield {
              name: "duplicate.mdx",
              isFile: true,
              isDirectory: false,
            };
            yield {
              name: "duplicate.mdx",
              isFile: false,
              isDirectory: true,
            };
          }
        },
        async readTextFile() {
          return "";
        },
      };

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        TypeError,
        "duplicate directory entry",
      );
    });

    it("rejects directory trees beyond the fixed traversal depth", async () => {
      const listings: Record<string, Array<{ name: string; isFile: boolean }>> = {};
      let directory = "/project/pages";
      for (let depth = 0; depth <= 64; depth++) {
        listings[directory] = [{ name: `d${depth}`, isFile: false }];
        directory = `${directory}/d${depth}`;
      }
      const fs = createMockFS({}, listings);

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        RangeError,
        "depth limit",
      );
    });

    it("rejects unreadable discovered files instead of returning a partial graph", async () => {
      const fs = createMockFS(
        {},
        {
          "/project/pages": [{ name: "broken.mdx", isFile: true }],
        },
      );
      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        Error,
        "not found",
      );
    });

    it("propagates a nested directory disappearing during traversal", async () => {
      const missing = Object.assign(new Error("nested directory disappeared"), {
        code: "ENOENT",
      });
      const fs: FSLike = {
        async *readDir(path: string) {
          if (path === "/project/pages") {
            yield { name: "nested", isFile: false, isDirectory: true };
            return;
          }
          if (path === "/project/pages/nested") throw missing;
        },
        async readTextFile() {
          return "";
        },
      };

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        Error,
        "disappeared",
      );
    });

    it("propagates a top-level directory disappearing after yielding data", async () => {
      const missing = Object.assign(new Error("root disappeared mid-read"), {
        code: "ENOENT",
      });
      const fs: FSLike = {
        async *readDir(path: string) {
          if (path === "/project/pages") {
            yield {
              name: "index.mdx",
              isFile: true,
              isDirectory: false,
            };
            throw missing;
          }
        },
        async readTextFile() {
          return "";
        },
      };

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        Error,
        "mid-read",
      );
    });

    it("treats only missing top-level scan roots as empty", async () => {
      const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
      const fs: FSLike = {
        async *readDir() {
          yield* [];
          throw missing;
        },
        async readTextFile() {
          throw new Error("must not read");
        },
      };

      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 0);
      assertEquals(analysis.sharedDeps.size, 0);
    });

    it("rejects a page source above the framework file-size limit", async () => {
      const fs = createMockFS(
        {
          "/project/pages/oversized.mdx": "x".repeat(
            DEFAULT_MAX_FILE_SIZE_BYTES + 1,
          ),
        },
        {
          "/project/pages": [{ name: "oversized.mdx", isFile: true }],
        },
      );

      await assertRejects(
        () => analyzeProjectChunks("/project", fs),
        RangeError,
        `${DEFAULT_MAX_FILE_SIZE_BYTES} bytes`,
      );
    });

    it("analyzes imports from .md files with the same dependency rules as .mdx", async () => {
      const fs = createMockFS(
        {
          "/project/pages/readme.md": 'import x from "marked";\nimport local from "./local.ts";\n',
        },
        {
          "/project/pages": [{ name: "readme.md", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 1);
      const page = analysis.pages.get("/project/pages/readme.md");
      assertExists(page);
      assertEquals(page.shared, ["marked"]);
      assertEquals(page.local, ["./local.ts"]);
      assertEquals(analysis.sharedDeps.get("marked"), 1);
    });
  });
});
