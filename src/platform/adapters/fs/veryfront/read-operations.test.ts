import "#veryfront/schemas/_test-setup.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { ContentContextProvider } from "./file-list-access.ts";
import { runWithRequestContext } from "./multi-project-adapter.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import type { ResolvedContentContext } from "./types.ts";

function createMockClient(
  overrides: Record<string, unknown> = {},
): VeryfrontApiClient {
  return {
    getRequestBranch: () => "main",
    getFileContent: () => Promise.resolve("file content"),
    getPublishedFileContent: () => Promise.resolve("published content"),
    resolveFileWithExtension: () => Promise.resolve(null),
    ...overrides,
  } as unknown as VeryfrontApiClient;
}

function notFoundError(): Error {
  return API_CLIENT_ERROR.create({ detail: "not found", status: 404 });
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
  getFileListCache?: (
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ) => Promise<Array<{ path: string; content?: string }> | undefined>,
  pathNormalizer = new PathNormalizer(),
  getFileListSnapshotVersion?: () => number,
): ReadOperations {
  return new ReadOperations(
    client,
    new FileCache({ enabled: cacheEnabled, ttl: 1000, maxSize: 100 }),
    pathNormalizer,
    contextProvider,
    pathResolver,
    getFileListCache,
    getFileListSnapshotVersion,
  );
}

