import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import { CacheCoordinator } from "./cache-coordinator.ts";
import { serializeCachePayload } from "./cache-payload.ts";
import type { CachePayload, CacheStore } from "./types.ts";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  it("rejects invalid TTL/stale durations", () => {
    for (const ttlMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(() => new CacheCoordinator({ ttlMs }), RangeError, "ttlMs");
    }
    for (const staleMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(() => new CacheCoordinator({ staleMs }), RangeError, "staleMs");
    }
  });

  it("treats a zero TTL as immediate expiry", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 0, staleMs: 0 });
    await coordinator.persistResult(makeResult("zero"), "zero");
    assertEquals((await coordinator.checkCache("zero")).cacheStatus, "expired");
    await coordinator.destroy();
  });

  it("returns cached result on second lookup", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 10_000 });
    const slug = "home";

    const lookupMiss = await coordinator.checkCache(slug);
    assertEquals(lookupMiss.cachedResult, undefined);
    assertEquals(lookupMiss.cacheStatus, "miss");
    assertEquals(typeof lookupMiss.lookupDurationMs, "number");

    await coordinator.persistResult(makeResult("<html>hello</html>"), slug);

    const lookupHit = await coordinator.checkCache(slug);
    assertEquals(lookupHit.cachedResult?.html, "<html>hello</html>");
    assertEquals(lookupHit.cacheStatus, "hit");
    assertEquals(typeof lookupHit.lookupDurationMs, "number");

    await coordinator.destroy();
  });

  it("preserves Date frontmatter across the second-render cache hit", async () => {
    let stored: CachePayload | undefined;
    const serializedStore: CacheStore = {
      get: () => Promise.resolve(stored),
      set: (_key, value) => {
        stored = JSON.parse(serializeCachePayload(value)) as CachePayload;
        return Promise.resolve();
      },
      delete: () => {
        stored = undefined;
        return Promise.resolve();
      },
      clear: () => {
        stored = undefined;
        return Promise.resolve();
      },
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({
      store: serializedStore,
      ttlMs: 10_000,
      projectId: "date-project",
    });
    const result = makeResult("<html>dated</html>");
    const publicationDate = new Date("2026-07-24T08:30:00.000Z");
    result.frontmatter = {
      date: publicationDate,
      metadata: {
        revisedAt: new Date("2026-07-25T09:45:00.000Z"),
      },
    };

    await coordinator.persistResult(result, "dated");
    const lookup = await coordinator.checkCache("dated");

    assertEquals(lookup.cacheStatus, "hit");
    assertEquals(lookup.cachedResult?.frontmatter, {
      date: new Date("2026-07-24T08:30:00.000Z"),
      metadata: {
        revisedAt: new Date("2026-07-25T09:45:00.000Z"),
      },
    });
    assertEquals(lookup.cachedResult?.frontmatter.date === publicationDate, false);
    await coordinator.destroy();
  });

  it("evicts malformed store values and treats them as misses", async () => {
    let deletedKey: string | undefined;
    const store: CacheStore = {
      get: () => Promise.resolve({} as CachePayload),
      set: () => Promise.resolve(),
      delete: (key) => {
        deletedKey = key;
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "project" });

    const lookup = await coordinator.checkCache("malformed");

    assertEquals(lookup.cacheStatus, "miss");
    assertEquals(lookup.cachedResult, undefined);
    assertEquals(deletedKey, "project:draft:malformed");
  });

  it("respects TTL", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: scaleMs(50), staleMs: 0 });
    const slug = "ttl-test";

    await coordinator.persistResult(makeResult("first"), slug);
    await delay(100);

    const lookup = await coordinator.checkCache(slug);
    assertEquals(lookup.cachedResult, undefined);
    assertEquals(lookup.cacheStatus, "expired");
    assertEquals(typeof lookup.lookupDurationMs, "number");

    await coordinator.destroy();
  });
  it("serves recently expired entries as stale while refresh can run", async () => {
    const coordinator = new CacheCoordinator({
      ttlMs: scaleMs(20),
      staleMs: scaleMs(500),
    });
    const slug = "stale-test";

    await coordinator.persistResult(makeResult("first"), slug);
    await delay(40);

    const lookup = await coordinator.checkCache(slug);
    assertEquals(lookup.cachedResult?.html, "first");
    assertEquals(lookup.cacheStatus, "stale");
    assertEquals(typeof lookup.lookupDurationMs, "number");

    await coordinator.destroy();
  });

  it("reports expired when the memory store TTL path is enabled", async () => {
    await withStoreTtlEnabled(async () => {
      const coordinator = new CacheCoordinator({ ttlMs: scaleMs(20), staleMs: 0 });
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

    assertEquals(lookupA.cachedResult?.html, "<html>Project A</html>");
    assertEquals(lookupB.cachedResult?.html, "<html>Project B</html>");

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
    assertEquals(lookupB.cachedResult?.html, "<html>Project B</html>");

    await projectA.destroy();
    await projectB.destroy();
  });

  it("clearForProject spans every content source for the project", async () => {
    const data = new Map<string, CachePayload>();
    const store: CacheStore = {
      get: (key) => Promise.resolve(data.get(key)),
      set: (key, value) => {
        data.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        data.delete(key);
        return Promise.resolve();
      },
      deleteByPrefix: (prefix) => {
        let deleted = 0;
        for (const key of [...data.keys()]) {
          if (!key.startsWith(prefix)) continue;
          data.delete(key);
          deleted++;
        }
        return Promise.resolve(deleted);
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const main = new CacheCoordinator({ store, projectId: "project:a", contentSourceId: "main" });
    const draft = new CacheCoordinator({
      store,
      projectId: "project:a",
      contentSourceId: "draft:feature",
    });
    const other = new CacheCoordinator({ store, projectId: "project:b", contentSourceId: "main" });
    await main.persistResult(makeResult("main"), "home");
    await draft.persistResult(makeResult("draft"), "home");
    await other.persistResult(makeResult("other"), "home");

    await main.clearForProject();

    assertEquals((await main.checkCache("home")).cacheStatus, "miss");
    assertEquals((await draft.checkCache("home")).cacheStatus, "miss");
    assertEquals((await other.checkCache("home")).cachedResult?.html, "other");
  });

  it("clearSlug observes a delimiter boundary", async () => {
    const coordinator = new CacheCoordinator({ projectId: "project", contentSourceId: "main" });
    await coordinator.persistResult(makeResult("a"), "a");
    await coordinator.persistResult(makeResult("about"), "about");

    await coordinator.clearSlug("a");

    assertEquals((await coordinator.checkCache("a")).cacheStatus, "miss");
    assertEquals((await coordinator.checkCache("about")).cachedResult?.html, "about");
    await coordinator.destroy();
  });

  it("clearForProject never broadens unsupported scoped invalidation to clearAll", async () => {
    let clears = 0;
    const store: CacheStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      clear: () => {
        clears++;
        return Promise.resolve();
      },
      destroy: () => Promise.resolve(),
    };

    const withoutProject = new CacheCoordinator({ store });
    await assertRejects(
      () => withoutProject.clearForProject(),
      TypeError,
      "requires a projectId",
    );

    const withoutPrefixDeletion = new CacheCoordinator({ store, projectId: "project" });
    await assertRejects(
      () => withoutPrefixDeletion.clearForProject(),
      TypeError,
      "project-scoped invalidation",
    );
    assertEquals(clears, 0);
  });
});
