import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { ContentContextProvider } from "./file-list-access.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { StatOperations } from "./stat-operations.ts";
import { buildStatCacheKeyPrefix } from "./cache-keys.ts";
import { getCurrentRequestContext, runWithRequestContext } from "./request-context.ts";

function createMockClient(overrides: Record<string, unknown> = {}): VeryfrontApiClient {
  return {
    getRequestBranch: () => "main",
    listAllFiles: () => Promise.resolve([]),
    listPublishedFiles: () => Promise.resolve([]),
    searchFiles: () => Promise.resolve([]),
    ...overrides,
  } as unknown as VeryfrontApiClient;
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
    hasCachedFileList: () => Promise.resolve(files.length > 0),
    isPersistentCacheInvalidated: () => false,
  };
}

function createStatOps(
  client: VeryfrontApiClient = createMockClient(),
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

    it("should throw a recognized not-found error for a non-existent path", async () => {
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
        assertEquals(isNotFoundError(e), true);
      }
    });

    it("should recover a file missing from a stale index via API search", async () => {
      let searchCalls = 0;
      let searchedBranch: string | undefined;
      const client = createMockClient({
        searchFiles: (pattern: string, context?: { type: "branch"; name: string }) => {
          searchCalls++;
          searchedBranch = context?.name;
          return Promise.resolve(
            pattern === "components/Late.tsx"
              ? [{ id: "late-1", path: "components/Late.tsx" }]
              : [],
          );
        },
      });
      const statOps = createStatOps(
        client,
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      await statOps.stat("pages/index.tsx");
      (statOps as unknown as { indexBuiltAt: number }).indexBuiltAt = Date.now() -
        (5 * 60 * 1000 + 1);

      const info = await statOps.stat("components/Late.tsx");
      assertEquals(
        info.isFile,
        true,
        "a file missing from a stale index must be recovered via searchFiles",
      );
      assertEquals(info.isDirectory, false, "the recovered entry is a file, not a directory");
      assertEquals(searchCalls, 1, "the stale index must fall back to exactly one API search");
      assertEquals(searchedBranch, "main");

      await statOps.stat("components/Late.tsx");
      assertEquals(
        searchCalls,
        1,
        "the recovered file must be inserted into the index, not re-searched",
      );
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

    it("should propagate non-not-found failures instead of reporting absence", async () => {
      const statOps = createStatOps(createMockClient(), new PathNormalizer(), {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
        getFileList: () => Promise.reject(new Error("upstream down")),
        hasCachedFileList: () => Promise.resolve(false),
        isPersistentCacheInvalidated: () => false,
      });

      await assertRejects(
        () => statOps.exists("pages/index.tsx"),
        Error,
        "upstream down",
        "an upstream listing failure must surface, not be reported as absence",
      );
    });

    it("should not route existence misses through the public stat span", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );
      let publicStatCalled = false;
      statOps.stat = async () => {
        publicStatCalled = true;
        throw new Error("stat should not be called by exists");
      };

      assertEquals(await statOps.exists("nonexistent.tsx"), false);
      assertEquals(publicStatCalled, false);
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

    it("should not add pages/ prefix when disabled for source resolution", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/about.tsx")]),
      );

      assertEquals(await statOps.resolveFile("about", { allowPagesPrefix: false }), null);
    });

    it("should resolve with different extension when original not found", async () => {
      const statOps = createStatOps(
        createMockClient(),
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("utils/helpers.ts")]),
      );

      assertEquals(await statOps.resolveFile("utils/helpers.tsx"), "utils/helpers.ts");
    });

    it("should reuse negative cache and avoid duplicate API search for same missing path", async () => {
      let searchCallCount = 0;
      const client = createMockClient({
        searchFiles: () => {
          searchCallCount++;
          return Promise.resolve([]);
        },
      });

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
        new PathNormalizer(),
        createBranchContextWithFiles([]),
      );

      assertEquals(await statOps.resolveFile("missing/component"), null);
      assertEquals(await statOps.resolveFile("missing/component"), null);
      assertEquals(searchCallCount, 4);
    });

    it("should treat an empty provided file list as authoritative", async () => {
      let searchCallCount = 0;
      const client = createMockClient({
        searchFiles: () => {
          searchCallCount++;
          return Promise.resolve([]);
        },
      });
      const contextProvider = createBranchContextWithFiles([]);
      contextProvider.hasCachedFileList = undefined;
      const statOps = createStatOps(client, new PathNormalizer(), contextProvider);

      assertEquals(await statOps.resolveFile("missing/component"), null);
      assertEquals(searchCallCount, 0);
    });

    it("should resolve via API search without building the full index", async () => {
      let listAllFilesCallCount = 0;
      let searchCallCount = 0;

      const client = createMockClient({
        listAllFiles: () => {
          listAllFilesCallCount++;
          return Promise.resolve([]);
        },
        searchFiles: (pattern: string) => {
          searchCallCount++;
          if (pattern === "pages/about.*") {
            return Promise.resolve([{ path: "pages/about.tsx" }]);
          }
          return Promise.resolve([]);
        },
      });

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
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

      assertEquals(await statOps.resolveFile("pages/about"), "pages/about.tsx");
      assertEquals(searchCallCount, 1);
      assertEquals(listAllFilesCallCount, 0);
    });

    it("keeps API resolution on the context captured before an async lookup", async () => {
      let currentBranch = "main";
      let releaseLookup: (() => void) | undefined;
      const lookupBlocked = new Promise<void>((resolve) => {
        releaseLookup = resolve;
      });
      let markLookupStarted: (() => void) | undefined;
      const lookupStarted = new Promise<void>((resolve) => {
        markLookupStarted = resolve;
      });
      const searchedBranches: Array<string | undefined> = [];
      const client = createMockClient({
        searchFiles: (
          pattern: string,
          context?: { type: "branch"; name: string },
        ) => {
          searchedBranches.push(context?.name);
          return Promise.resolve(pattern === "pages/about.*" ? [{ path: "pages/about.tsx" }] : []);
        },
      });
      const contextProvider: ContentContextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch",
          projectSlug: "test",
          branch: currentBranch,
        }),
        hasCachedFileList: async () => {
          markLookupStarted?.();
          await lookupBlocked;
          return false;
        },
        isPersistentCacheInvalidated: () => false,
      };
      const statOps = createStatOps(client, new PathNormalizer(), contextProvider);

      const pending = statOps.resolveFile("pages/about");
      await lookupStarted;
      currentBranch = "draft";
      releaseLookup?.();

      assertEquals(await pending, "pages/about.tsx");
      assertEquals(searchedBranches, ["main"]);
    });

    it("does not publish a negative resolution after its generation is cleared", async () => {
      const lookup = Promise.withResolvers<boolean>();
      const contextProvider: ContentContextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch",
          projectSlug: "test",
          branch: "main",
        }),
        hasCachedFileList: () => lookup.promise,
        isPersistentCacheInvalidated: () => false,
      };
      const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
      const statOps = new StatOperations(
        createMockClient(),
        cache,
        new PathNormalizer(),
        contextProvider,
      );
      const pending = statOps.resolveFile("pages/missing");
      await Promise.resolve();
      statOps.clearIndex();
      lookup.resolve(false);

      assertEquals(await pending, null);
      const cacheKey = `${
        buildStatCacheKeyPrefix(contextProvider.getContentContext())
      }:resolve:pages/missing`;
      assertEquals(await cache.getAsync(cacheKey), undefined);
    });

    it("bypasses stale resolutions while their branch cache is being cleared", async () => {
      let invalidated = false;
      let resolvedPath = "pages/about.tsx";
      let searchCalls = 0;
      const contentContext = {
        sourceType: "branch" as const,
        projectSlug: "test",
        branch: "main",
      };
      const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
      const statOps = new StatOperations(
        createMockClient({
          searchFiles: () => {
            searchCalls++;
            return Promise.resolve([{ path: resolvedPath }]);
          },
        }),
        cache,
        new PathNormalizer(),
        {
          isProductionMode: () => false,
          getReleaseId: () => null,
          getContentContext: () => contentContext,
          hasCachedFileList: () => Promise.resolve(false),
          isPersistentCacheInvalidated: () => invalidated,
        },
      );
      const cacheKey = `${buildStatCacheKeyPrefix(contentContext)}:resolve:pages/about`;

      assertEquals(await statOps.resolveFile("pages/about"), "pages/about.tsx");
      resolvedPath = "pages/about.mdx";
      invalidated = true;
      assertEquals(await statOps.resolveFile("pages/about"), "pages/about.mdx");
      assertEquals(searchCalls, 2);
      assertEquals(
        await cache.getAsync(cacheKey),
        "pages/about.tsx",
        "a read during invalidation must not overwrite the persistent stat cache",
      );
    });

    it("rebuilds a stale stat index while its branch cache is being cleared", async () => {
      let invalidated = false;
      let files = [makeFile("stale.ts")];
      const contentContext = {
        sourceType: "branch" as const,
        projectSlug: "test",
        branch: "main",
      };
      const statOps = new StatOperations(
        createMockClient({ listAllFiles: () => Promise.resolve(files) }),
        new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
        new PathNormalizer(),
        {
          isProductionMode: () => false,
          getReleaseId: () => null,
          getContentContext: () => contentContext,
          getFileList: () => Promise.resolve(files),
          isPersistentCacheInvalidated: () => invalidated,
        },
      );

      assertEquals((await statOps.stat("stale.ts")).isFile, true);
      files = [makeFile("fresh.ts")];
      invalidated = true;
      assertEquals((await statOps.stat("fresh.ts")).isFile, true);
      await assertRejects(() => statOps.stat("stale.ts"));
    });

    it("scopes stat indexes to the request authority", async () => {
      let listCalls = 0;
      const contentContext = {
        sourceType: "branch" as const,
        projectSlug: "test",
        branch: "main",
      };
      const statOps = new StatOperations(
        createMockClient({
          listAllFiles: () => {
            listCalls++;
            return Promise.resolve([makeFile(`${getCurrentRequestContext()?.token}.ts`)]);
          },
        }),
        new FileCache({ enabled: false, ttl: 60_000, maxSize: 100 }),
        new PathNormalizer(),
        {
          isProductionMode: () => false,
          getReleaseId: () => null,
          getContentContext: () => contentContext,
          isPersistentCacheInvalidated: () => false,
        },
      );

      const tokenA = await runWithRequestContext(
        { projectSlug: "test", token: "token-a", branch: "main" },
        () => statOps.stat("token-a.ts"),
      );
      const tokenB = await runWithRequestContext(
        { projectSlug: "test", token: "token-b", branch: "main" },
        () => statOps.stat("token-b.ts"),
      );

      assertEquals(tokenA.isFile, true);
      assertEquals(tokenB.isFile, true);
      assertEquals(listCalls, 2);
    });

    it("should retry pages-prefixed API patterns after an incomplete index miss", async () => {
      const patterns: string[] = [];

      const client = createMockClient({
        searchFiles: (pattern: string) => {
          patterns.push(pattern);
          if (pattern === "pages/about.*") {
            return Promise.resolve([{ path: "pages/about.tsx" }]);
          }
          return Promise.resolve([]);
        },
      });

      const statOps = createStatOps(
        client,
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("about"), "pages/about.tsx");
      assertEquals(patterns, ["about.*", "pages/about.*"]);
    });

    it("should retry index-file API patterns after an incomplete index miss", async () => {
      const patterns: string[] = [];

      const client = createMockClient({
        searchFiles: (pattern: string) => {
          patterns.push(pattern);
          if (pattern === "components/index.*") {
            return Promise.resolve([{ path: "components/index.tsx" }]);
          }
          return Promise.resolve([]);
        },
      });

      const statOps = createStatOps(
        client,
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("components"), "components/index.tsx");
      assertEquals(patterns, ["components.*", "pages/components.*", "components/index.*"]);
    });

    it("should keep wildcard extension fallback after an incomplete index miss", async () => {
      const patterns: string[] = [];

      const client = createMockClient({
        searchFiles: (pattern: string) => {
          patterns.push(pattern);
          if (pattern === "components/Button.*") {
            return Promise.resolve([{ path: "components/Button.ts" }]);
          }
          return Promise.resolve([]);
        },
      });

      const statOps = createStatOps(
        client,
        new PathNormalizer(),
        createBranchContextWithFiles([makeFile("pages/index.tsx")]),
      );

      assertEquals(await statOps.resolveFile("components/Button.tsx"), "components/Button.ts");
      assertEquals(patterns, ["components/Button.*"]);
    });

    it("should skip pages/ API search patterns when pages prefix is disabled", async () => {
      const patterns: string[] = [];

      const client = createMockClient({
        searchFiles: (pattern: string) => {
          patterns.push(pattern);
          return Promise.resolve([]);
        },
      });

      const statOps = new StatOperations(
        client,
        new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
        new PathNormalizer(),
        {
          isProductionMode: () => false,
          getReleaseId: () => null,
          getContentContext: () => ({
            sourceType: "branch" as const,
            projectSlug: "test",
            branch: "main",
          }),
          hasCachedFileList: () => Promise.resolve(false),
          isPersistentCacheInvalidated: () => false,
        },
      );

      assertEquals(await statOps.resolveFile("about", { allowPagesPrefix: false }), null);
      assertEquals(patterns, ["about.*", "about/index.*"]);
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

    it("rebuilds a same-scope waiter after an in-flight index is cleared", async () => {
      const firstListing = Promise.withResolvers<ProjectFile[]>();
      let listingCalls = 0;
      const contextProvider: ContentContextProvider = {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch",
          projectSlug: "test",
          branch: "main",
        }),
        getFileList: () => {
          listingCalls++;
          return listingCalls === 1 ? firstListing.promise : Promise.resolve([makeFile("new.ts")]);
        },
        isPersistentCacheInvalidated: () => false,
      };
      const statOps = createStatOps(createMockClient(), new PathNormalizer(), contextProvider);

      const oldStat = statOps.stat("old.ts");
      await Promise.resolve();
      statOps.clearIndex();
      const newStat = statOps.stat("new.ts");
      firstListing.resolve([makeFile("old.ts")]);

      await oldStat.catch(() => undefined);
      assertEquals((await newStat).isFile, true);
      assertEquals(listingCalls, 2);
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

    it("should attempt API search again after circuit breaker cooldown", async () => {
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;

      try {
        let searchCallCount = 0;
        const client = createMockClient({
          searchFiles: () => {
            searchCallCount++;
            return Promise.reject(new Error("API error"));
          },
        });

        const statOps = new StatOperations(
          client,
          new FileCache({ enabled: false, ttl: 1000, maxSize: 100 }),
          new PathNormalizer(),
          createBranchContextWithFiles([]),
        );

        for (let i = 0; i < 5; i++) {
          await statOps.resolveFile(`missing-trip-${i}`);
        }
        assertEquals(searchCallCount, 5);

        await statOps.resolveFile("missing-while-open");
        assertEquals(searchCallCount, 5);

        now += 30_001;

        await statOps.resolveFile("missing-after-cooldown");
        // First request exhausts 4 patterns, second request trips the breaker on its first pattern,
        // and the post-cooldown request gets another full 4-pattern attempt.
        assertEquals(searchCallCount, 9);
      } finally {
        Date.now = originalNow;
      }
    });

    it("should not negatively cache a path it could not search while the breaker was open", async () => {
      const originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;

      try {
        let failing = true;
        const client = createMockClient({
          searchFiles: (pattern: string) => {
            if (failing) return Promise.reject(new Error("API error"));
            return Promise.resolve(
              pattern === "pages/late.*" ? [{ path: "pages/late.tsx" }] : [],
            );
          },
        });

        const statOps = new StatOperations(
          client,
          new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
          new PathNormalizer(),
          createBranchContextWithFiles([makeFile("pages/index.tsx")]),
        );

        for (let i = 0; i < 5; i++) {
          await statOps.resolveFile(`missing-trip-${i}`);
        }

        assertEquals(
          await statOps.resolveFile("pages/late"),
          null,
          "a path that could not be searched while the breaker was open resolves to null",
        );

        failing = false;
        now += 30_001;

        assertEquals(
          await statOps.resolveFile("pages/late"),
          "pages/late.tsx",
          "a path probed while the breaker was open must not be negatively cached",
        );
      } finally {
        Date.now = originalNow;
      }
    });
  });
});
