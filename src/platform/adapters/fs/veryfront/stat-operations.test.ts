import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile, VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { ContentContextProvider } from "./read-operations.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { StatOperations } from "./stat-operations.ts";

// deno-lint-ignore no-explicit-any
function createMockClient(overrides: Record<string, any> = {}): VeryfrontAPIClient {
  return {
    getRequestBranch: () => "main",
    listAllFiles: () => Promise.resolve([]),
    listPublishedFiles: () => Promise.resolve([]),
    searchFiles: () => Promise.resolve([]),
    ...overrides,
  } as unknown as VeryfrontAPIClient;
}

function makeFile(path: string, opts: Partial<ProjectFile> = {}): ProjectFile {
  return {
    path,
    size: opts.size ?? 100,
    type: opts.type ?? "component",
    updated_at: opts.updated_at ?? "2025-01-01T00:00:00Z",
    ...opts,
  } as ProjectFile;
}

function createBranchContextWithFiles(files: ProjectFile[]): ContentContextProvider {
  return {
    isProductionMode: () => false,
    getReleaseId: () => null,
    getContentContext: () => ({
      sourceType: "branch" as const,
      projectSlug: "test",
      branch: "main",
    }),
    getFileList: () => Promise.resolve(files),
    isPersistentCacheInvalidated: () => false,
  };
}

function createStatOps(
  client: VeryfrontAPIClient = createMockClient(),
  pathNormalizer: PathNormalizer = new PathNormalizer(),
  contextProvider?: ContentContextProvider,
): StatOperations {
  return new StatOperations(
    client,
    new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
    pathNormalizer,
    contextProvider,
  );
}

