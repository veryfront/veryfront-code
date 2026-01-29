import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ChunkAnalysis, generateChunkManifest } from "./chunk-optimizer.ts";

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
      const chunk = manifest.chunks["common"];
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
});
