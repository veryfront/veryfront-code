import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { ApiCacheBackend } from "#veryfront/cache/backends/api.ts";
import { isValidCacheKey, isValidCachePattern } from "#veryfront/cache/keys/api-policy.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildStatCacheKeyPrefix,
} from "#veryfront/cache/keys/builders/file.ts";

const builders = [buildFileCacheKeyPrefix, buildStatCacheKeyPrefix, buildDirCacheKeyPrefix];
const context = {
  sourceType: "branch" as const,
  projectSlug: "test-project",
  branch: "feature/foo",
};

it("removes slash-branch file, stat and directory entries through the real API backend", async () => {
  const entries = new Map<string, string>();
  const patterns: string[] = [];
  const mock: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(observeFetchRequestInit(init).body ?? "{}"));
    if (url.pathname.endsWith("/set")) {
      assertEquals(isValidCacheKey(body.key), true);
      entries.set(body.key, body.value);
      return Promise.resolve(Response.json({ success: true }));
    }
    if (url.pathname.endsWith("/get")) {
      return Promise.resolve(
        Response.json({ value: entries.get(url.searchParams.get("key")!) ?? null }),
      );
    }
    assertEquals(url.pathname.endsWith("/del-pattern"), true);
    assertEquals(isValidCachePattern(body.pattern), true);
    patterns.push(body.pattern);
    const prefix = body.pattern.slice(0, -1);
    let deleted = 0;
    for (const key of entries.keys()) {
      if (key.startsWith(prefix)) {
        entries.delete(key);
        deleted++;
      }
    }
    return Promise.resolve(Response.json({ deleted }));
  };
  await withMockFetch(mock, () =>
    runWithRequestContext({
      projectSlug: context.projectSlug,
      token: "test-token",
      productionMode: false,
      releaseId: null,
      branch: context.branch,
      environmentName: null,
    }, async () => {
      const backend = new ApiCacheBackend({
        apiBaseUrl: "https://cache.example.test",
        apiToken: "test-token",
        circuitBreakerName: "slash-source-regression",
      });
      for (const build of builders) {
        const prefix = build(context);
        const key = `${prefix}:app/page.tsx`;
        const otherKey = `${build({ ...context, branch: "feature/foobar" })}:app/page.tsx`;
        await backend.set(key, "stale");
        await backend.set(otherKey, "other");
        assertEquals(await backend.get(key), "stale");
        assertEquals(
          entries.get(key),
          "stale",
          "the API must store the entry under its source namespace",
        );
        assertEquals(await backend.delByPattern(`${prefix}:*`), 1);
        assertEquals(await backend.get(key), null);
        assertEquals(await backend.get(otherKey), "other");
      }
      assertEquals(patterns.length, 3, "all invalidations must reach HTTP rather than be refused");
    }));
});
