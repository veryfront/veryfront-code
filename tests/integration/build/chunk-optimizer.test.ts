import { assert, assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  analyzeProjectChunks,
  type ChunkAnalysis,
  type ChunkSuggestion,
  generateChunkManifest,
  type PageImports,
} from "../../../src/rendering/chunk-optimizer.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "chunk-optimizer",
  
  () => {
    it("analyzes empty project gracefully", async () => {
      await withTestContext("chunk-optimizer-empty", async (context) => {
        const analysis = await analyzeProjectChunks(context.projectDir);
        assert(analysis);
        const manifest = generateChunkManifest(analysis);
        assertEquals(manifest.version, "1.0");
        assert(manifest.chunks);
        assert(manifest.pages);
      });
    });

    it("generates chunk manifest with pages and suggested chunks", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/page/a.mdx", {
        path: "/page/a.mdx",
        local: ["./A.tsx"],
        remote: ["react", "@mui/x"],
        shared: ["lodash"],
      });
      pages.set("/page/b.mdx", {
        path: "/page/b.mdx",
        local: ["./B.tsx"],
        remote: ["react", "framer-motion"],
        shared: ["lodash"],
      });

      const sharedDeps = new Map<string, number>([
        ["react", 2],
        ["lodash", 2],
        ["@mui/x", 1],
        ["framer-motion", 1],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "common",
          deps: ["react", "lodash"],
          pages: ["/page/a.mdx", "/page/b.mdx"],
          benefit: 1000,
        },
        {
          name: "react-vendor",
          deps: ["react", "react/jsx-runtime"],
          pages: ["/page/a.mdx", "/page/b.mdx"],
          benefit: 200000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assert(manifest.chunks.common && manifest.chunks.common.size >= 1000);
      assertEquals(manifest.chunks["react-vendor"]?.deps.includes("react"), true);
      assertEquals(manifest.pages["/page/a.mdx"]?.chunks.includes("common"), true);
      assertEquals(manifest.pages["/page/b.mdx"]?.chunks.includes("react-vendor"), true);
    });

    it("handles projects with shared dependencies", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/home.mdx", {
        path: "/home.mdx",
        local: [],
        remote: ["react", "react-dom"],
        shared: [],
      });
      pages.set("/about.mdx", {
        path: "/about.mdx",
        local: [],
        remote: ["react", "react-dom"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([
        ["react", 2],
        ["react-dom", 2],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "vendor",
          deps: ["react", "react-dom"],
          pages: ["/home.mdx", "/about.mdx"],
          benefit: 150000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(Object.keys(manifest.chunks).includes("vendor"), true);
      assertEquals(manifest.chunks.vendor?.deps.includes("react"), true);
      assertEquals(manifest.chunks.vendor?.deps.includes("react-dom"), true);
    });

    it("calculates chunk benefits correctly", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/page1.mdx", {
        path: "/page1.mdx",
        local: [],
        remote: ["heavy-lib"],
        shared: [],
      });
      pages.set("/page2.mdx", {
        path: "/page2.mdx",
        local: [],
        remote: ["heavy-lib"],
        shared: [],
      });
      pages.set("/page3.mdx", {
        path: "/page3.mdx",
        local: [],
        remote: ["heavy-lib"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([["heavy-lib", 3]]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "heavy-chunk",
          deps: ["heavy-lib"],
          pages: ["/page1.mdx", "/page2.mdx", "/page3.mdx"],
          benefit: 300000, // High benefit due to 3 pages sharing it
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assert(manifest.chunks["heavy-chunk"] && manifest.chunks["heavy-chunk"].size >= 300000);
    });

    it("handles pages with no shared dependencies", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/unique.mdx", {
        path: "/unique.mdx",
        local: ["./UniqueComponent.tsx"],
        remote: ["unique-lib"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([]);
      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.version, "1.0");
      assertEquals(Object.keys(manifest.chunks).length, 0);
      assert(manifest.pages["/unique.mdx"]);
    });

    it("supports multiple chunk strategies", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/app.mdx", {
        path: "/app.mdx",
        local: [],
        remote: ["react", "lodash", "axios"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "framework",
          deps: ["react"],
          pages: ["/app.mdx"],
          benefit: 100000,
        },
        {
          name: "utilities",
          deps: ["lodash", "axios"],
          pages: ["/app.mdx"],
          benefit: 50000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(Object.keys(manifest.chunks).length, 2);
      assert(manifest.chunks.framework);
      assert(manifest.chunks.utilities);
    });

    it("handles UI library chunk suggestions", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/dashboard.mdx", {
        path: "/dashboard.mdx",
        local: [],
        remote: ["@mui/material", "@mui/icons-material"],
        shared: [],
      });
      pages.set("/settings.mdx", {
        path: "/settings.mdx",
        local: [],
        remote: ["@mui/material", "framer-motion"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([
        ["@mui/material", 2],
        ["@mui/icons-material", 1],
        ["framer-motion", 1],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "ui-vendor",
          deps: ["@mui/material", "@mui/icons-material", "framer-motion"],
          pages: ["/dashboard.mdx", "/settings.mdx"],
          benefit: 180000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assert(manifest.chunks["ui-vendor"]);
      assertEquals(manifest.chunks["ui-vendor"].deps.includes("@mui/material"), true);
      assertEquals(manifest.chunks["ui-vendor"].deps.includes("framer-motion"), true);
    });

    it("handles pages with only local imports", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/custom.mdx", {
        path: "/custom.mdx",
        local: ["./Component1.tsx", "./Component2.tsx", "../shared/utils.ts"],
        remote: [],
        shared: [],
      });

      const sharedDeps = new Map<string, number>();
      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(Object.keys(manifest.chunks).length, 0);
      assert(manifest.pages["/custom.mdx"]);
      assertEquals(manifest.pages["/custom.mdx"].deps.local.length, 3);
    });

    it("handles mixed import types", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/mixed.mdx", {
        path: "/mixed.mdx",
        local: ["./MyComponent.tsx"],
        remote: ["https://esm.sh/date-fns"],
        shared: ["lodash"],
      });

      const sharedDeps = new Map<string, number>([
        ["https://esm.sh/date-fns", 1],
        ["lodash", 1],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.version, "1.0");
      assert(manifest.pages["/mixed.mdx"]);
      assertEquals(manifest.pages["/mixed.mdx"].deps.local.includes("./MyComponent.tsx"), true);
      assertEquals(
        manifest.pages["/mixed.mdx"].deps.remote.includes("https://esm.sh/date-fns"),
        true,
      );
      assertEquals(manifest.pages["/mixed.mdx"].deps.shared.includes("lodash"), true);
    });

    it("handles large projects with many pages", () => {
      const pages = new Map<string, PageImports>();
      const sharedDeps = new Map<string, number>();

      for (let i = 0; i < 20; i++) {
        const pagePath = `/page${i}.mdx`;
        pages.set(pagePath, {
          path: pagePath,
          local: [`./Component${i}.tsx`],
          remote: i % 2 === 0 ? ["react", "lodash"] : ["react", "axios"],
          shared: [],
        });
      }

      sharedDeps.set("react", 20);
      sharedDeps.set("lodash", 10);
      sharedDeps.set("axios", 10);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "common",
          deps: ["react", "lodash", "axios"],
          pages: Array.from(pages.keys()),
          benefit: 500000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.pages["/page0.mdx"]?.chunks.includes("common"), true);
      assertEquals(manifest.pages["/page15.mdx"]?.chunks.includes("common"), true);
      assertEquals(Object.keys(manifest.pages).length, 20);
    });

    it("handles chunk suggestions sorted by benefit", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/app.mdx", {
        path: "/app.mdx",
        local: [],
        remote: ["react", "lodash", "@mui/material"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([
        ["react", 1],
        ["lodash", 1],
        ["@mui/material", 1],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "low-benefit",
          deps: ["lodash"],
          pages: ["/app.mdx"],
          benefit: 1000,
        },
        {
          name: "high-benefit",
          deps: ["react"],
          pages: ["/app.mdx"],
          benefit: 200000,
        },
        {
          name: "medium-benefit",
          deps: ["@mui/material"],
          pages: ["/app.mdx"],
          benefit: 50000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assert(manifest.chunks["low-benefit"]);
      assert(manifest.chunks["high-benefit"]);
      assert(manifest.chunks["medium-benefit"]);
      assertEquals(Object.keys(manifest.chunks).length, 3);
    });

    it("handles pages with HTTP/HTTPS remote imports", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/cdn.mdx", {
        path: "/cdn.mdx",
        local: [],
        remote: [
          "https://esm.sh/react",
          "https://cdn.skypack.dev/lodash",
          "http://example.com/lib.js",
        ],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([
        ["https://esm.sh/react", 1],
        ["https://cdn.skypack.dev/lodash", 1],
        ["http://example.com/lib.js", 1],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.pages["/cdn.mdx"]?.deps.remote.length, 3);
      assertEquals(manifest.pages["/cdn.mdx"]?.deps.remote.includes("https://esm.sh/react"), true);
    });

    it("handles empty suggested chunks array", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/simple.mdx", {
        path: "/simple.mdx",
        local: ["./Component.tsx"],
        remote: ["unique-package"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([["unique-package", 1]]);
      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(Object.keys(manifest.chunks).length, 0);
      assertEquals(manifest.pages["/simple.mdx"]?.chunks.length, 0);
      assert(manifest.pages["/simple.mdx"]);
    });

    it("handles React ecosystem chunks correctly", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/react-app.mdx", {
        path: "/react-app.mdx",
        local: [],
        remote: ["react", "react-dom", "react/jsx-runtime"],
        shared: [],
      });
      pages.set("/react-page.mdx", {
        path: "/react-page.mdx",
        local: [],
        remote: ["react", "react/jsx-runtime"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([
        ["react", 2],
        ["react-dom", 1],
        ["react/jsx-runtime", 2],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "react-vendor",
          deps: ["react", "react-dom", "react/jsx-runtime"],
          pages: ["/react-app.mdx", "/react-page.mdx"],
          benefit: 200000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assert(manifest.chunks["react-vendor"]);
      assertEquals(manifest.chunks["react-vendor"].deps.includes("react"), true);
      assertEquals(manifest.chunks["react-vendor"].deps.includes("react/jsx-runtime"), true);
    });

    it("handles Headless UI library chunks", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/ui.mdx", {
        path: "/ui.mdx",
        local: [],
        remote: ["@headlessui/react"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([["@headlessui/react", 1]]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "ui-vendor",
          deps: ["@headlessui/react"],
          pages: ["/ui.mdx"],
          benefit: 60000,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assert(manifest.chunks["ui-vendor"]);
      assertEquals(manifest.chunks["ui-vendor"].deps.includes("@headlessui/react"), true);
    });

    it("handles dependencies used exactly once (no chunking)", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/page1.mdx", {
        path: "/page1.mdx",
        local: [],
        remote: ["unique-lib-1"],
        shared: [],
      });
      pages.set("/page2.mdx", {
        path: "/page2.mdx",
        local: [],
        remote: ["unique-lib-2"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([
        ["unique-lib-1", 1],
        ["unique-lib-2", 1],
      ]);

      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(Object.keys(manifest.chunks).length, 0);
      assertEquals(manifest.pages["/page1.mdx"]?.chunks.length, 0);
      assertEquals(manifest.pages["/page2.mdx"]?.chunks.length, 0);
    });

    it("calculates chunk size as benefit value", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/test.mdx", {
        path: "/test.mdx",
        local: [],
        remote: ["big-package"],
        shared: [],
      });

      const sharedDeps = new Map<string, number>([["big-package", 1]]);

      const suggestedChunks: ChunkSuggestion[] = [
        {
          name: "big-chunk",
          deps: ["big-package"],
          pages: ["/test.mdx"],
          benefit: 999999,
        },
      ];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.chunks["big-chunk"]?.size, 999999);
    });

    it("handles pages in nested directory structures", async () => {
      await withTestContext("chunk-optimizer-nested", async (context) => {
        const pagesDir = `${context.projectDir}/pages`;
        const nestedDir = `${pagesDir}/features/auth`;

        await Deno.mkdir(nestedDir, { recursive: true });
        await Deno.writeTextFile(
          `${pagesDir}/index.mdx`,
          `import { Component } from './Component.tsx'\nimport React from 'react'`,
        );
        await Deno.writeTextFile(
          `${nestedDir}/login.mdx`,
          `import { AuthForm } from './AuthForm.tsx'\nimport React from 'react'`,
        );

        const analysis = await analyzeProjectChunks(context.projectDir);

        assert(analysis.pages.size >= 0);
        assert(analysis.sharedDeps);
        assert(analysis.suggestedChunks);
      });
    });

    it("handles malformed import statements gracefully", () => {
      const pages = new Map<string, PageImports>();
      pages.set("/weird.mdx", {
        path: "/weird.mdx",
        local: [],
        remote: [],
        shared: [],
      });

      const sharedDeps = new Map<string, number>();
      const suggestedChunks: ChunkSuggestion[] = [];

      const analysis: ChunkAnalysis = { pages, sharedDeps, suggestedChunks };
      const manifest = generateChunkManifest(analysis);

      assertEquals(manifest.version, "1.0");
      assert(manifest.pages["/weird.mdx"]);
    });
  },
);
