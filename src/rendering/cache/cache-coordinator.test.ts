import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import { withTimeoutThrow } from "../utils/stream-utils.ts";
import { CacheCoordinator } from "./cache-coordinator.ts";
import { wrapInHTMLShell } from "#veryfront/html/html-shell-generator.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
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

function setFrontmatter(result: RenderResult, value: unknown): void {
  result.frontmatter = value as RenderResult["frontmatter"];
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
    for (
      const ttlMs of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_CACHE_TTL_MILLISECONDS + 1,
      ]
    ) {
      assertThrows(() => new CacheCoordinator({ ttlMs }), RangeError, "ttlMs");
    }
    for (
      const staleMs of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_CACHE_TTL_MILLISECONDS + 1,
      ]
    ) {
      assertThrows(() => new CacheCoordinator({ staleMs }), RangeError, "staleMs");
    }
  });

  it("rounds fractional TTL and stale windows up to whole milliseconds", async () => {
    let stored: CachePayload | undefined;
    const store: CacheStore = {
      get: () => Promise.resolve(stored),
      set: (_key, value) => {
        stored = value;
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({
      store,
      projectId: "fractional",
      ttlMs: 1_000.25,
      staleMs: 500.25,
    });

    await coordinator.persistResult(makeResult("fractional"), "entry");

    assertEquals(stored?.expiresAt, (stored?.storedAt ?? 0) + 1_001);
    assertEquals(stored?.staleUntil, (stored?.expiresAt ?? 0) + 501);
  });

  it("persists custom response headers in lifecycle cache payloads", async () => {
    let stored: CachePayload | undefined;
    const store: CacheStore = {
      get: () => Promise.resolve(stored),
      set: (_key, value) => {
        stored = value;
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "headers" });
    const result = makeResult("header result");
    result.headers = { "x-page-state": "cached" };

    await coordinator.persistResult(result, "entry");

    assertEquals(stored?.result.headers, { "x-page-state": "cached" });
    assertEquals((await coordinator.checkCache("entry")).cachedResult?.headers, {
      "x-page-state": "cached",
    });
  });

  it("evicts malformed store values and treats them as misses", async () => {
    let deletedKey: string | undefined;
    const store: CacheStore = {
      get: () => Promise.resolve({} as CachePayload),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: (key) => {
        deletedKey = key;
        return Promise.resolve(true);
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

  it("treats malformed store values as misses when eviction fails", async () => {
    const evictionAttempted = Promise.withResolvers<void>();
    const store: CacheStore = {
      get: () => Promise.resolve({} as CachePayload),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: () => {
        evictionAttempted.resolve();
        return Promise.reject(new Error("delete unavailable"));
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "project" });

    const lookup = await coordinator.checkCache("malformed");

    assertEquals(lookup.cacheStatus, "miss");
    assertEquals(lookup.cachedResult, undefined);
    await withTimeoutThrow(evictionAttempted.promise, 1_000, "cache eviction attempt");
  });

  it("does not block on a hung eviction or delete a replacement", async () => {
    const malformed = {} as CachePayload;
    const replacement: CachePayload = {
      result: makeResult("replacement"),
      storedAt: 1,
    };
    let current: CachePayload | undefined = malformed;
    const evictionStarted = Promise.withResolvers<void>();
    const releaseEviction = Promise.withResolvers<void>();
    const evictionFinished = Promise.withResolvers<boolean>();
    const store: CacheStore = {
      get: () => Promise.resolve(current),
      set: (_key, value) => {
        current = value;
        return Promise.resolve();
      },
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: async (_key, expected) => {
        evictionStarted.resolve();
        await releaseEviction.promise;
        if (current !== expected) {
          evictionFinished.resolve(false);
          return false;
        }
        current = undefined;
        evictionFinished.resolve(true);
        return true;
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "project" });

    const lookup = await withTimeoutThrow(
      coordinator.checkCache("malformed"),
      1_000,
      "non-blocking corrupt-cache lookup",
    );
    await withTimeoutThrow(evictionStarted.promise, 1_000, "cache eviction start");
    current = replacement;
    releaseEviction.resolve();

    assertEquals(lookup.cacheStatus, "miss");
    assertEquals(
      await withTimeoutThrow(evictionFinished.promise, 1_000, "cache eviction completion"),
      false,
    );
    assertEquals(current, replacement);
  });

  it("deduplicates hung evictions without delaying cache misses", async () => {
    let evictionCalls = 0;
    const store: CacheStore = {
      get: () => Promise.resolve({} as CachePayload),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: () => {
        evictionCalls++;
        return new Promise<boolean>(() => {});
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "project" });

    for (let attempt = 0; attempt < 3; attempt++) {
      assertEquals(
        (await withTimeoutThrow(
          coordinator.checkCache("malformed"),
          1_000,
          "deduplicated corrupt-cache lookup",
        )).cacheStatus,
        "miss",
      );
    }

    assertEquals(evictionCalls, 1);
  });

  it("bounds distinct hung evictions", async () => {
    let evictionCalls = 0;
    const capacityReached = Promise.withResolvers<void>();
    const store: CacheStore = {
      get: () => Promise.resolve({} as CachePayload),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: () => {
        evictionCalls++;
        if (evictionCalls === 128) capacityReached.resolve();
        return new Promise<boolean>(() => {});
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "project" });

    const lookups = await withTimeoutThrow(
      Promise.all(
        Array.from(
          { length: 129 },
          (_, index) => coordinator.checkCache(`malformed-${index}`),
        ),
      ),
      1_000,
      "bounded corrupt-cache lookups",
    );
    await withTimeoutThrow(capacityReached.promise, 1_000, "eviction capacity");

    assertEquals(lookups.every((lookup) => lookup.cacheStatus === "miss"), true);
    assertEquals(evictionCalls, 128);
  });

  it("skips caching when a result cannot be snapshotted", async () => {
    let setCalls = 0;
    const data = new Map<string, CachePayload>();
    const store: CacheStore = {
      get: (key) => Promise.resolve(data.get(key)),
      set: (key, value) => {
        setCalls++;
        data.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        data.delete(key);
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "bounds" });

    // Nest past MAX_CACHE_VALUE_DEPTH so the snapshot fails its bounds check.
    const root: Record<string, unknown> = {};
    let branch = root;
    for (let depth = 0; depth < 80; depth++) {
      const next: Record<string, unknown> = {};
      branch.child = next;
      branch = next;
    }
    const result = makeResult("<html>too deep</html>");
    setFrontmatter(result, root);

    await coordinator.persistResult(result, "too-deep");

    assertEquals(setCalls, 0);
    assertEquals((await coordinator.checkCache("too-deep")).cacheStatus, "miss");
  });

  it("keeps rendering when the cache store rejects a write", async () => {
    const store: CacheStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error("store unavailable")),
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "unavailable" });

    await coordinator.persistResult(makeResult("<html>ok</html>"), "written");

    assertEquals((await coordinator.checkCache("written")).cacheStatus, "miss");
  });

  it("keeps rendering when a cache failure cannot be stringified", async () => {
    const hostileFailure = {
      toString(): string {
        throw new Error("stringification trap");
      },
    };
    const store: CacheStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(hostileFailure),
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "hostile" });

    await coordinator.persistResult(makeResult("<html>ok</html>"), "written");
  });

  it("contains a revoked-proxy eviction failure", async () => {
    const attempted = Promise.withResolvers<void>();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const store: CacheStore = {
      get: () => Promise.resolve({} as CachePayload),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: () => {
        attempted.resolve();
        return Promise.reject(revoked.proxy);
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "hostile-eviction" });

    const lookup = await coordinator.checkCache("malformed");
    await withTimeoutThrow(attempted.promise, 1_000, "revoked-proxy eviction attempt");
    await delay(0);

    assertEquals(lookup.cacheStatus, "miss");
  });

  it("preserves Date frontmatter across a serializing store round-trip", async () => {
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
    setFrontmatter(result, {
      date: publicationDate,
      metadata: {
        revisedAt: new Date("2026-07-25T09:45:00.000Z"),
      },
    });

    await coordinator.persistResult(result, "dated");
    const lookup = await coordinator.checkCache("dated");

    assertEquals(lookup.cacheStatus, "hit");
    assertEquals(lookup.cachedResult?.frontmatter as unknown, {
      date: new Date("2026-07-24T08:30:00.000Z"),
      metadata: {
        revisedAt: new Date("2026-07-25T09:45:00.000Z"),
      },
    });
    assertEquals((lookup.cachedResult?.frontmatter.date as unknown) === publicationDate, false);
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

  it("binds cached framework inline tags to each response nonce", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 10_000 });
    const html = '<script nonce="nonce-a">framework()</script>' +
      '<style nonce="nonce-a">.framework{}</style>' +
      '<script nonce="app-owned">application()</script>';

    await coordinator.persistResult(makeResult(html), "nonce-page", undefined, "nonce-a");
    const hit = await coordinator.checkCache("nonce-page", undefined, "nonce-b");

    assertEquals(hit.cachedResult?.html.includes('nonce="nonce-b">framework()'), true);
    assertEquals(hit.cachedResult?.html.includes('nonce="nonce-b">.framework{}'), true);
    assertEquals(hit.cachedResult?.html.includes('nonce="app-owned">application()'), true);
    assertEquals(hit.cachedResult?.html.includes("nonce-a"), false);
    assertEquals(hit.cachedResult?.html.includes("veryfront-cache-nonce"), false);
    await coordinator.destroy();
  });

  it("rebinds the real production hydration module without blessing app scripts", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 10_000 });
    const shell = await wrapInHTMLShell(
      '<script src="/app-owned.js" nonce="nonce-a"></script><main>cached</main>',
      { title: "Cached", slug: "cached", frontmatter: {} },
      {
        mode: "production",
        environment: "production",
        isLocalProject: false,
        forceProductionScripts: true,
        projectSlug: "default",
        config: {},
        nonce: "nonce-a",
      },
    );

    await coordinator.persistResult(makeResult(shell), "production-shell", undefined, "nonce-a");
    const hit = await coordinator.checkCache("production-shell", undefined, "nonce-b");
    const cachedHtml = hit.cachedResult?.html ?? "";

    assertEquals(
      cachedHtml.includes(
        `src="${getProdHydrationModulePath()}" nonce="nonce-b"`,
      ),
      true,
    );
    assertEquals(
      cachedHtml.includes('src="/app-owned.js" nonce="nonce-a"'),
      true,
    );
    assertEquals(cachedHtml.includes("veryfront-cache-nonce"), false);
    await coordinator.destroy();
  });

  it("rejects an unsealed legacy entry for a nonce-protected response", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 10_000 });
    await coordinator.persistResult(
      makeResult('<script nonce="stale">framework()</script>'),
      "legacy-nonce-page",
    );

    const lookup = await coordinator.checkCache(
      "legacy-nonce-page",
      undefined,
      "response-nonce",
    );
    assertEquals(lookup.cacheStatus, "miss");
    assertEquals(lookup.cachedResult, undefined);
    await coordinator.destroy();
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

  it("preserves the public zero-TTL non-expiring contract", async () => {
    const coordinator = new CacheCoordinator({
      ttlMs: 0,
      staleMs: 500,
      projectId: "non-expiring",
    });

    await coordinator.persistResult(makeResult("still fresh"), "zero-ttl");
    const lookup = await coordinator.checkCache("zero-ttl");

    assertEquals(lookup.cachedResult?.html, "still fresh");
    assertEquals(lookup.cacheStatus, "hit");
    await coordinator.destroy();
  });

  it("reports an expired entry when eviction fails", async () => {
    const evictionAttempted = Promise.withResolvers<void>();
    const payload: CachePayload = {
      result: makeResult("expired"),
      storedAt: 0,
      expiresAt: 0,
    };
    const store: CacheStore = {
      get: () => Promise.resolve(payload),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("unsafe unconditional delete")),
      deleteIfUnchanged: () => {
        evictionAttempted.resolve();
        return Promise.reject(new Error("delete unavailable"));
      },
      clear: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    };
    const coordinator = new CacheCoordinator({ store, projectId: "expired" });

    const lookup = await coordinator.checkCache("entry");

    assertEquals(lookup.cachedResult, undefined);
    assertEquals(lookup.cacheStatus, "expired");
    await withTimeoutThrow(evictionAttempted.promise, 1_000, "expired cache eviction attempt");
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
    // Both coordinators share one store so a cross-tenant wipe is observable.
    const entries = new Map<string, CachePayload>();
    const deletedPrefixes: string[] = [];
    let clearCalls = 0;
    const store: CacheStore = {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => {
        entries.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        entries.delete(key);
        return Promise.resolve();
      },
      deleteByPrefix: (prefix) => {
        deletedPrefixes.push(prefix);
        let deleted = 0;
        for (const key of [...entries.keys()]) {
          if (key.startsWith(prefix)) {
            entries.delete(key);
            deleted += 1;
          }
        }
        return Promise.resolve(deleted);
      },
      clear: () => {
        clearCalls += 1;
        entries.clear();
        return Promise.resolve();
      },
      destroy: () => Promise.resolve(),
    };
    const projectA = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "project-a",
      contentSourceId: "main",
      store,
    });
    const projectB = new CacheCoordinator({
      ttlMs: 10_000,
      projectId: "project-b",
      contentSourceId: "main",
      store,
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

    assertEquals(
      deletedPrefixes,
      ["project-a:main:"],
      "clearForProject must delete only the current project prefix",
    );
    assertEquals(
      clearCalls,
      0,
      "clearForProject must not fall back to clearAll when a projectId and deleteByPrefix exist",
    );
    assertEquals(lookupA.cachedResult, undefined, "project A entry is cleared");
    assertEquals(
      lookupB.cachedResult?.html,
      "<html>Project B</html>",
      "project B entry survives a project A clear in the same store",
    );

    await projectA.destroy();
    await projectB.destroy();
  });
});
