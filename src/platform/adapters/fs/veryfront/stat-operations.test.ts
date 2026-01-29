import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile, VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { StatOperations } from "./stat-operations.ts";
import type { ContentContextProvider } from "./read-operations.ts";

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

function makeFile(
  path: string,
  opts: Partial<ProjectFile> = {},
): ProjectFile {
  return {
    path,
    size: opts.size ?? 100,
    type: opts.type ?? "component",
    updated_at: opts.updated_at ?? "2025-01-01T00:00:00Z",
    ...opts,
  } as ProjectFile;
}

function createBranchContextWithFiles(
  files: ProjectFile[],
): ContentContextProvider {
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

describe("StatOperations", () => {
  describe("class", () => {
    it("should export StatOperations class", () => {
      assertExists(StatOperations);
      assertEquals(typeof StatOperations, "function");
    });
  });

  describe("instance", () => {
    it("should be instantiable without context provider", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      assertExists(statOps);
    });

    it("should be instantiable with context provider", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles([]),
      );
      assertExists(statOps);
    });

    it("should have all required methods", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      assertEquals(typeof statOps.stat, "function");
      assertEquals(typeof statOps.exists, "function");
      assertEquals(typeof statOps.resolveFile, "function");
      assertEquals(typeof statOps.clearIndex, "function");
      assertEquals(typeof statOps.getOriginalApiPath, "function");
    });
  });

  describe("getOriginalApiPath", () => {
    it("should return input path when no mapping exists", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      assertEquals(statOps.getOriginalApiPath("test/path.ts"), "test/path.ts");
    });

    it("should return input path for unmapped paths", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      assertEquals(statOps.getOriginalApiPath("pages/index.tsx"), "pages/index.tsx");
      assertEquals(statOps.getOriginalApiPath("components/Header.tsx"), "components/Header.tsx");
    });
  });

  describe("clearIndex", () => {
    it("should clear without error", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      statOps.clearIndex();
    });

    it("should allow clearing multiple times", () => {
      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
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

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
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
      const files = [
        makeFile("pages/index.tsx"),
        makeFile("pages/about.tsx"),
      ];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      const info = await statOps.stat("pages");
      assertEquals(info.isDirectory, true);
      assertEquals(info.isFile, false);
      assertEquals(info.size, 0);
    });

    it("should throw for non-existent path", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      try {
        await statOps.stat("nonexistent/file.tsx");
        assertEquals(true, false, "Should have thrown");
      } catch (e) {
        assertExists(e);
      }
    });

    it("should normalize paths with project dir", async () => {
      const files = [makeFile("pages/index.tsx", { size: 100 })];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer("/project/root/"),
        createBranchContextWithFiles(files),
      );

      const info = await statOps.stat("/project/root/pages/index.tsx");
      assertEquals(info.isFile, true);
      assertEquals(info.size, 100);
    });

    it("should handle deeply nested directories", async () => {
      const files = [
        makeFile("src/components/ui/buttons/PrimaryButton.tsx"),
      ];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // All parent directories should exist
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
      const files = [
        makeFile("pages/blog/", { type: "page" }),
      ];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // The trailing slash path is normalized to pages/blog/index.mdx for page type
      const info = await statOps.stat("pages/blog/index.mdx");
      assertEquals(info.isFile, true);
    });

    it("should map trailing slash path to original for getOriginalApiPath", async () => {
      const files = [
        makeFile("pages/blog/", { type: "page" }),
      ];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Build the index by calling stat
      await statOps.stat("pages/blog/index.mdx");

      // The normalized path should map back to the original trailing-slash path
      assertEquals(statOps.getOriginalApiPath("pages/blog/index.mdx"), "pages/blog/");
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      assertEquals(await statOps.exists("pages/index.tsx"), true);
    });

    it("should return true for existing directory", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      assertEquals(await statOps.exists("pages"), true);
    });

    it("should return false for non-existent path", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      assertEquals(await statOps.exists("nonexistent.tsx"), false);
    });
  });

  describe("resolveFile", () => {
    it("should resolve exact path match", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      assertEquals(await statOps.resolveFile("pages/index.tsx"), "pages/index.tsx");
    });

    it("should resolve with extension fallback", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Requesting without extension should find .tsx version
      assertEquals(await statOps.resolveFile("pages/index"), "pages/index.tsx");
    });

    it("should resolve with extension priority order", async () => {
      // Both .mdx and .tsx exist - .mdx should win based on EXTENSION_PRIORITY
      const files = [
        makeFile("pages/index.mdx"),
        makeFile("pages/index.tsx"),
      ];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // .mdx is first in EXTENSION_PRIORITY for StatOperations
      assertEquals(await statOps.resolveFile("pages/index"), "pages/index.mdx");
    });

    it("should resolve index file in directory", async () => {
      const files = [makeFile("components/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      assertEquals(await statOps.resolveFile("components"), "components/index.tsx");
    });

    it("should return null for non-existent file with complete index", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
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

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        // No getFileList so it falls through to API search path
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

      await statOps.resolveFile("exports/something");
      assertEquals(searchCalled, false);

      await statOps.resolveFile("react/component");
      assertEquals(searchCalled, false);

      await statOps.resolveFile("veryfront/utils");
      assertEquals(searchCalled, false);
    });

    it("should try pages/ prefix for non-pages paths", async () => {
      const files = [makeFile("pages/about.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Requesting "about" should find "pages/about.tsx"
      assertEquals(await statOps.resolveFile("about"), "pages/about.tsx");
    });

    it("should not add pages/ prefix when path already starts with pages/", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Should find directly
      assertEquals(await statOps.resolveFile("pages/index"), "pages/index.tsx");
    });

    it("should resolve with different extension when original not found", async () => {
      // Only .ts exists, not .tsx
      const files = [makeFile("utils/helpers.ts")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Request .tsx, should find .ts via extension stripping and priority
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

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Trigger index build via stat
      assertEquals((await statOps.stat("pages/index.tsx")).isFile, true);
      assertEquals((await statOps.stat("pages/about.tsx")).isFile, true);
      assertEquals((await statOps.stat("components/Header.tsx")).isFile, true);
      assertEquals((await statOps.stat("pages")).isDirectory, true);
      assertEquals((await statOps.stat("components")).isDirectory, true);
    });

    it("should rebuild index after clearIndex", async () => {
      const files = [makeFile("pages/index.tsx")];

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles(files),
      );

      // Build index
      assertEquals(await statOps.exists("pages/index.tsx"), true);

      // Clear
      statOps.clearIndex();

      // Should rebuild on next access
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

      const statOps = new StatOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        contextProvider,
      );

      // Fire concurrent stat requests
      const [exists1, exists2, exists3] = await Promise.all([
        statOps.exists("pages/index.tsx"),
        statOps.exists("pages/index.tsx"),
        statOps.exists("pages/index.tsx"),
      ]);

      assertEquals(exists1, true);
      assertEquals(exists2, true);
      assertEquals(exists3, true);
      // Should only build the index once
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

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
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

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        {
          isProductionMode: () => true,
          getReleaseId: () => "rel-1",
          getContentContext: () => ({
            sourceType: "release" as const,
            projectSlug: "test",
            releaseId: "rel-1",
          }),
          isPersistentCacheInvalidated: () => false,
          isReleaseBeingInvalidated: () => false,
        },
      );

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
          // No getFileList - forces API search fallback
        },
      );

      // Trigger 5 search failures to trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        await statOps.resolveFile(`nonexistent-${i}`);
      }

      const searchCallsBefore = searchCallCount;

      // Next call should be blocked by circuit breaker
      await statOps.resolveFile("nonexistent-6");

      // No additional search calls should have been made
      assertEquals(searchCallCount, searchCallsBefore);
    });
  });
});
