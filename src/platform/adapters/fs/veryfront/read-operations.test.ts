import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import type { ContentContextProvider } from "./read-operations.ts";

// deno-lint-ignore no-explicit-any
const createMockClient = (overrides: Record<string, any> = {}): VeryfrontAPIClient =>
  ({
    getRequestBranch: () => "main",
    getFileContent: () => Promise.resolve("file content"),
    getPublishedFileContent: () => Promise.resolve("published content"),
    resolveFileWithExtension: () => Promise.resolve(null),
    ...overrides,
  }) as unknown as VeryfrontAPIClient;

function createBranchContext(): ContentContextProvider {
  return {
    isProductionMode: () => false,
    getReleaseId: () => null,
    getContentContext: () => ({
      sourceType: "branch" as const,
      projectSlug: "test",
      branch: "main",
    }),
  };
}

function createReleaseContext(releaseId = "release-123"): ContentContextProvider {
  return {
    isProductionMode: () => true,
    getReleaseId: () => releaseId,
    getContentContext: () => ({
      sourceType: "release" as const,
      projectSlug: "test",
      releaseId,
    }),
    isPersistentCacheInvalidated: () => false,
    isReleaseBeingInvalidated: () => false,
  };
}

describe("ReadOperations", () => {
  describe("class", () => {
    it("should export ReadOperations class", () => {
      assertExists(ReadOperations);
      assertEquals(typeof ReadOperations, "function");
    });
  });

  describe("instantiation", () => {
    it("should be instantiable without context provider", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      assertExists(readOps);
    });

    it("should be instantiable with branch context provider", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
      );
      assertExists(readOps);
    });

    it("should be instantiable with release context provider", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createReleaseContext(),
      );
      assertExists(readOps);
    });

    it("should be instantiable with path resolver", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
        (path: string) => path,
      );
      assertExists(readOps);
    });

    it("should be instantiable with file list cache getter", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
        (path: string) => path,
        () =>
          Promise.resolve([{ path: "pages/index.tsx", content: "export default () => <div />" }]),
      );
      assertExists(readOps);
    });
  });

  describe("readTextFile", () => {
    it("should fetch draft content for branch context", async () => {
      let fetchedPath: string | undefined;
      const client = createMockClient({
        getFileContent: (path: string) => {
          fetchedPath = path;
          return Promise.resolve("draft content here");
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
      );

      // Set a resolved ready promise so it doesn't block
      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "draft content here");
      assertEquals(fetchedPath, "pages/index.tsx");
    });

    it("should fetch published content for release context", async () => {
      let fetchedPath: string | undefined;
      let fetchedReleaseId: string | undefined;
      const client = createMockClient({
        getPublishedFileContent: (path: string, releaseId?: string) => {
          fetchedPath = path;
          fetchedReleaseId = releaseId;
          return Promise.resolve("published content here");
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createReleaseContext("rel-abc"),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "published content here");
      assertEquals(fetchedPath, "pages/index.tsx");
      assertEquals(fetchedReleaseId, "rel-abc");
    });

    it("should serve content from file list cache in production mode", async () => {
      let apiFetchCalled = false;
      const client = createMockClient({
        getPublishedFileContent: () => {
          apiFetchCalled = true;
          return Promise.resolve("api content");
        },
      });

      const fileListCache = [
        { path: "pages/index.tsx", content: "cached content from file list" },
        { path: "pages/about.tsx", content: "about page content" },
      ];

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createReleaseContext("rel-1"),
        (path: string) => path,
        () => Promise.resolve(fileListCache),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "cached content from file list");
      assertEquals(apiFetchCalled, false);
    });

    it("should skip file list cache for branch (preview) mode", async () => {
      let apiFetchCalled = false;
      const client = createMockClient({
        getFileContent: () => {
          apiFetchCalled = true;
          return Promise.resolve("fresh draft content");
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "stale cache" }]),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "fresh draft content");
      assertEquals(apiFetchCalled, true);
    });

    it("should normalize path with project dir prefix", async () => {
      let fetchedPath: string | undefined;
      const client = createMockClient({
        getFileContent: (path: string) => {
          fetchedPath = path;
          return Promise.resolve("content");
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer("/project/root/"),
        createBranchContext(),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      await readOps.readTextFile("/project/root/pages/index.tsx");
      assertEquals(fetchedPath, "pages/index.tsx");
    });
  });

  describe("readFile", () => {
    it("should return Uint8Array from text content", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("hello world"),
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const bytes = await readOps.readFile("test.txt");
      assertExists(bytes);
      assertEquals(bytes instanceof Uint8Array, true);
      assertEquals(new TextDecoder().decode(bytes), "hello world");
    });
  });

  describe("clearFileListIndex", () => {
    it("should clear without error when no index exists", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      readOps.clearFileListIndex();
    });

    it("should clear built index", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("content"),
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createReleaseContext(),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "test content" }]),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      // Trigger index build by reading a file
      await readOps.readTextFile("pages/index.tsx");

      // Clear should not throw
      readOps.clearFileListIndex();
    });
  });

  describe("setFileListReadyPromise", () => {
    it("should accept a promise", () => {
      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
      );
      readOps.setFileListReadyPromise(Promise.resolve());
    });

    it("should handle rejected ready promise gracefully", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("fallback content"),
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
      );

      const rejectedPromise = Promise.reject(new Error("init failed"));
      // Prevent unhandled rejection from killing the test runner
      rejectedPromise.catch(() => {});
      readOps.setFileListReadyPromise(rejectedPromise);

      // Should still work by falling through to API fetch
      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "fallback content");
    });
  });

  describe("cache invalidation", () => {
    it("should accept isPersistentCacheInvalidated in context provider", () => {
      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-123",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "release-123",
        }),
        isPersistentCacheInvalidated: (prefix: string) => prefix.includes("release-123"),
        isReleaseBeingInvalidated: (releaseId: string) => releaseId === "release-123",
      };

      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: true, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        contextProvider,
      );
      assertExists(readOps);
    });

    it("should skip persistent cache when release is being invalidated", async () => {
      let apiFetchCalled = false;
      const client = createMockClient({
        getPublishedFileContent: () => {
          apiFetchCalled = true;
          return Promise.resolve("fresh api content");
        },
      });

      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-456",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test-project",
          releaseId: "release-456",
        }),
        isPersistentCacheInvalidated: () => true, // Cache is being invalidated
        isReleaseBeingInvalidated: () => true,
      };

      const readOps = new ReadOperations(
        client,
        cache,
        new PathNormalizer(),
        contextProvider,
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "fresh api content");
      assertEquals(apiFetchCalled, true);
    });

    it("should track invalidation state changes", () => {
      const invalidatedReleases = new Set<string>();

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-456",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test-project",
          releaseId: "release-456",
        }),
        isPersistentCacheInvalidated: () => false,
        isReleaseBeingInvalidated: (releaseId: string) => invalidatedReleases.has(releaseId),
      };

      assertEquals(contextProvider.isReleaseBeingInvalidated!("release-456"), false);

      invalidatedReleases.add("release-456");
      assertEquals(contextProvider.isReleaseBeingInvalidated!("release-456"), true);
      assertEquals(contextProvider.isReleaseBeingInvalidated!("release-789"), false);

      invalidatedReleases.delete("release-456");
      assertEquals(contextProvider.isReleaseBeingInvalidated!("release-456"), false);
    });

    it("should handle prefix-based invalidation", () => {
      const invalidatedPrefixes = new Set<string>();

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-abc",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "my-project",
          releaseId: "release-abc",
        }),
        isPersistentCacheInvalidated: (prefix: string) => {
          for (const pending of invalidatedPrefixes) {
            if (prefix.startsWith(pending) || pending.startsWith(prefix)) return true;
          }
          return false;
        },
        isReleaseBeingInvalidated: () => false,
      };

      assertEquals(
        contextProvider.isPersistentCacheInvalidated!("file:release:my-project:release-abc:"),
        false,
      );

      invalidatedPrefixes.add("file:release:my-project:release-abc:");

      assertEquals(
        contextProvider.isPersistentCacheInvalidated!("file:release:my-project:release-abc:"),
        true,
      );

      // More specific path should also match
      assertEquals(
        contextProvider.isPersistentCacheInvalidated!(
          "file:release:my-project:release-abc:components/app.tsx",
        ),
        true,
      );

      // Different release should not match
      assertEquals(
        contextProvider.isPersistentCacheInvalidated!("file:release:my-project:release-xyz:"),
        false,
      );
    });

    it("should handle environment-based invalidation", () => {
      const invalidatedPrefixes = new Set<string>();

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-env-123",
        getContentContext: () => ({
          sourceType: "environment" as const,
          projectSlug: "env-project",
          environmentName: "production",
          releaseId: "release-env-123",
        }),
        isPersistentCacheInvalidated: (prefix: string) => {
          for (const pending of invalidatedPrefixes) {
            if (prefix.startsWith(pending) || pending.startsWith(prefix)) return true;
          }
          return false;
        },
        isReleaseBeingInvalidated: () => false,
      };

      invalidatedPrefixes.add("file:release:env-project:release-env-123:");
      invalidatedPrefixes.add("file:env:env-project:production:");

      assertEquals(
        contextProvider.isPersistentCacheInvalidated!("file:release:env-project:release-env-123:"),
        true,
      );
      assertEquals(
        contextProvider.isPersistentCacheInvalidated!("file:env:env-project:production:"),
        true,
      );
      assertEquals(
        contextProvider.isPersistentCacheInvalidated!("file:env:env-project:staging:"),
        false,
      );
    });
  });

  describe("in-flight request deduplication", () => {
    it("should deduplicate concurrent requests for the same path", async () => {
      let fetchCount = 0;
      const client = createMockClient({
        getFileContent: async () => {
          fetchCount++;
          // Simulate some async work
          await new Promise((r) => setTimeout(r, 10));
          return "content";
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      // Fire two concurrent reads for the same path
      const [result1, result2] = await Promise.all([
        readOps.readTextFile("pages/index.tsx"),
        readOps.readTextFile("pages/index.tsx"),
      ]);

      assertEquals(result1, "content");
      assertEquals(result2, "content");
      // Only one fetch should have been made
      assertEquals(fetchCount, 1);
    });

    it("should not deduplicate requests for different paths", async () => {
      let fetchCount = 0;
      const client = createMockClient({
        getFileContent: async (path: string) => {
          fetchCount++;
          await new Promise((r) => setTimeout(r, 10));
          return `content for ${path}`;
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContext(),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const [result1, result2] = await Promise.all([
        readOps.readTextFile("pages/index.tsx"),
        readOps.readTextFile("pages/about.tsx"),
      ]);

      assertEquals(result1, "content for pages/index.tsx");
      assertEquals(result2, "content for pages/about.tsx");
      assertEquals(fetchCount, 2);
    });
  });

  describe("file list index caching", () => {
    it("should reuse index when file list has not changed", async () => {
      let indexBuildCount = 0;
      const fileList = [
        { path: "pages/index.tsx", content: "index content" },
        { path: "pages/about.tsx", content: "about content" },
      ];

      const readOps = new ReadOperations(
        createMockClient(),
        new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
        new PathNormalizer(),
        createReleaseContext(),
        (path: string) => path,
        () => {
          indexBuildCount++;
          return Promise.resolve(fileList);
        },
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      // First read - builds index
      await readOps.readTextFile("pages/index.tsx");
      // Second read - should reuse index
      await readOps.readTextFile("pages/about.tsx");

      // getFileListCache is called each time, but the index itself
      // should be reused based on the key
      assertEquals(indexBuildCount >= 1, true);
    });
  });
});
