import "#veryfront/schemas/_test-setup.ts";
import { delay } from "#std/async.ts";
import { assertEquals, assertObjectMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import { CacheCoordinator } from "./cache-coordinator.ts";

function makeResult(html: string): RenderResult {
  return {
    html,
    frontmatter: {},
    headings: [],
    nodeMap: undefined,
    stream: null,
    ssrHash: "hash",
  };
}

async function withStoreTtlEnabled(fn: () => Promise<void>): Promise<void> {
  const globalState = globalThis as Record<string, unknown>;
  const previousGlobal = globalState.__vfDisableLruInterval;
  const previousEnv = Deno.env.get("VF_DISABLE_LRU_INTERVAL");

  globalState.__vfDisableLruInterval = false;
  Deno.env.delete("VF_DISABLE_LRU_INTERVAL");

  try {
    await fn();
  } finally {
    if (previousGlobal === undefined) {
      delete globalState.__vfDisableLruInterval;
    } else {
      globalState.__vfDisableLruInterval = previousGlobal;
    }

    if (previousEnv === undefined) {
      Deno.env.delete("VF_DISABLE_LRU_INTERVAL");
    } else {
      Deno.env.set("VF_DISABLE_LRU_INTERVAL", previousEnv);
    }
  }
}

describe("CacheCoordinator", () => {
  it("returns cached result on second lookup", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 10_000 });
    const slug = "home";

    const lookupMiss = await coordinator.checkCache(slug);
    assertEquals(lookupMiss.cachedResult, undefined);
    assertEquals(lookupMiss.cacheStatus, "miss");
    assertEquals(typeof lookupMiss.lookupDurationMs, "number");

    await coordinator.persistResult(makeResult("<html>hello</html>"), slug);

    const lookupHit = await coordinator.checkCache(slug);
    assertObjectMatch(lookupHit.cachedResult ?? {}, { html: "<html>hello</html>" });
    assertEquals(lookupHit.cacheStatus, "hit");
    assertEquals(typeof lookupHit.lookupDurationMs, "number");

    await coordinator.destroy();
  });

  it("respects TTL", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: scaleMs(50) });
    const slug = "ttl-test";

    await coordinator.persistResult(makeResult("first"), slug);
    await delay(100);

    const lookup = await coordinator.checkCache(slug);
    assertEquals(lookup.cachedResult, undefined);
    assertEquals(lookup.cacheStatus, "expired");
    assertEquals(typeof lookup.lookupDurationMs, "number");

    await coordinator.destroy();
  });

  it("reports expired when the memory store TTL path is enabled", async () => {
    await withStoreTtlEnabled(async () => {
      const coordinator = new CacheCoordinator({ ttlMs: scaleMs(20) });
      const slug = "store-ttl-test";

      await coordinator.persistResult(makeResult("first"), slug);
      await delay(40);

      const lookup = await coordinator.checkCache(slug);
      assertEquals(lookup.cachedResult, undefined);
      assertEquals(lookup.cacheStatus, "expired");

      await coordinator.destroy();
    });
  });

  it("isolates cache entries by projectId", async () => {
    const projectA = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "project-a",
      contentSourceId: "main",
    });
    const projectB = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "project-b",
      contentSourceId: "main",
    });
    const slug = "home"; // Same slug for both projects

    // Cache different content for same slug in different projects
    await projectA.persistResult(makeResult("<html>Project A</html>"), slug);
    await projectB.persistResult(makeResult("<html>Project B</html>"), slug);

    // Each project should get its own cached content
    const lookupA = await projectA.checkCache(slug);
    const lookupB = await projectB.checkCache(slug);

    assertObjectMatch(lookupA.cachedResult ?? {}, { html: "<html>Project A</html>" });
    assertObjectMatch(lookupB.cachedResult ?? {}, { html: "<html>Project B</html>" });

    await projectA.destroy();
    await projectB.destroy();
  });

  it("includes projectId in cache key", async () => {
    const coordinator = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "my-project",
      contentSourceId: "main",
    });
    const slug = "test-page";

    await coordinator.persistResult(makeResult("<html>test</html>"), slug);

    const lookup = await coordinator.checkCache(slug);
    // The moduleCacheKey should include the project prefix
    assertEquals(lookup.moduleCacheKey.startsWith("my-project:main:"), true);

    await coordinator.destroy();
  });

  it("clearForProject only clears entries for that project", async () => {
    const projectA = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "project-a",
      contentSourceId: "main",
    });
    const projectB = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "project-b",
      contentSourceId: "main",
    });
    const slug = "home";

    // Cache content for both projects
    await projectA.persistResult(makeResult("<html>Project A</html>"), slug);
    await projectB.persistResult(makeResult("<html>Project B</html>"), slug);

    // Clear only project A
    await projectA.clearForProject();

    // Project A should be cleared, Project B should still be cached
    const lookupA = await projectA.checkCache(slug);
    const lookupB = await projectB.checkCache(slug);

    assertEquals(lookupA.cachedResult, undefined);
    assertObjectMatch(lookupB.cachedResult ?? {}, { html: "<html>Project B</html>" });

    await projectA.destroy();
    await projectB.destroy();
  });
});