describe("StatOperations", () => {
  describe("class", () => {
    it("should export StatOperations class", () => {
      assertExists(StatOperations);
      assertEquals(typeof StatOperations, "function");
    });
  });

  describe("instance", () => {
    it("should be instantiable without context provider", () => {
      assertExists(createStatOps());
    });

    it("should be instantiable with context provider", () => {
      assertExists(
        createStatOps(createMockClient(), new PathNormalizer(), createBranchContextWithFiles([])),
      );
    });

    it("should have all required methods", () => {
      const statOps = createStatOps();
      assertEquals(typeof statOps.stat, "function");
      assertEquals(typeof statOps.exists, "function");
      assertEquals(typeof statOps.resolveFile, "function");
      assertEquals(typeof statOps.clearIndex, "function");
      assertEquals(typeof statOps.getOriginalApiPath, "function");
    });
  });

  describe("getOriginalApiPath", () => {
    it("should return input path when no mapping exists", () => {
      const statOps = createStatOps();
      assertEquals(statOps.getOriginalApiPath("test/path.ts"), "test/path.ts");
    });

    it("should return input path for unmapped paths", () => {
      const statOps = createStatOps();
      assertEquals(statOps.getOriginalApiPath("pages/index.tsx"), "pages/index.tsx");
      assertEquals(statOps.getOriginalApiPath("components/Header.tsx"), "components/Header.tsx");
    });
  });

  describe("clearIndex", () => {
    it("should clear without error", () => {
      const statOps = createStatOps();
      statOps.clearIndex();
    });

    it("should allow clearing multiple times", () => {
      const statOps = createStatOps();
      statOps.clearIndex();
      statOps.clearIndex();
    });
  });

  describe("stat", () => {
    it("should stat a file from the index", async () => {
      const files = [
        makeFile("pages/index.tsx", { size: 250, updated_at: "2025-06-15T10:30:00Z" }),
        makeFile("pages/about.tsx", { size: 180 }),
      ];

      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      const info = await statOps.stat("pages/index.tsx");
      assertEquals(info.isFile, true);
      assertEquals(info.isDirectory, false);
      assertEquals(info.isSymlink, false);
      assertEquals(info.size, 250);
      assertExists(info.mtime);
    });

    it("should stat a directory from the index", async () => {
      const files = [makeFile("pages/index.tsx"), makeFile("pages/about.tsx")];
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      const info = await statOps.stat("pages");
      assertEquals(info.isDirectory, true);
      assertEquals(info.isFile, false);
      assertEquals(info.size, 0);
    });

    it("should throw for non-existent path", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      try {
        await statOps.stat("nonexistent/file.tsx");
        assertEquals(true, false, "Should have thrown");
      } catch (e) {
        assertExists(e);
      }
    });

    it("should normalize paths with project dir", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer("/project/root/"),
        createBranchContextWithFiles([makeFile("pages/index.tsx", { size: 100 })]),
      );

      const info = await statOps.stat("/project/root/pages/index.tsx");
      assertEquals(info.isFile, true);
      assertEquals(info.size, 100);
    });

    it("should handle deeply nested directories", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("src/components/ui/buttons/PrimaryButton.tsx")]),
      );

      const srcInfo = await statOps.stat("src");
      assertEquals(srcInfo.isDirectory, true);

      const componentsInfo = await statOps.stat("src/components");
      assertEquals(componentsInfo.isDirectory, true);

      const uiInfo = await statOps.stat("src/components/ui");
      assertEquals(uiInfo.isDirectory, true);

      const buttonsInfo = await statOps.stat("src/components/ui/buttons");
      assertEquals(buttonsInfo.isDirectory, true);
    });

    it("should handle trailing slash paths by normalizing to index file", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/blog/", { type: "page" })]),
      );

      const info = await statOps.stat("pages/blog/index.mdx");
      assertEquals(info.isFile, true);
    });

    it("should map trailing slash path to original for getOriginalApiPath", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/blog/", { type: "page" })]),
      );

      await statOps.stat("pages/blog/index.mdx");
      assertEquals(statOps.getOriginalApiPath("pages/blog/index.mdx"), "pages/blog/");
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.exists("pages/index.tsx"), true);
    });

    it("should return true for existing directory", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.exists("pages"), true);
    });

    it("should return false for non-existent path", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.exists("nonexistent.tsx"), false);
    });
  });

  describe("resolveFile", () => {
    it("should resolve exact path match", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("pages/index.tsx"), "pages/index.tsx");
    });

    it("should resolve with extension fallback", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("pages/index"), "pages/index.tsx");
    });

    it("should resolve with extension priority order", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.mdx"), makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("pages/index"), "pages/index.mdx");
    });

    it("should resolve index file in directory", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("components/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("components"), "components/index.tsx");
    });

    it("should return null for non-existent file with complete index", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("nonexistent"), null);
    });

    it("should skip API search for framework paths", async () => {
      let searchCalled = false;
      const client = createMockClient({
        listAllFiles: () => Promise.resolve([makeFile("pages/index.tsx")]),
        searchFiles: () => {
          searchCalled = true;
          return Promise.resolve([]);
        },
      });

      const statOps = createStatOps(client, new PathNormalizer(), {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
        isPersistentCacheInvalidated: () => false,
      });

      await statOps.resolveFile("_veryfront/react/component");
      assertEquals(searchCalled, false);

      await statOps.resolveFile("_veryfront/platform/polyfills/node-noop");
      assertEquals(searchCalled, false);
    });

    it("should try pages/ prefix for non-pages paths", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/about.tsx")]),
      );

      assertEquals(await statOps.resolveFile("about"), "pages/about.tsx");
    });

    it("should not add pages/ prefix when path already starts with pages/", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("pages/index"), "pages/index.tsx");
    });

    it("should resolve with different extension when original not found", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("utils/helpers.ts")]),
      );

      assertEquals(await statOps.resolveFile("utils/helpers.tsx"), "utils/helpers.ts");
    });
  });

  describe("index building", () => {
    it("should build index from file list provider", async () => {
      const files = [
        makeFile("pages/index.tsx", { size: 100 }),
        makeFile("pages/about.tsx", { size: 200 }),
        makeFile("components/Header.tsx", { size: 300 }),
      ];

      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      assertEquals((await statOps.stat("pages/index.tsx")).isFile, true);
      assertEquals((await statOps.stat("pages/about.tsx")).isFile, true);
      assertEquals((await statOps.stat("components/Header.tsx")).isFile, true);
      assertEquals((await statOps.stat("pages")).isDirectory, true);
      assertEquals((await statOps.stat("components")).isDirectory, true);
    });

    it("should rebuild index after clearIndex", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.exists("pages/index.tsx"), true);

      statOps.clearIndex();

      assertEquals(await statOps.exists("pages/index.tsx"), true);
    });

    it("should handle concurrent index build requests", async () => {
      let buildCount = 0;
      const files = [makeFile("pages/index.tsx")];

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
        getFileList: async () => {
          buildCount++;
          await new Promise((r) => setTimeout(r, 10));
          return files;
        },
        isPersistentCacheInvalidated: () => false,
      };

      const statOps = createStatOps(createMockClient(), new PathNormalizer(), contextProvider);

      const [exists1, exists2, exists3] = await Promise.all([
        statOps.exists("pages/index.tsx"),
        statOps.exists("pages/index.tsx"),
        statOps.exists("pages/index.tsx"),
      ]);

      assertEquals(exists1, true);
      assertEquals(exists2, true);
      assertEquals(exists3, true);
      assertEquals(buildCount, 1);
    });

    it("should fall back to API when no file list provider exists", async () => {
      let apiCalled = false;
      const client = createMockClient({
        listAllFiles: () => {
          apiCalled = true;
          return Promise.resolve([makeFile("pages/index.tsx")]);
        },
      });

      const statOps = createStatOps(client, new PathNormalizer(), {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
        isPersistentCacheInvalidated: () => false,
      });

      assertEquals(await statOps.exists("pages/index.tsx"), true);
      assertEquals(apiCalled, true);
    });

    it("should use published files API for release context", async () => {
      let publishedCalled = false;
      const client = createMockClient({
        listPublishedFiles: () => {
          publishedCalled = true;
          return Promise.resolve([makeFile("pages/index.tsx")]);
        },
      });

      const statOps = createStatOps(client, new PathNormalizer(), {
        isProductionMode: () => true,
        getReleaseId: () => "rel-1",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "rel-1",
        }),
        isPersistentCacheInvalidated: () => false,
        isReleaseBeingInvalidated: () => false,
      });

      assertEquals(await statOps.exists("pages/index.tsx"), true);
      assertEquals(publishedCalled, true);
    });
  });

  describe("circuit breaker for API search", () => {
    it("should disable API search after repeated failures", async () => {
      let searchCallCount = 0;
      const client = createMockClient({
        listAllFiles: () => Promise.resolve([makeFile("pages/index.tsx")]),
        searchFiles: () => {
          searchCallCount++;
          return Promise.reject(new Error("API error"));
        },
      });

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        {
          isProductionMode: () => false,
          getReleaseId: () => null,
          getContentContext: () => ({
            sourceType: "branch" as const,
            projectSlug: "test",
            branch: "main",
          }),
          isPersistentCacheInvalidated: () => false,
        },
      );

      for (let i = 0; i < 5; i++) {
        await statOps.resolveFile(`nonexistent-${i}`);
      }

      const searchCallsBefore = searchCallCount;

      await statOps.resolveFile("nonexistent-6");

      assertEquals(searchCallCount, searchCallsBefore);
    });
  });
});
