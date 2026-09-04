import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { type ContentContextProvider, loadAllProjectFiles } from "./file-list-access.ts";
import { runWithRequestContext } from "./request-context.ts";

function makeFile(path: string): ProjectFile {
  return {
    id: path,
    path,
    type: "file",
    updated_at: "2024-01-01T00:00:00.000Z",
    size: 0,
  };
}

function createLogger() {
  return {
    debug: () => {},
    warn: () => {},
  };
}

describe("veryfront/file-list-access", () => {
  it("prefers the adapter-provided file list when caches are valid", async () => {
    let apiCalls = 0;
    const files = [makeFile("pages/index.tsx")];
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: "main",
      }),
      getFileList: () => Promise.resolve(files),
      isPersistentCacheInvalidated: () => false,
    };

    const loaded = await loadAllProjectFiles({
      client: {
        listAllFiles: () => {
          apiCalls++;
          return Promise.resolve([]);
        },
        listPublishedFiles: () => {
          apiCalls++;
          return Promise.resolve([]);
        },
      } as any,
      cache: new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(loaded, files);
    assertEquals(apiCalls, 0);
  });

  it("uses the published files API for release contexts", async () => {
    let publishedArgs: [string | undefined, string | undefined, string | undefined] | null = null;
    const files = [makeFile("pages/index.tsx")];
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => true,
      getReleaseId: () => "rel-1",
      getContentContext: () => ({
        sourceType: "release",
        projectSlug: "test",
        releaseId: "rel-1",
        environmentName: "prod",
      }),
      isPersistentCacheInvalidated: () => false,
    };

    const loaded = await loadAllProjectFiles({
      client: {
        listAllFiles: () => Promise.resolve([]),
        listPublishedFiles: (
          cursor?: string,
          releaseId?: string,
          environmentName?: string,
        ) => {
          publishedArgs = [cursor, releaseId, environmentName];
          return Promise.resolve(files);
        },
      } as any,
      cache: new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(loaded, files);
    assertEquals(publishedArgs, [undefined, "rel-1", "prod"]);
  });

  it("skips provider and persistent cache reads while invalidation is active", async () => {
    let providerCalls = 0;
    let apiCalls = 0;
    const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: "main",
      }),
      getFileList: () => {
        providerCalls++;
        return Promise.resolve([makeFile("stale.tsx")]);
      },
      isPersistentCacheInvalidated: () => true,
    };

    cache.set("files:branch:test:main", [makeFile("cached.tsx")]);

    const loaded = await loadAllProjectFiles({
      client: {
        listAllFiles: () => {
          apiCalls++;
          return Promise.resolve([makeFile("fresh.tsx")]);
        },
        listPublishedFiles: () => Promise.resolve([]),
      } as any,
      cache,
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(providerCalls, 0);
    assertEquals(apiCalls, 1);
    assertEquals(loaded.map((file) => file.path), ["fresh.tsx"]);
  });

  it("serves a valid persistent cache entry without calling the API", async () => {
    let apiCalls = 0;
    const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: "main",
      }),
      isPersistentCacheInvalidated: () => false,
    };

    cache.set("files:branch:test:main", [makeFile("cached.tsx")]);

    const loaded = await loadAllProjectFiles({
      client: {
        listAllFiles: () => {
          apiCalls++;
          return Promise.resolve([makeFile("fresh.tsx")]);
        },
        listPublishedFiles: () => Promise.resolve([]),
      } as any,
      cache,
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(
      loaded.map((file) => file.path),
      ["cached.tsx"],
      "a valid persistent cache entry must be served without hitting the API",
    );
    assertEquals(apiCalls, 0, "a persistent cache hit must not refetch the file list");
  });

  it("writes a fetched file list back to the persistent cache", async () => {
    let apiCalls = 0;
    const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: "main",
      }),
      isPersistentCacheInvalidated: () => false,
    };

    const client = {
      listAllFiles: () => {
        apiCalls++;
        return Promise.resolve([makeFile("fresh.tsx")]);
      },
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    await loadAllProjectFiles({
      client,
      cache,
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(
      (await cache.getAsync<ProjectFile[]>("files:branch:test:main"))?.map((file) => file.path),
      ["fresh.tsx"],
      "a fetched file list must be written back to the persistent cache",
    );

    await loadAllProjectFiles({
      client,
      cache,
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(apiCalls, 1, "the written-back entry must answer the next load");
  });

  it("bypasses persistent file-list caches for contextual credentials", async () => {
    const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
    cache.set("files:branch:test:main", [makeFile("cached.tsx")]);
    let apiCalls = 0;
    const client = {
      listAllFiles: () => {
        apiCalls += 1;
        return Promise.resolve([makeFile("fresh.tsx")]);
      },
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    const loaded = await runWithRequestContext(
      { projectSlug: "test", token: "context-token", productionMode: false, branch: "main" },
      () =>
        loadAllProjectFiles({
          client,
          cache,
          contextProvider: {
            isProductionMode: () => false,
            getReleaseId: () => null,
            getContentContext: () => ({
              sourceType: "branch",
              projectSlug: "test",
              branch: "main",
            }),
          },
          logger: createLogger(),
          operationLabel: "test",
        }),
    );

    assertEquals(apiCalls, 1);
    assertEquals(loaded.map((file) => file.path), ["fresh.tsx"]);
    assertEquals(
      (await cache.getAsync<ProjectFile[]>("files:branch:test:main"))?.map((file) => file.path),
      ["cached.tsx"],
    );
  });

  it("retries a fallback fetch that spans a source snapshot change", async () => {
    let apiCalls = 0;
    let snapshotVersion = 1;
    const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: "main",
      }),
      getSourceSnapshotVersion: () => snapshotVersion,
      getSourceSnapshotIdentity: () => "branch:test:main",
      isPersistentCacheInvalidated: () => false,
    };
    const client = {
      listAllFiles: () => {
        apiCalls += 1;
        if (apiCalls === 1) {
          snapshotVersion += 1;
          return Promise.resolve([makeFile("stale.tsx")]);
        }
        return Promise.resolve([makeFile("fresh.tsx")]);
      },
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    const loaded = await loadAllProjectFiles({
      client,
      cache,
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(apiCalls, 2);
    assertEquals(loaded.map((file) => file.path), ["fresh.tsx"]);
    assertEquals(
      (await cache.getAsync<ProjectFile[]>("files:branch:test:main"))?.map((file) => file.path),
      ["fresh.tsx"],
    );
  });

  it("keeps the caller's branch context when retrying across a snapshot change", async () => {
    let apiCalls = 0;
    let snapshotVersion = 1;
    const currentBranch = "branch-a";
    const requestedBranches: string[] = [];
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: currentBranch,
      }),
      getSourceSnapshotVersion: () => snapshotVersion,
      getSourceSnapshotIdentity: () => `branch:test:${currentBranch}`,
      isPersistentCacheInvalidated: () => false,
    };
    const client = {
      listAllFiles: (_options: unknown, context: { name?: string }) => {
        apiCalls += 1;
        requestedBranches.push(context.name ?? "");
        if (apiCalls <= 2) {
          snapshotVersion += 1;
        }
        return Promise.resolve([makeFile(`${context.name}.tsx`)]);
      },
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    const loaded = await loadAllProjectFiles({
      client,
      cache: new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
      contentContext: {
        sourceType: "branch",
        projectSlug: "test",
        branch: "branch-a",
      },
    });

    assertEquals(requestedBranches, ["branch-a", "branch-a", "branch-a"]);
    assertEquals(loaded.map((file) => file.path), ["branch-a.tsx"]);
  });

  it("does not retry a pinned branch fetch when an unrelated branch changes", async () => {
    let apiCalls = 0;
    let snapshotVersion = 1;
    let currentBranch = "branch-a";
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test",
        branch: currentBranch,
      }),
      getSourceSnapshotVersion: () => snapshotVersion,
      getSourceSnapshotIdentity: () => `branch:test:${currentBranch}`,
      isPersistentCacheInvalidated: () => false,
    };
    const client = {
      listAllFiles: (_options: unknown, context: { name?: string }) => {
        apiCalls += 1;
        currentBranch = "branch-b";
        snapshotVersion += 1;
        return Promise.resolve([makeFile(`${context.name}.tsx`)]);
      },
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    const loaded = await loadAllProjectFiles({
      client,
      cache: new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 }),
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
      contentContext: { sourceType: "branch", projectSlug: "test", branch: "branch-a" },
    });

    assertEquals(apiCalls, 1);
    assertEquals(loaded.map((file) => file.path), ["branch-a.tsx"]);
  });

  it("bounds retries during sustained changes and does not cache the result", async () => {
    let apiCalls = 0;
    let snapshotVersion = 1;
    const cache = new FileCache({ enabled: true, ttl: 60_000, maxSize: 100 });
    const contextProvider: ContentContextProvider = {
      isProductionMode: () => false,
      getReleaseId: () => null,
      getContentContext: () => ({ sourceType: "branch", projectSlug: "test", branch: "main" }),
      getSourceSnapshotVersion: () => snapshotVersion,
      getSourceSnapshotIdentity: () => "branch:test:main",
      isPersistentCacheInvalidated: () => false,
    };
    const client = {
      listAllFiles: () => {
        apiCalls += 1;
        snapshotVersion += 1;
        return Promise.resolve([makeFile(`result-${apiCalls}.tsx`)]);
      },
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    const loaded = await loadAllProjectFiles({
      client,
      cache,
      contextProvider,
      logger: createLogger(),
      operationLabel: "test",
    });

    assertEquals(apiCalls, 4);
    assertEquals(loaded.map((file) => file.path), ["result-4.tsx"]);
    assertEquals(await cache.getAsync("files:branch:test:main"), undefined);
  });
});
