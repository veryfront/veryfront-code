import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { type ContentContextProvider, loadAllProjectFiles } from "./file-list-access.ts";

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
});
