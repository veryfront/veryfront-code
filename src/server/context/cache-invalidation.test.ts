import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { cacheRegistry } from "#veryfront/cache";
import type { DistributedCacheProjectIdentity } from "#veryfront/cache/backends/distributed-keyspace.ts";
import { invalidateProjectCaches } from "./cache-invalidation.ts";
import {
  clearImportMapCache,
  getCachedImportMap,
  preloadImportMap,
} from "#veryfront/modules/import-map/preloader.ts";
import { createImportMapIdentity } from "#veryfront/modules/import-map/identity.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  __destroyRSCHandlerForTests,
  getRSCHandler,
} from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import type { VeryfrontConfig } from "#veryfront/config";

Deno.test("invalidateProjectCaches awaits project-scoped distributed invalidation", async () => {
  const originalDeleteDistributedKeysForProject = cacheRegistry.deleteDistributedKeysForProject;
  let capturedIdentity: DistributedCacheProjectIdentity | undefined;
  let markDeleteStarted!: () => void;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  let releaseDelete!: () => void;
  const deleteReleased = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  cacheRegistry.deleteDistributedKeysForProject = async (identity) => {
    capturedIdentity = typeof identity === "string" ? { projectId: identity } : identity;
    markDeleteStarted();
    await deleteReleased;
    return 1;
  };

  try {
    let invalidationSettled = false;
    const invalidation = invalidateProjectCaches(
      "target-slug",
      ["src/page.tsx"],
      { projectId: "target-id" },
    ).then(() => {
      invalidationSettled = true;
    });

    await deleteStarted;
    await Promise.resolve();
    assertEquals(invalidationSettled, false);
    assertEquals(capturedIdentity, {
      projectId: "target-id",
      projectSlug: "target-slug",
    });

    releaseDelete();
    await invalidation;
    assertEquals(invalidationSettled, true);
  } finally {
    releaseDelete();
    cacheRegistry.deleteDistributedKeysForProject = originalDeleteDistributedKeysForProject;
  }
});

Deno.test("invalidateProjectCaches evicts request import maps and RSC handlers", async () => {
  const projectDir = "/virtual/cache-invalidation";
  const projectId = "cache-invalidation-project";
  const contentSourceId = "preview-main";
  const adapter = createMockAdapter();
  const config = {
    experimental: { rsc: true },
    resolve: { importMap: { imports: { package: "node:fs" } } },
  } as VeryfrontConfig;
  const context = { contentSourceId, config };

  clearImportMapCache(projectId);
  __destroyRSCHandlerForTests();

  try {
    const importMapIdentity = await createImportMapIdentity(
      await preloadImportMap(projectDir, adapter, projectId, context),
    );
    const staleHandler = getRSCHandler(projectDir, projectId, {
      adapter,
      config,
      contentSourceId,
      importMapIdentity,
      mode: "development",
    });
    assertEquals(
      getRSCHandler(projectDir, projectId, {
        adapter,
        config,
        contentSourceId,
        importMapIdentity,
        mode: "development",
      }),
      staleHandler,
    );
    assertEquals(
      (await getCachedImportMap(projectId, context)) !== undefined,
      true,
    );

    await invalidateProjectCaches(
      "cache-invalidation-slug",
      ["deno.json"],
      { projectId, projectDir, contentSourceId, environment: "preview" },
    );

    assertEquals(await getCachedImportMap(projectId, context), undefined);
    assertEquals(
      getRSCHandler(projectDir, projectId, {
        adapter,
        config,
        contentSourceId,
        importMapIdentity,
        mode: "development",
      }) !== staleHandler,
      true,
    );
  } finally {
    clearImportMapCache(projectId);
    __destroyRSCHandlerForTests();
  }
});