function createReadyReadOps(
  client: VeryfrontApiClient,
  cacheEnabled: boolean,
  contextProvider?: ContentContextProvider,
  pathResolver?: (path: string) => string,
  getFileListCache?: (
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ) => Promise<Array<{ path: string; content?: string }> | undefined>,
  pathNormalizer = new PathNormalizer(),
  getFileListSnapshotVersion?: () => number,
): ReadOperations {
  const readOps = createReadOps(
    client,
    cacheEnabled,
    contextProvider,
    pathResolver,
    getFileListCache,
    pathNormalizer,
    getFileListSnapshotVersion,
  );
  readOps.setFileListReadyPromise(Promise.resolve());
  return readOps;
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
      const readOps = createReadyReadOps(createMockClient(), true);
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

  describe("readFileBytesWithinLimit", () => {
    it("uses the exact branch reader and bypasses materialized content caches", async () => {
      let exactCall: [string, number] | undefined;
      let unboundedCalls = 0;
      const readOps = createReadyReadOps(
        createMockClient({
          getFileContent: () => {
            unboundedCalls++;
            return Promise.resolve("cached materialization");
          },
          getFileContentBytesWithinLimit: (path: string, maximumBytes: number) => {
            exactCall = [path, maximumBytes];
            return Promise.resolve(new Uint8Array([1, 2, 3]));
          },
        }),
        true,
        createBranchContext(),
        (path) => `original/${path}`,
        () => Promise.resolve([{ path: "styles/manifest.json", content: "cached" }]),
      );

      assertEquals(
        [...await readOps.readFileBytesWithinLimit("styles/manifest.json", 3)],
        [1, 2, 3],
      );
      assertEquals(exactCall, ["original/styles/manifest.json", 3]);
      assertEquals(unboundedCalls, 0);
    });

    it("uses the request branch for exact bounded reads", async () => {
      let exactContext: { type: "branch"; name: string } | undefined;
      const readOps = createReadyReadOps(
        createMockClient({
          getRequestBranch: () => "feature",
          getFileContentBytesWithinLimit: (
            _path: string,
            _maximumBytes: number,
            _options?: { expectedMissing?: boolean },
            context?: { type: "branch"; name: string },
          ) => {
            exactContext = context;
            return Promise.resolve(new Uint8Array([1]));
          },
        }),
        true,
        createBranchContext(),
      );

      assertEquals([...await readOps.readFileBytesWithinLimit("manifest.json", 1)], [1]);
      assertEquals(exactContext, { type: "branch", name: "feature" });
    });

    it("forwards release identity to the exact published reader", async () => {
      let exactCall: [string, number, string | undefined, string | undefined] | undefined;
      const readOps = createReadyReadOps(
        createMockClient({
          getPublishedFileContentBytesWithinLimit: (
            path: string,
            maximumBytes: number,
            releaseId?: string,
            environmentName?: string,
          ) => {
            exactCall = [path, maximumBytes, releaseId, environmentName];
            return Promise.resolve(new Uint8Array([4]));
          },
        }),
        false,
        createReleaseContext("release-exact"),
      );

      assertEquals([...await readOps.readFileBytesWithinLimit("manifest.json", 1)], [4]);
      assertEquals(exactCall, ["manifest.json", 1, "release-exact", undefined]);
    });

    it("resolves extensionless candidates without inspecting materialized caches", async () => {
      const exactCalls: Array<[string, boolean | undefined]> = [];
      let unboundedResolverCalls = 0;
      let fileListCalls = 0;
      const readOps = createReadyReadOps(
        createMockClient({
          getFileContentBytesWithinLimit: (
            path: string,
            _maximumBytes: number,
            options?: { expectedMissing?: boolean },
          ) => {
            exactCalls.push([path, options?.expectedMissing]);
            if (path === "pages/home.tsx") {
              return Promise.resolve(new Uint8Array([5]));
            }
            return Promise.reject(API_CLIENT_ERROR.create({ detail: "not found", status: 404 }));
          },
          resolveFileWithExtension: () => {
            unboundedResolverCalls++;
            return Promise.resolve({ path: "pages/home.tsx", content: "unbounded" });
          },
        }),
        false,
        createBranchContext(),
        undefined,
        () => {
          fileListCalls++;
          throw new Error("materialized file-list content must not be inspected");
        },
      );

      assertEquals([...await readOps.readFileBytesWithinLimit("pages/home", 1)], [5]);
      assertEquals(exactCalls, [["pages/home.tsx", true]]);
      assertEquals(unboundedResolverCalls, 0);
      assertEquals(fileListCalls, 0);
    });

    it("marks only published fallback variants as expected missing", async () => {
      const exactCalls: Array<[string, boolean | undefined]> = [];
      const readOps = createReadyReadOps(
        createMockClient({
          getPublishedFileContentBytesWithinLimit: (
            path: string,
            _maximumBytes: number,
            _releaseId?: string,
            _environmentName?: string,
            options?: { expectedMissing?: boolean },
          ) => {
            exactCalls.push([path, options?.expectedMissing]);
            if (path === "pages/home.tsx") {
              return Promise.resolve(new Uint8Array([6]));
            }
            return Promise.reject(API_CLIENT_ERROR.create({ detail: "not found", status: 404 }));
          },
        }),
        false,
        createReleaseContext("release-probe"),
      );

      assertEquals([...await readOps.readFileBytesWithinLimit("pages/home.ts", 1)], [6]);
      assertEquals(exactCalls, [
        ["pages/home.ts", undefined],
        ["pages/home.tsx", true],
      ]);
    });

    it("does not substitute another extension for a published config candidate", async () => {
      const exactCalls: string[] = [];
      const readOps = createReadyReadOps(
        createMockClient({
          getPublishedFileContentBytesWithinLimit: (path: string) => {
            exactCalls.push(path);
            if (path === "veryfront.config.ts") {
              return Promise.resolve(new Uint8Array([7]));
            }
            return Promise.reject(API_CLIENT_ERROR.create({ detail: "not found", status: 404 }));
          },
        }),
        false,
        createReleaseContext("release-config"),
      );

      await assertRejects(
        () => readOps.readFileBytesWithinLimit("veryfront.config.js", 1),
        Error,
        "404 Not Found: veryfront.config.js",
      );
      assertEquals(exactCalls, ["veryfront.config.js"]);
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

      const readOps = createReadyReadOps(
        client,
        false,
        createReleaseContext("rel-1"),
        (path: string) => path,
        () => Promise.resolve(fileListCache),
      );

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

      const readOps = createReadyReadOps(
        client,
        false,
        createBranchContext(),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "cached file list content" }]),
      );

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

      const readOps = createReadyReadOps(
        client,
        false,
        createBranchContext(),
        undefined,
        undefined,
        new PathNormalizer("/project/root/"),
      );

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

      const readOps = createReadyReadOps(client, true, createReleaseContext("rel-resolve-success"));
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

    it("should resolve empty extensionless files from the file list", async () => {
      let resolveCalls = 0;
      let apiFetchCalls = 0;
      const readOps = createReadOps(
        createMockClient({
          resolveFileWithExtension: () => {
            resolveCalls++;
            return Promise.resolve({ path: "empty.ts", content: "fallback" });
          },
          getPublishedFileContent: () => {
            apiFetchCalls++;
            return Promise.resolve("fallback");
          },
        }),
        true,
        createReleaseContext("rel-empty-file-list"),
        (path: string) => path,
        () => Promise.resolve([{ path: "empty.ts", content: "" }]),
      );

      assertEquals(await readOps.readTextFile("empty"), "");
      assertEquals(await readOps.readTextFile("empty"), "");
      assertEquals(resolveCalls, 0);
      assertEquals(apiFetchCalls, 0);
    });

    it("should preserve empty content returned by extension fallback", async () => {
      let resolveCalls = 0;
      let apiFetchCalls = 0;
      const readOps = createReadyReadOps(
        createMockClient({
          resolveFileWithExtension: () => {
            resolveCalls++;
            return Promise.resolve({ path: "empty.ts", content: "" });
          },
          getPublishedFileContent: () => {
            apiFetchCalls++;
            return Promise.resolve("fallback");
          },
        }),
        true,
        createReleaseContext("rel-empty-fallback"),
      );

      assertEquals(await readOps.readTextFile("empty"), "");
      assertEquals(await readOps.readTextFile("empty"), "");
      assertEquals(resolveCalls, 1);
      assertEquals(apiFetchCalls, 0);
    });

    it("should resolve extensionless dotted paths directly from file list cache", async () => {
      let resolveCallCount = 0;
      let apiFetchCount = 0;

      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/home.v2.tsx",
            content: "resolved via api",
          });
        },
        getPublishedFileContent: () => {
          apiFetchCount++;
          return Promise.resolve("published API content");
        },
      });

      const readOps = createReadOps(
        client,
        true,
        createReleaseContext("rel-file-list-resolve"),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/home.v2.tsx", content: "resolved from file list" }]),
      );

      const content = await readOps.readTextFile("pages/home.v2");

      assertEquals(content, "resolved from file list");
      assertEquals(resolveCallCount, 0);
      assertEquals(apiFetchCount, 0);
    });

    it("should fail fast for explicit files missing from a fresh file list cache", async () => {
      let resolveCallCount = 0;
      let apiFetchCount = 0;

      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve(null);
        },
        getPublishedFileContent: () => {
          apiFetchCount++;
          return Promise.resolve("published API content");
        },
      });

      const readOps = createReadyReadOps(
        client,
        true,
        createReleaseContext("rel-missing-deno-json"),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "home page" }]),
      );

      await assertRejects(
        () => readOps.readTextFile("deno.json"),
        Error,
        "404 Not Found",
      );

      assertEquals(resolveCallCount, 0);
      assertEquals(apiFetchCount, 0);
    });

    it("should fetch an exact indexed file when the file list omits inline content", async () => {
      let fileFetchCount = 0;

      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          fileFetchCount++;
          return Promise.resolve(`content for ${path}`);
        },
      });

      const readOps = createReadyReadOps(
        client,
        true,
        createReleaseContext("rel-deno-inline-miss"),
        (path: string) => path,
        () => Promise.resolve([{ path: "deno.json" }]),
      );

      const content = await readOps.readTextFile("deno.json");

      assertEquals(content, "content for deno.json");
      assertEquals(fileFetchCount, 1);
    });

    it("should fetch the resolved extension candidate directly when the file list knows the path", async () => {
      let resolveCallCount = 0;
      let publishedFetchPath: string | undefined;

      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/home.tsx",
            content: "resolved via API",
          });
        },
        getPublishedFileContent: (path: string) => {
          publishedFetchPath = path;
          return Promise.resolve("content from exact fetch");
        },
      });

      const readOps = createReadyReadOps(
        client,
        true,
        createReleaseContext("rel-candidate-inline-miss"),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/home.tsx" }]),
      );

      const content = await readOps.readTextFile("pages/home");

      assertEquals(content, "content from exact fetch");
      assertEquals(resolveCallCount, 0);
      assertEquals(publishedFetchPath, "pages/home.tsx");
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

      const readOps = createReadyReadOps(client, true, createReleaseContext("rel-resolve-cache"));
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

    it("does not substitute another extension for a published config candidate", async () => {
      const publishedFetchPaths: string[] = [];
      let resolveCallCount = 0;
      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          publishedFetchPaths.push(path);
          if (path === "veryfront.config.ts") return Promise.resolve("typescript config");
          return Promise.reject(
            API_CLIENT_ERROR.create({ detail: "not found", status: 404 }),
          );
        },
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "veryfront.config.ts",
            content: "typescript config",
          });
        },
      });

      const readOps = createReadyReadOps(
        client,
        false,
        createReleaseContext("release-config"),
      );

      const error = await assertRejects(
        () => readOps.readTextFile("veryfront.config.js"),
        Error,
      );
      assertEquals((error as Error & { code?: string }).code, "ENOENT");
      assertEquals(publishedFetchPaths, ["veryfront.config.js"]);
      assertEquals(resolveCallCount, 0);
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

    it("should start fallback extension fetches in parallel", async () => {
      const deferred = new Map<
        string,
        {
          resolve: (content: string) => void;
          reject: (error: Error) => void;
        }
      >();
      const requestedPaths: string[] = [];

      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          requestedPaths.push(path);
          return new Promise<string>((resolve, reject) => {
            deferred.set(path, { resolve, reject });
          });
        },
        resolveFileWithExtension: () => Promise.reject(new Error("unavailable")),
      });

      const readOps = createReadOps(client, false, createReleaseContext("rel-perf"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const readPromise = readOps.readTextFile("pages/slow.tsx");

      for (let i = 0; i < 10 && !deferred.has("pages/slow.tsx"); i++) {
        await Promise.resolve();
      }
      deferred.get("pages/slow.tsx")?.reject(new Error("404 Not Found"));

      for (let i = 0; i < 10 && !deferred.has("pages/slow.md"); i++) {
        await Promise.resolve();
      }

      assertEquals(requestedPaths, [
        "pages/slow.tsx",
        "pages/slow.ts",
        "pages/slow.jsx",
        "pages/slow.js",
        "pages/slow.mdx",
        "pages/slow.md",
      ]);

      deferred.get("pages/slow.ts")?.reject(new Error("404 Not Found"));
      deferred.get("pages/slow.jsx")?.reject(new Error("404 Not Found"));
      deferred.get("pages/slow.js")?.reject(new Error("404 Not Found"));
      deferred.get("pages/slow.mdx")?.resolve("found via mdx");
      deferred.get("pages/slow.md")?.reject(new Error("404 Not Found"));

      const content = await readPromise;

      assertEquals(content, "found via mdx");
    });

    it("should not wait for slow lower-priority extensions when higher-priority succeeds", async () => {
      // Regression test for Codex review: Promise.allSettled waited for ALL extensions.
      // New approach uses priority-ordered await so a fast .ts resolves immediately
      // without blocking on a slow .mdx or .md.
      const deferred = new Map<string, { resolve: (content: string) => void }>();
      const requestedPaths: string[] = [];
      const client = createMockClient({
        getPublishedFileContent: (path: string) => {
          requestedPaths.push(path);
          if (path === "pages/fast.tsx") return Promise.reject(new Error("404"));
          // .ts is high priority. The test resolves it only after proving the
          // lower-priority .mdx request has started and remains unresolved.
          if (path === "pages/fast.ts") {
            return new Promise<string>((resolve) => {
              deferred.set(path, { resolve });
            });
          }
          // .mdx never resolves (simulates slow extension) and should not block result.
          if (path === "pages/fast.mdx") {
            return new Promise<string>((resolve) => {
              deferred.set(path, { resolve });
            });
          }
          return Promise.reject(new Error("404"));
        },
        resolveFileWithExtension: () => Promise.reject(new Error("unavailable")),
      });

      const readOps = createReadOps(client, false, createReleaseContext("rel-nowait"));
      readOps.setFileListReadyPromise(Promise.resolve());

      const readPromise = readOps.readTextFile("pages/fast.tsx");

      for (let i = 0; i < 10 && !deferred.has("pages/fast.mdx"); i++) {
        await Promise.resolve();
      }

      assertEquals(requestedPaths, [
        "pages/fast.tsx",
        "pages/fast.ts",
        "pages/fast.jsx",
        "pages/fast.js",
        "pages/fast.mdx",
        "pages/fast.md",
      ]);
      assertExists(deferred.get("pages/fast.ts"));
      assertExists(deferred.get("pages/fast.mdx"));

      deferred.get("pages/fast.ts")?.resolve("fast ts content");

      const settled = await Promise.race([
        readPromise.then((value) => ({ status: "resolved" as const, value })),
        new Promise<{ status: "pending" }>((resolve) =>
          setTimeout(() => resolve({ status: "pending" }), 100)
        ),
      ]);

      assertEquals(settled, { status: "resolved", value: "fast ts content" });
    });
  });

  describe("readOptionalTextFile", () => {
    it("does not join or cache a fetch from a superseded source snapshot", async () => {
      const oldFetch = Promise.withResolvers<string>();
      let fetchCount = 0;
      let snapshotVersion = 1;
      const client = createMockClient({
        getPublishedFileContent: () => {
          fetchCount++;
          return fetchCount === 1 ? oldFetch.promise : Promise.resolve("new content");
        },
      });
      const readOps = createReadyReadOps(
        client,
        true,
        createReleaseContext("release-snapshot"),
        undefined,
        undefined,
        new PathNormalizer(),
        () => snapshotVersion,
      );

      const oldRead = readOps.readOptionalTextFile("globals.css");
      for (let attempt = 0; attempt < 100 && fetchCount === 0; attempt++) await Promise.resolve();
      assertEquals(fetchCount, 1);
      snapshotVersion = 2;
      const newRead = readOps.readOptionalTextFile("globals.css");
      assertEquals(await newRead, "new content");
      oldFetch.resolve("old content");
      assertEquals(await oldRead, "old content");

      assertEquals(await readOps.readOptionalTextFile("globals.css"), "new content");
      assertEquals(fetchCount, 2);
    });

    it("does not deduplicate optional reads across request credentials", async () => {
      const firstFetch = Promise.withResolvers<string>();
      let fetchCount = 0;
      const client = createMockClient({
        getFileContent: () => {
          fetchCount++;
          return fetchCount === 1 ? firstFetch.promise : Promise.resolve("token-b content");
        },
      });
      const readOps = createReadyReadOps(client, false, createBranchContext());

      const first = runWithRequestContext(
        { projectSlug: "test", token: "token-a", productionMode: false },
        () => readOps.readOptionalTextFile("globals.css"),
      );
      await Promise.resolve();
      const second = runWithRequestContext(
        { projectSlug: "test", token: "token-b", productionMode: false },
        () => readOps.readOptionalTextFile("globals.css"),
      );
      await Promise.resolve();
      firstFetch.resolve("token-a content");

      assertEquals(await Promise.all([first, second]), ["token-a content", "token-b content"]);
      assertEquals(fetchCount, 2);
    });

    it("should share request cache entries only between exact optional reads", async () => {
      let fetchCount = 0;
      const client = createMockClient({
        getFileContent: () => {
          fetchCount++;
          return Promise.resolve("body { color: red; }");
        },
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      const [first, second, viaReadText] = await runWithRequestContext(
        { projectSlug: "test", token: "token-1", productionMode: false },
        async () => {
          const first = await readOps.readOptionalTextFile("globals.css");
          const second = await readOps.readOptionalTextFile("globals.css");
          const viaReadText = await readOps.readTextFile("globals.css");
          return [first, second, viaReadText] as const;
        },
      );

      assertEquals(first, "body { color: red; }");
      assertEquals(second, "body { color: red; }");
      assertEquals(viaReadText, "body { color: red; }");
      assertEquals(
        fetchCount,
        2,
        "optional reads share one fetch while a module read keeps a separate cache identity",
      );
    });

    it("should serve optional reads from the file list cache without an API call", async () => {
      let apiCallCount = 0;
      const client = createMockClient({
        getFileContent: () => {
          apiCallCount++;
          return Promise.resolve("api content");
        },
        getPublishedFileContent: () => {
          apiCallCount++;
          return Promise.resolve("api content");
        },
        resolveFileWithExtension: () => {
          apiCallCount++;
          return Promise.resolve(null);
        },
      });

      const readOps = createReadyReadOps(
        client,
        false,
        createReleaseContext("rel-css"),
        (path: string) => path,
        () => Promise.resolve([{ path: "globals.css", content: "cached stylesheet" }]),
      );

      const content = await readOps.readOptionalTextFile("globals.css");
      assertEquals(content, "cached stylesheet");
      assertEquals(apiCallCount, 0, "a file list hit must not reach the API");
    });

    it("should answer a fresh file-list miss without any API request", async () => {
      let apiCallCount = 0;
      const client = createMockClient({
        getFileContent: () => {
          apiCallCount++;
          return Promise.resolve("api content");
        },
        getPublishedFileContent: () => {
          apiCallCount++;
          return Promise.resolve("api content");
        },
        resolveFileWithExtension: () => {
          apiCallCount++;
          return Promise.resolve(null);
        },
      });

      const readOps = createReadyReadOps(
        client,
        false,
        createReleaseContext("rel-no-css"),
        (path: string) => path,
        () => Promise.resolve([{ path: "pages/index.tsx", content: "index content" }]),
      );

      await assertRejects(
        () => readOps.readOptionalTextFile("globals.css"),
        Error,
        "404 Not Found",
      );
      assertEquals(
        apiCallCount,
        0,
        "an expected optional miss must be answered by the file list index, not the API",
      );
    });

    it("should read the exact path instead of resolving a same-stem sibling", async () => {
      // "globals.css" has no extension this pipeline recognises as a source
      // extension, so the module path would treat it as extensionless and
      // resolve "globals.css.*" -- which can rank a sourcemap ahead of the
      // real stylesheet. An optional read names a complete file.
      let resolveCalls = 0;
      const client = createMockClient({
        resolveFileWithExtension: (basePath: string) => {
          resolveCalls++;
          return Promise.resolve({
            path: `${basePath}.map`,
            content: '{"version":3,"sources":[]}',
          });
        },
        getFileContent: (path: string) =>
          path === "globals.css"
            ? Promise.resolve("body { color: red; }")
            : Promise.reject(notFoundError()),
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      assertEquals(await readOps.readOptionalTextFile("globals.css"), "body { color: red; }");
      assertEquals(resolveCalls, 0, "an optional read must not run extension resolution");
    });

    it("should not reuse a module fallback as an exact optional read", async () => {
      const requestedPaths: string[] = [];
      const client = createMockClient({
        resolveFileWithExtension: () =>
          Promise.resolve({ path: "theme.tsx", content: "resolved sibling" }),
        getPublishedFileContent: (path: string) => {
          requestedPaths.push(path);
          return path === "theme.tsx"
            ? Promise.resolve("resolved sibling")
            : Promise.reject(new Error("404 Not Found"));
        },
      });
      const readOps = createReadOps(client, true, createReleaseContext("rel-semantics"));
      readOps.setFileListReadyPromise(Promise.resolve());

      assertEquals(await readOps.readTextFile("theme.ts"), "resolved sibling");
      await assertRejects(
        () => readOps.readOptionalTextFile("theme.ts"),
        Error,
        "404 Not Found",
      );
      assertEquals(
        requestedPaths.filter((path) => path === "theme.ts").length,
        2,
        "the exact optional read must perform its own requested-path lookup",
      );
    });

    it("should key optional reads and file-list indexes by the request branch", async () => {
      let requestBranch = "main";
      const client = createMockClient({
        getRequestBranch: () => requestBranch,
      });
      const readOps = createReadyReadOps(
        client,
        false,
        createBranchContext(),
        (path: string) => path,
        (_cacheKey, contentContext) =>
          Promise.resolve([{
            path: "globals.css",
            content: `${contentContext?.branch ?? "main"} content`,
          }]),
      );

      const mainContent = await runWithRequestContext(
        { projectSlug: "test", token: "token-1", productionMode: false, branch: "main" },
        () => readOps.readOptionalTextFile("globals.css"),
      );
      requestBranch = "feature";
      const featureContent = await runWithRequestContext(
        { projectSlug: "test", token: "token-2", productionMode: false, branch: "feature" },
        () => readOps.readOptionalTextFile("globals.css"),
      );

      assertEquals(mainContent, "main content");
      assertEquals(featureContent, "feature content");
    });

    it("binds overlapping file-list misses and fallback reads to their captured branches", async () => {
      let requestBranch = "main";
      const pending = new Map<string, () => void>();
      const observedListScopes: string[] = [];
      const observedReadBranches: string[] = [];
      const client = createMockClient({
        getRequestBranch: () => requestBranch,
        getFileContent: (
          _path: string,
          _options: unknown,
          context: { type: string; name?: string },
        ) => {
          const branch = context.name ?? "main";
          observedReadBranches.push(branch);
          return Promise.resolve(`${branch} fallback`);
        },
      });
      const readOps = createReadyReadOps(
        client,
        false,
        createBranchContext(),
        (path: string) => path,
        (cacheKey, contentContext) =>
          new Promise((resolve) => {
            const branch = contentContext?.branch ?? "main";
            observedListScopes.push(`${cacheKey}:${branch}`);
            pending.set(branch, () => resolve(undefined));
          }),
      );

      const mainRead = runWithRequestContext(
        { projectSlug: "test", token: "main-token", productionMode: false, branch: "main" },
        () => readOps.readOptionalTextFile("globals.css"),
      );
      while (!pending.has("main")) await Promise.resolve();
      requestBranch = "feature";
      const featureRead = runWithRequestContext(
        {
          projectSlug: "test",
          token: "feature-token",
          productionMode: false,
          branch: "feature",
        },
        () => readOps.readOptionalTextFile("globals.css"),
      );
      while (!pending.has("feature")) await Promise.resolve();
      pending.get("feature")?.();
      pending.get("main")?.();

      assertEquals(await Promise.all([mainRead, featureRead]), [
        "main fallback",
        "feature fallback",
      ]);
      assertEquals(observedReadBranches.sort(), ["feature", "main"]);
      assertEquals(
        observedListScopes.some((scope) =>
          scope.startsWith("files:branch:test:main|authority:") && scope.endsWith(":main")
        ),
        true,
      );
      assertEquals(
        observedListScopes.some((scope) =>
          scope.startsWith("files:branch:test:feature|authority:") && scope.endsWith(":feature")
        ),
        true,
      );
    });

    it("should cache an empty optional file as valid content", async () => {
      let fetchCount = 0;
      const client = createMockClient({
        getPublishedFileContent: () => {
          fetchCount++;
          return Promise.resolve("");
        },
      });
      const readOps = createReadOps(client, true, createReleaseContext("rel-empty"));
      readOps.setFileListReadyPromise(Promise.resolve());
      const read = () =>
        runWithRequestContext(
          { projectSlug: "test", token: "token-1", productionMode: true },
          () => readOps.readOptionalTextFile("globals.css"),
        );

      assertEquals(await read(), "");
      assertEquals(await read(), "");
      assertEquals(fetchCount, 1, "an empty file must be a persistent cache hit");
    });

    it("should not apply the framework-module guard to configured project files", async () => {
      // "src/lib/" is reserved for framework modules on the module-read path,
      // but a project may legitimately configure a stylesheet there. Rejecting
      // it reaches the caller as an optional miss and silently drops the file.
      const client = createMockClient({
        getFileContent: (path: string) =>
          path === "src/lib/app.css"
            ? Promise.resolve("body { color: blue; }")
            : Promise.reject(notFoundError()),
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      assertEquals(
        await readOps.readOptionalTextFile("src/lib/app.css"),
        "body { color: blue; }",
      );

      // The guard still holds for module reads, which is what it is for.
      await assertRejects(
        () => readOps.readTextFile("src/lib/app.css"),
        Error,
        "cannot be fetched from API",
      );
    });

    it("should declare an optional draft 404 expected so it is not logged as a fault", async () => {
      const seen: Array<boolean | undefined> = [];
      const client = createMockClient({
        getFileContent: (_path: string, options?: { expectedMissing?: boolean }) => {
          seen.push(options?.expectedMissing);
          return Promise.reject(notFoundError());
        },
      });

      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      await assertRejects(() => readOps.readOptionalTextFile("globals.css"), Error);
      assertEquals(seen, [true], "an optional miss must reach the transport as an expected 404");
    });

    it("should declare an optional published 404 expected and not try other extensions", async () => {
      const seen: Array<boolean | undefined> = [];
      let resolveCalls = 0;
      const client = createMockClient({
        getPublishedFileContent: (
          _path: string,
          _releaseId?: string,
          _environmentName?: string,
          options?: { expectedMissing?: boolean },
        ) => {
          seen.push(options?.expectedMissing);
          return Promise.reject(notFoundError());
        },
        resolveFileWithExtension: () => {
          resolveCalls++;
          return Promise.resolve(null);
        },
      });

      const readOps = createReadOps(client, false, createReleaseContext("rel-optional"));
      readOps.setFileListReadyPromise(Promise.resolve());

      await assertRejects(() => readOps.readOptionalTextFile("theme.ts"), Error, "404 Not Found");
      assertEquals(seen, [true], "an optional miss must reach the transport as an expected 404");
      assertEquals(resolveCalls, 0, "an optional miss must not fan out over other extensions");
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
    it("should clear without error when no index exists", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("api content"),
      });
      const readOps = createReadOps(client, false, createBranchContext());
      readOps.setFileListReadyPromise(Promise.resolve());

      readOps.clearFileListIndex();

      assertEquals(
        await readOps.readTextFile("pages/index.tsx"),
        "api content",
        "clearing an unbuilt index must leave later reads working",
      );
    });

    it("should clear built index", async () => {
      const client = createMockClient({
        getFileContent: () => Promise.resolve("content"),
      });
      const files = [{ path: "pages/index.tsx", content: "v1" }];

      const readOps = createReadOps(
        client,
        false,
        createReleaseContext(),
        (path: string) => path,
        () => Promise.resolve(files),
      );

      assertEquals(
        await readOps.readTextFile("pages/index.tsx"),
        "v1",
        "first read builds the file-list index",
      );

      // The list length and its first/last path stay the same, so the index key
      // memo would keep serving v1 unless the index itself is discarded.
      files[0]!.content = "v2";
      readOps.clearFileListIndex();

      assertEquals(
        await readOps.readTextFile("pages/index.tsx"),
        "v2",
        "clearFileListIndex must discard the in-memory file-list index, not just the extension cache",
      );
    });
  });

  describe("setFileListReadyPromise", () => {
    it("should accept a promise", () => {
      const readOps = createReadyReadOps(createMockClient(), true);
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
    it("should honour isPersistentCacheInvalidated from the context provider", async () => {
      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-123",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "release-123",
        }),
        isPersistentCacheInvalidated: (prefix: string) => prefix.includes("release-123"),
        isReleaseBeingInvalidated: () => false,
      };

      const client = createMockClient({
        getPublishedFileContent: () => Promise.resolve("fresh api content"),
      });
      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      cache.set("file:release:test:release-123:pages/index.tsx", "stale persistent content");

      const readOps = new ReadOperations(client, cache, new PathNormalizer(), contextProvider);

      assertEquals(
        await readOps.readTextFile("pages/index.tsx"),
        "fresh api content",
        "an invalidated prefix reported by the provider must bypass the persistent cache",
      );
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

      const content = await readOps.readTextFile("pages/index.tsx");
      assertEquals(content, "fresh api content");
      assertEquals(fileListCalls, 0);
      assertEquals(fetchedApiPath, "api-source/pages/index.tsx");
    });

    it("should skip extensionless file-list lookups during invalidation", async () => {
      let fileListCalls = 0;
      let resolveCallCount = 0;
      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/home.tsx",
            content: "fresh resolved content",
          });
        },
      });

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "rel-extensionless-invalidation",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "rel-extensionless-invalidation",
        }),
        isPersistentCacheInvalidated: () => true,
        isReleaseBeingInvalidated: () => false,
      };

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: true, ttl: 60000, maxSize: 100 }),
        new PathNormalizer(),
        contextProvider,
        (path: string) => path,
        () => {
          fileListCalls++;
          return Promise.resolve([
            { path: "pages/home.tsx", content: "stale file-list content" },
          ]);
        },
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/home");
      assertEquals(content, "fresh resolved content");
      assertEquals(fileListCalls, 0);
      assertEquals(resolveCallCount, 1);
    });

    it("should skip preview file-list cache reads while branch invalidation is pending", async () => {
      let fileListCalls = 0;
      let fileFetchCount = 0;
      const client = createMockClient({
        getFileContent: () => {
          fileFetchCount++;
          return Promise.resolve("fresh draft content");
        },
      });

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
        isPersistentCacheInvalidated: () => true,
      };

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: true, ttl: 60000, maxSize: 100 }),
        new PathNormalizer(),
        contextProvider,
        (path: string) => path,
        () => {
          fileListCalls++;
          return Promise.resolve([
            { path: "pages/home.tsx", content: "stale file-list content" },
          ]);
        },
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/home.tsx");
      assertEquals(content, "fresh draft content");
      assertEquals(fileListCalls, 0);
      assertEquals(fileFetchCount, 1);
    });

    it("should skip preview extensionless file-list lookups while branch invalidation is pending", async () => {
      let fileListCalls = 0;
      let resolveCallCount = 0;
      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/home.tsx",
            content: "fresh resolved content",
          });
        },
      });

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
        isPersistentCacheInvalidated: () => true,
      };

      const readOps = new ReadOperations(
        client,
        new FileCache({ enabled: true, ttl: 60000, maxSize: 100 }),
        new PathNormalizer(),
        contextProvider,
        (path: string) => path,
        () => {
          fileListCalls++;
          return Promise.resolve([
            { path: "pages/home.tsx", content: "stale file-list content" },
          ]);
        },
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const content = await readOps.readTextFile("pages/home");
      assertEquals(content, "fresh resolved content");
      assertEquals(fileListCalls, 0);
      assertEquals(resolveCallCount, 1);
    });

    it("should skip extension resolution cache reads and writes during invalidation", async () => {
      let invalidated = false;
      let resolveCallCount = 0;
      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      const client = createMockClient({
        resolveFileWithExtension: () => {
          resolveCallCount++;
          return Promise.resolve({
            path: "pages/home.tsx",
            content: resolveCallCount === 1 ? "cached resolved content" : "fresh resolved content",
          });
        },
      });

      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "rel-resolve-invalidation",
        getContentContext: () => ({
          sourceType: "release" as const,
          projectSlug: "test",
          releaseId: "rel-resolve-invalidation",
        }),
        isPersistentCacheInvalidated: () => invalidated,
        isReleaseBeingInvalidated: () => false,
      };

      const readOps = new ReadOperations(
        client,
        cache,
        new PathNormalizer(),
        contextProvider,
      );

      readOps.setFileListReadyPromise(Promise.resolve());

      const warmed = await readOps.readTextFile("pages/home");
      assertEquals(warmed, "cached resolved content");
      assertEquals(
        cache.get("file:release:test:rel-resolve-invalidation:pages/home"),
        "cached resolved content",
      );

      invalidated = true;

      const refreshed = await readOps.readTextFile("pages/home");
      assertEquals(refreshed, "fresh resolved content");
      assertEquals(resolveCallCount, 2);
      assertEquals(
        cache.get("file:release:test:rel-resolve-invalidation:pages/home"),
        "cached resolved content",
      );
      assertEquals(
        cache.get("file:release:test:rel-resolve-invalidation:pages/home.tsx"),
        "cached resolved content",
      );
    });

    it("should track invalidation state changes", async () => {
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

      const client = createMockClient({
        getPublishedFileContent: () => Promise.resolve("fresh api content"),
      });
      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      const cacheKey = "file:release:test-project:release-456:pages/index.tsx";
      cache.set(cacheKey, "stale persistent content");

      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "stale persistent content",
        "a release that is not being invalidated must still serve the cached value",
      );

      invalidatedReleases.add("release-456");

      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "fresh api content",
        "a release marked as invalidating must bypass the persistent cache",
      );

      invalidatedReleases.delete("release-456");
      cache.set(cacheKey, "stale persistent content");

      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "stale persistent content",
        "clearing the invalidation must return the read to the persistent cache",
      );
    });

    it("should handle prefix-based invalidation", async () => {
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

      const client = createMockClient({
        getPublishedFileContent: () => Promise.resolve("fresh api content"),
      });
      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      const cacheKey = "file:release:my-project:release-abc:pages/index.tsx";
      cache.set(cacheKey, "stale persistent content");

      invalidatedPrefixes.add("file:release:my-project:release-xyz:");
      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "stale persistent content",
        "a non-matching prefix must still serve the cached value",
      );

      invalidatedPrefixes.clear();
      invalidatedPrefixes.add("file:release:my-project:release-abc:");
      cache.set(cacheKey, "stale persistent content");

      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "fresh api content",
        "a matching invalidated prefix must bypass the persistent cache",
      );
    });

    it("should handle environment-based invalidation", async () => {
      const invalidatedPrefixes = new Set<string>();

      const environmentContext = {
        sourceType: "environment" as const,
        projectSlug: "env-project",
        environmentName: "production",
        releaseId: "release-env-123",
      };
      const contextProvider: ContentContextProvider = {
        isProductionMode: () => true,
        getReleaseId: () => "release-env-123",
        getContentContext: () => environmentContext,
        isPersistentCacheInvalidated: (prefix: string) => {
          for (const pending of invalidatedPrefixes) {
            if (prefix.startsWith(pending) || pending.startsWith(prefix)) return true;
          }
          return false;
        },
        isReleaseBeingInvalidated: () => false,
      };

      const client = createMockClient({
        getPublishedFileContent: () => Promise.resolve("fresh api content"),
      });
      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      const cacheKey = `${buildFileCacheKeyPrefix(environmentContext)}:pages/index.tsx`;
      cache.set(cacheKey, "stale persistent content");

      invalidatedPrefixes.add("file:env:env-project:staging:");
      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "stale persistent content",
        "an unrelated environment prefix must still serve the cached value",
      );

      invalidatedPrefixes.clear();
      invalidatedPrefixes.add("file:env:env-project:");
      cache.set(cacheKey, "stale persistent content");

      assertEquals(
        await new ReadOperations(client, cache, new PathNormalizer(), contextProvider)
          .readTextFile("pages/index.tsx"),
        "fresh api content",
        "an invalidated environment prefix must bypass the persistent cache",
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

      const readOps = createReadyReadOps(client, false, createBranchContext());
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
    it("rebuilds inline content when file-list paths have not changed", async () => {
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

      assertEquals(
        await readOps.readTextFile("pages/index.tsx"),
        "index content",
        "the first read is served from the freshly built index",
      );

      // The list length and paths stay the same, but inline content changed.
      fileList[0]!.content = "mutated content";

      assertEquals(
        await readOps.readTextFile("pages/index.tsx"),
        "mutated content",
        "a refreshed listing must replace stale inline content",
      );
      assertEquals(indexBuildCount, 2, "getFileListCache is consulted once per read");
    });
  });
});
