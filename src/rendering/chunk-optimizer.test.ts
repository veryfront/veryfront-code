import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  analyzeProjectChunks,
  type ChunkAnalysis,
  generateChunkManifest,
} from "./chunk-optimizer.ts";

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
          if (path in files) return files[path];
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

    it("detects remote URL imports", async () => {
      const fs = createMockFS(
        {
          "/project/pages/index.mdx": 'import x from "https://esm.sh/react";\n',
        },
        {
          "/project/pages": [{ name: "index.mdx", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      const page = analysis.pages.get("/project/pages/index.mdx");
      assertExists(page);
      assertEquals(page.remote.includes("https://esm.sh/react"), true);
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

    it("handles unreadable files gracefully", async () => {
      const fs = createMockFS(
        {},
        {
          "/project/pages": [{ name: "broken.mdx", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 0);
    });

    it("also scans .md files", async () => {
      const fs = createMockFS(
        {
          "/project/pages/readme.md": 'import x from "marked";\n',
        },
        {
          "/project/pages": [{ name: "readme.md", isFile: true }],
        },
      );
      const analysis = await analyzeProjectChunks("/project", fs);
      assertEquals(analysis.pages.size, 1);
    });
  });
});
