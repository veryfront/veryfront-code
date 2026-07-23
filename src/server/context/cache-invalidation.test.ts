import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { cacheRegistry } from "#veryfront/cache";
import type { RedisCacheProjectIdentity } from "#veryfront/cache/backends/redis-keyspace.ts";
import { invalidateProjectCaches } from "./cache-invalidation.ts";

Deno.test("invalidateProjectCaches awaits project-scoped Redis invalidation", async () => {
  const originalDeleteRedisKeysForProject = cacheRegistry.deleteRedisKeysForProject;
  let capturedIdentity: RedisCacheProjectIdentity | undefined;
  let markDeleteStarted!: () => void;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  let releaseDelete!: () => void;
  const deleteReleased = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  cacheRegistry.deleteRedisKeysForProject = async (identity) => {
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
    cacheRegistry.deleteRedisKeysForProject = originalDeleteRedisKeysForProject;
  }
});
