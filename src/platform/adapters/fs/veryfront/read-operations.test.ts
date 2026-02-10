import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { runWithRequestContext } from "./multi-project-adapter.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import type { ContentContextProvider } from "./read-operations.ts";

// deno-lint-ignore no-explicit-any
function createMockClient(
  overrides: Record<string, any> = {},
): VeryfrontApiClient {
  return {
    getRequestBranch: () => "main",
    getFileContent: () => Promise.resolve("file content"),
    getPublishedFileContent: () => Promise.resolve("published content"),
    resolveFileWithExtension: () => Promise.resolve(null),
    ...overrides,
  } as unknown as VeryfrontApiClient;
}

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

function createReadOps(
  client: VeryfrontApiClient,
  cacheEnabled: boolean,
  contextProvider?: ContentContextProvider,
  pathResolver?: (path: string) => string,
  getFileListCache?: () => Promise<Array<{ path: string; content: string }>>,
  pathNormalizer = new PathNormalizer(),
): ReadOperations {
  return new ReadOperations(
    client,
    new FileCache({ enabled: cacheEnabled, ttl: 1000, maxSize: 100 }),
    pathNormalizer,
    contextProvider,
    pathResolver,
    getFileListCache,
  );
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
      const readOps = createReadOps(createMockClient(), true);
      assertExists(readOps);
    });

    it("should be instantiable with branch context provider", () => {
      const readOps = createReadOps(createMockClient(), true, createBranchContext());
      assertExists(readOps);
    });

    it("should be instantiable with release context provider", () => {
      const readOps = createReadOps(createMockClient(), true, createReleaseContext());
      assertExists(readOps);
    });

    it("should be instantiable with path resolver", () => {
      const readOps = createReadOps(
        createMockClient(),
        true,
        createBranchContext(),
        (path: string) => path,
      );
      assertExists(readOps);
    });

    it("should be instantiable with file list cache getter", () => {
      const readOps = createReadOps(
        createMockClient(),
        true,
        createBranchContext(),
        (path: string) => path,
        () =>
          Promise.resolve([
            { path: "pages/index.tsx", content: "export default () => <div />" },
          ]),
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

      const readOps = createReadOps(client, false, createBranchContext());
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

      const readOps = createReadOps(client, false, createReleaseContext("rel-abc"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "published content here");
      assertEquals(fetchedPath, "pages/index.tsx");
      assertEquals(fetchedReleaseId, "rel-abc");
    });

    it("should hit request-scoped cache within a single request context", async () => {
      let fetchCount = 0;
      const client = createMockClient({
        getFileContent: () => {
          fetchCount++;
          return Promise.resolve(`draft content ${fetchCount}`);
        },
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const [first, second] = await runWithRequestContext(
        { projectSlug: "test", token: "token-1", productionMode: false },
        async () => {
          const first = await readOps.readTextFile("pages/index.tsx");
          const second = await readOps.readTextFile("pages/index.tsx");
          return [first, second] as const;
        },
      );

      assertEquals(first, "draft content 1");
      assertEquals(second, "draft content 1");
      assertEquals(fetchCount, 1);
    });

    it("should hit persistent cache across production requests", async () => {
      let fetchCount = 0;
      const client = createMockClient({
        getPublishedFileContent: () => {
          fetchCount++;
          return Promise.resolve(`published content ${fetchCount}`);
        },
      });

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: true, ttl: 60000, maxSize: 100 }),
        new PathNormalizer(),
        createReleaseContext("rel-cache-hit"),
      );
      readOps.setFileListReadyPromise(Promise.resolve());

      const first = await runWithRequestContext(
        {
          projectSlug: "test",
          token: "token-1",
          productionMode: true,
          releaseId: "rel-cache-hit",
        },
        () => readOps.readTextFile("pages/index.tsx"),
      );
      const second = await runWithRequestContext(
        {
          projectSlug: "test",
          token: "token-1",
          productionMode: true,
          releaseId: "rel-cache-hit",
        },
        () => readOps.readTextFile("pages/index.tsx"),
      );

      assertEquals(first, "published content 1");
      assertEquals(second, "published content 1");
      assertEquals(fetchCount, 1);
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

      const readOps = createReadOps(
        client,
        false,
        createReleaseContext("rel-1"),
        (path: string) => path,
        () => Promise.resolve(fileListCache),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "cached content from file list");
      assertEquals(apiFetchCalled, false);
    });

    it("should USE file list cache for branch (preview) mode", async () => {
      // Preview mode now uses file list cache since WebSocket invalidation keeps it fresh
      // This reduces network fetches dramatically while maintaining freshness
      let apiFetchCalled = false;
      const client = createMockClient({
        getFileContent: () => {
          apiFetchCalled = true;
          return Promise.resolve("fresh draft content");
        },
      });

      const readOps = createReadOps(
        client,
        false,
        createBranchContext(),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "cached file list content" }]),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      // Now uses file list cache instead of API fetch
      assertEquals(content, "cached file list content");
      assertEquals(apiFetchCalled, false);
    });

    it("should normalize path with project dir prefix", async () => {
      let fetchedPath: string | undefined;
      const client = createMockClient({
        getFileContent: (path: string) => {
          fetchedPath = path;
          return Promise.resolve("content");
        },
      });

      const readOps = createReadOps(
        client,
        false,
        createBranchContext(),
        undefined,
        undefined,
        new PathNormalizer("/project/root/"),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      await readOps.readTextFile("/project/root/pages/index.tsx");
      assertEquals(fetchedPath, "pages/index.tsx");
    });

    it("should resolve extensionless paths and cache resolved content in production", async () => {
      let resolveCallCount = 0;
      let publishedFetchCount = 0;
      let resolveBasePath: string | undefined;
      let resolveExtensions: string[] | undefined;

      const client = createMockClient({
        resolveFileWithExtension: (basePath: string, extensionPriority: string[]) => {
          resolveCallCount++;
          resolveBasePath = basePath;
          resolveExtensions = extensionPriority;
          return Promise.resolve({
            path: "pages/home.tsx",
            content: "resolved home content",
          });
        },
        getPublishedFileContent: () => {
          publishedFetchCount++;
          return Promise.resolve("published API content");
        },
      });

      const readOps = createReadOps(client, true, createReleaseContext("rel-resolve-success"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const fromBasePath = await readOps.readTextFile("pages/home");
      const fromBasePathAgain = await readOps.readTextFile("pages/home");
      const fromResolvedPath = await readOps.readTextFile("pages/home.tsx");

      assertEquals(fromBasePath, "resolved home content");
      assertEquals(fromBasePathAgain, "resolved home content");
      assertEquals(fromResolvedPath, "resolved home content");
      assertEquals(resolveCallCount, 1);
      assertEquals(publishedFetchCount, 0);
      assertEquals(resolveBasePath, "pages/home");
      assertEquals(resolveExtensions, [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"]);
    });

    it("should cache extension resolution to avoid repeated API calls", async () => {
      let resolveCallCount = 0;

      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/home.tsx",
            content: "resolved home content",
          });
        },
        getPublishedFileContent: () => Promise.resolve("published content"),
      });

      const readOps = createReadOps(client, true, createReleaseContext("rel-resolve-cache"));
      readOps.setFileListReadyPromise(Promise.resolve());

      // First call: resolves via API
      const first = await readOps.readTextFile("pages/home");
      assertEquals(first, "resolved home content");
      assertEquals(resolveCallCount, 1);

      // Second call: should use extension resolution cache, no API call
      const second = await readOps.readTextFile("pages/home");
      assertEquals(second, "resolved home content");
      // Resolution API should NOT be called again — cached mapping used
      assertEquals(resolveCallCount, 1);
    });

    it("should clear extension resolution cache on clearFileListIndex", async () => {
      let resolveCallCount = 0;

      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/data.tsx",
            content: `content v${resolveCallCount}`,
          });
        },
      });

      // Disable persistent cache so only the resolution cache determines behavior
      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      await runWithRequestContext(
        { projectSlug: "test", token: "t1", productionMode: false },
        () => readOps.readTextFile("pages/data"),
      );
      assertEquals(resolveCallCount, 1);

      // Clear caches — simulates invalidation
      readOps.clearFileListIndex();

      // Next call should re-resolve since extension resolution cache was cleared
      await runWithRequestContext(
        { projectSlug: "test", token: "t2", productionMode: false },
        () => readOps.readTextFile("pages/data"),
      );
      assertEquals(resolveCallCount, 2);
    });

    it("should fall back to API fetch when extension resolution fails", async () => {
      let resolveCallCount = 0;
      let fileFetchCount = 0;
      const fetchedPaths: string[] = [];

      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.reject(new Error("resolver unavailable"));
        },
        getFileContent: (path: string) => {
          fileFetchCount++;
          fetchedPaths.push(path);
          return Promise.resolve("draft fallback content");
        },
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const [first, second] = await runWithRequestContext(
        { projectSlug: "test", token: "token-1", productionMode: false },
        async () => {
          const first = await readOps.readTextFile("pages/profile");
          const second = await readOps.readTextFile("pages/profile");
          return [first, second] as const;
        },
      );

      assertEquals(first, "draft fallback content");
      assertEquals(second, "draft fallback content");
      assertEquals(resolveCallCount, 1);
      assertEquals(fileFetchCount, 1);
      assertEquals(fetchedPaths, ["pages/profile"]);
    });

    it("should use pattern search fallback when published extension lookup returns 404", async () => {
      let resolveCallCount = 0;
      let resolveBasePath: string | undefined;
      let resolveExtensions: string[] | undefined;
      const publishedFetchPaths: string[] = [];

      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          publishedFetchPaths.push(path);
          if (path === "pages/landing.tsx") {
            return Promise.reject(new Error("404 Not Found"));
          }
          return Promise.reject(new Error(`unexpected published path: ${path}`));
        },
        resolveFileWithExtension: (basePath: string, extensionPriority: string[]) => {
          resolveCallCount++;
          resolveBasePath = basePath;
          resolveExtensions = extensionPriority;
          return Promise.resolve({
            path: "pages/landing.mdx",
            content: "landing mdx fallback",
          });
        },
      });

      const readOps = createReadOps(client, true, createReleaseContext("rel-pattern-fallback"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const first = await readOps.readTextFile("pages/landing.tsx");
      const second = await readOps.readTextFile("pages/landing.tsx");

      assertEquals(first, "landing mdx fallback");
      assertEquals(second, "landing mdx fallback");
      assertEquals(resolveCallCount, 1);
      assertEquals(resolveBasePath, "pages/landing");
      assertEquals(resolveExtensions, [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"]);
      assertEquals(publishedFetchPaths, ["pages/landing.tsx"]);
    });

    it("should fall back in parallel when pattern search fails for published 404", async () => {
      let resolveCallCount = 0;
      const publishedFetchPaths: string[] = [];

      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          publishedFetchPaths.push(path);
          if (path === "pages/guide.tsx") return Promise.reject(new Error("404 Not Found"));
          if (path === "pages/guide.ts") return Promise.reject(new Error("404 Not Found"));
          if (path === "pages/guide.jsx") return Promise.resolve("guide jsx fallback");
          // All other extensions are tried in parallel too
          return Promise.reject(new Error("404 Not Found"));
        },
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.reject(new Error("pattern search unavailable"));
        },
      });

      const readOps = createReadOps(client, true, createReleaseContext("rel-sequential-fallback"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const first = await readOps.readTextFile("pages/guide.tsx");
      const second = await readOps.readTextFile("pages/guide.tsx");

      assertEquals(first, "guide jsx fallback");
      assertEquals(second, "guide jsx fallback");
      assertEquals(resolveCallCount, 1);
      // All non-original extensions are fetched in parallel
      assertEquals(publishedFetchPaths.includes("pages/guide.tsx"), true);
      assertEquals(publishedFetchPaths.includes("pages/guide.jsx"), true);
    });

    it("should return highest-priority extension when multiple match in parallel fallback", async () => {
      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          if (path === "pages/multi.tsx") return Promise.reject(new Error("404 Not Found"));
          // Both .ts and .jsx exist, but .ts has higher priority
          if (path === "pages/multi.ts") return Promise.resolve("ts content");
          if (path === "pages/multi.jsx") return Promise.resolve("jsx content");
          return Promise.reject(new Error("404 Not Found"));
        },
        resolveFileWithExtension: () => Promise.reject(new Error("unavailable")),
      });

      const readOps = createReadOps(client, false, createReleaseContext("rel-priority"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/multi.tsx");
      // .ts has higher priority than .jsx in EXTENSION_PRIORITY
      assertEquals(content, "ts content");
    });

    it("should resolve parallel fallback faster than sequential with simulated latency", async () => {
      const SIMULATED_LATENCY_MS = 50;

      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (path === "pages/slow.tsx") reject(new Error("404 Not Found"));
              else if (path === "pages/slow.mdx") resolve("found via mdx");
              else reject(new Error("404 Not Found"));
            }, SIMULATED_LATENCY_MS);
          });
        },
        resolveFileWithExtension: () => Promise.reject(new Error("unavailable")),
      });

      const readOps = createReadOps(client, false, createReleaseContext("rel-perf"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const start = performance.now();
      const content = await readOps.readTextFile("pages/slow.tsx");
      const elapsed = performance.now() - start;

      assertEquals(content, "found via mdx");
      // Parallel: all 5 fallback extensions fire at once (~50ms total)
      // Sequential would be: 5 * 50ms = ~250ms minimum
      // Allow generous margin but ensure it's well under sequential time
      assert(
        elapsed < SIMULATED_LATENCY_MS * 3,
        `Parallel fallback took ${Math.round(elapsed)}ms, expected < ${
          SIMULATED_LATENCY_MS * 3
        }ms (sequential would be ~${SIMULATED_LATENCY_MS * 5}ms)`,
      );
    });

    it("should not wait for slow lower-priority extensions when higher-priority succeeds", async () => {
      // Regression test for Codex review: Promise.allSettled waited for ALL extensions.
      // New approach uses priority-ordered await so a fast .ts resolves immediately
      // without blocking on a slow .mdx or .md.
      let mdxRequested = false;
      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          if (path === "pages/fast.tsx") return Promise.reject(new Error("404"));
          // .ts resolves instantly (high priority)
          if (path === "pages/fast.ts") return Promise.resolve("fast ts content");
          // .mdx never resolves (simulates slow extension) — should NOT block result
          if (path === "pages/fast.mdx") {
            mdxRequested = true;
            return new Promise<string>(() => {}); // Never resolves
          }
          return Promise.reject(new Error("404"));
        },
        resolveFileWithExtension: () => Promise.reject(new Error("unavailable")),
      });

      const readOps = createReadOps(client, false, createReleaseContext("rel-nowait"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const start = performance.now();
      const content = await readOps.readTextFile("pages/fast.tsx");
      const elapsed = performance.now() - start;

      assertEquals(content, "fast ts content");
      // .mdx was requested (parallel initiation) but didn't block
      assertEquals(mdxRequested, true);
      // Should resolve in well under 100ms, NOT wait for the never-resolving .mdx
      assert(
        elapsed < 200,
        `Should not wait for slow extensions: took ${Math.round(elapsed)}ms, ` +
          `expected < 200ms (slow .mdx never resolves)`,
      );
    });
  });

  describe("readFile", () => {
    it("should return Uint8Array from text content", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("hello world"),
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const bytes = await readOps.readFile("test.txt");
      assertExists(bytes);
      assertEquals(bytes instanceof Uint8Array, true);
      assertEquals(new TextDecoder().decode(bytes), "hello world");
    });
  });

  describe("clearFileListIndex", () => {
    it("should clear without error when no index exists", () => {
      const readOps = createReadOps(createMockClient(), true);
      readOps.clearFileListIndex();
    });

    it("should clear built index", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("content"),
      });

      const readOps = createReadOps(
        client,
        false,
        createReleaseContext(),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "test content" }]),
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      await readOps.readTextFile("pages/index.tsx");
      readOps.clearFileListIndex();
    });
  });

  describe("setFileListReadyPromise", () => {
    it("should accept a promise", () => {
      const readOps = createReadOps(createMockClient(), true);
      readOps.setFileListReadyPromise(Promise.resolve());
    });

    it("should handle rejected ready promise gracefully", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("fallback content"),
      });

      const readOps = createReadOps(client, false, createBranchContext());

      const rejectedPromise = Promise.reject(new Error("init failed"));
      // Prevent unhandled rejection from killing the test runner
      rejectedPromise.catch(() => {});
      readOps.setFileListReadyPromise(rejectedPromise);

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

      const readOps = createReadOps(createMockClient(), true, contextProvider);
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
        isPersistentCacheInvalidated: () => true,
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

    it("should skip persistent and file-list caches during invalidation and use API path", async () => {
      let fileListCalls = 0;
      let fetchedApiPath: string | undefined;
      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          fetchedApiPath = path;
          return Promise.resolve("fresh api content");
        },
      });

      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      cache.set("file:release:test:rel-invalidation:pages/index.tsx", "stale persistent content");

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "rel-invalidation",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "rel-invalidation",
        }),
        isPersistentCacheInvalidated: () => true,
        isReleaseBeingInvalidated: () => false,
      };

      const readOps = new ReadOperations(
        client,
        cache,
        new PathNormalizer(),
        contextProvider,
        (path: string) => `api-source/${path}`,
        () => {
          fileListCalls++;
          return Promise.resolve([
            { path: "pages/index.tsx", content: "stale file-list content" },
          ]);
        },
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "fresh api content");
      assertEquals(fileListCalls, 0);
      assertEquals(fetchedApiPath, "api-source/pages/index.tsx");
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

      assertEquals(contextProvider.isReleaseBeingInvalidated?.("release-456"), false);

      invalidatedReleases.add("release-456");
      assertEquals(contextProvider.isReleaseBeingInvalidated?.("release-456"), true);
      assertEquals(contextProvider.isReleaseBeingInvalidated?.("release-789"), false);

      invalidatedReleases.delete("release-456");
      assertEquals(contextProvider.isReleaseBeingInvalidated?.("release-456"), false);
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
        contextProvider.isPersistentCacheInvalidated?.("file:release:my-project:release-abc:"),
        false,
      );

      invalidatedPrefixes.add("file:release:my-project:release-abc:");

      assertEquals(
        contextProvider.isPersistentCacheInvalidated?.("file:release:my-project:release-abc:"),
        true,
      );

      assertEquals(
        contextProvider.isPersistentCacheInvalidated?.(
          "file:release:my-project:release-abc:components/app.tsx",
        ),
        true,
      );

      assertEquals(
        contextProvider.isPersistentCacheInvalidated?.("file:release:my-project:release-xyz:"),
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
        contextProvider.isPersistentCacheInvalidated?.("file:release:env-project:release-env-123:"),
        true,
      );
      assertEquals(
        contextProvider.isPersistentCacheInvalidated?.("file:env:env-project:production:"),
        true,
      );
      assertEquals(
        contextProvider.isPersistentCacheInvalidated?.("file:env:env-project:staging:"),
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
          await new Promise((r) => setTimeout(r, 10));
          return "content";
        },
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const [result1, result2] = await Promise.all([
        readOps.readTextFile("pages/index.tsx"),
        readOps.readTextFile("pages/index.tsx"),
      ]);

      assertEquals(result1, "content");
      assertEquals(result2, "content");
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

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const [result1, result2] = await Promise.all([
        readOps.readTextFile("pages/index.tsx"),
        readOps.readTextFile("pages/about.tsx"),
      ]);

      assertEquals(result1, "content for pages/index.tsx");
      assertEquals(result2, "content for pages/about.tsx");
      assertEquals(fetchCount, 2);
    });

    it("should evict oldest in-flight request when cap is exceeded", async () => {
      const fetchCountByPath = new Map<string, number>();
      const client = createMockClient({
        getFileContent: (path: string) => {
          fetchCountByPath.set(path, (fetchCountByPath.get(path) ?? 0) + 1);
          return new Promise<string>(() => {});
        },
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const oldestPath = "pages/oldest.tsx";
      void readOps.readTextFile(oldestPath);
      for (let i = 0; i < 100; i++) {
        void readOps.readTextFile(`pages/in-flight-${i}.tsx`);
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
      await new Promise((resolve) => setTimeout(resolve, 1100));

      void readOps.readTextFile(oldestPath);
      await new Promise((resolve) => setTimeout(resolve, 25));

      assertEquals(fetchCountByPath.get(oldestPath), 2);
    });
  });

  describe("file list index caching", () => {
    it("should reuse index when file list has not changed", async () => {
      let indexBuildCount = 0;
      const fileList = [
        { path: "pages/index.tsx", content: "index content" },
        { path: "pages/about.tsx", content: "about content" },
      ];

      const readOps = createReadOps(
        createMockClient(),
        false,
        createReleaseContext(),
        (path: string) => path,
        () => {
          indexBuildCount++;
          return Promise.resolve(fileList);
        },
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      await readOps.readTextFile("pages/index.tsx");
      await readOps.readTextFile("pages/about.tsx");

      assertEquals(indexBuildCount >= 1, true);
    });
  });
});
