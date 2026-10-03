import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { isImmutableReleaseFileCacheKey } from "../../immutable-l1.ts";
import { ApiCacheBackend } from "../../backends/api.ts";
import { isValidCacheKey, isValidCachePattern } from "../api-policy.ts";
import {
  cacheRegistry,
  extractProjectIdFromKey,
  isKeyForProject,
  isKeyForProjectEnvironment,
  MapCacheStore,
} from "../../registry.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildStatCacheKeyPrefix,
} from "./file.ts";

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

it("keeps exact ownership and source filtering for API-safe operation keys", () => {
  for (const build of builders) {
    const ownKey = `${build(context)}:app/page.tsx`;
    const otherBranch = `${build({ ...context, branch: "feature%2Ffoo" })}:app/page.tsx`;
    const otherProject = `${build({ ...context, projectSlug: "other-project" })}:app/page.tsx`;
    assertNotEquals(ownKey, otherBranch);
    assertEquals(isKeyForProject(ownKey, context.projectSlug), true);
    assertEquals(isKeyForProject(ownKey, "other-project"), false);
    assertEquals(isKeyForProjectEnvironment(ownKey, context.projectSlug, "preview"), true);
    const map = new Map([[ownKey, 1], [otherBranch, 2], [otherProject, 3]]);
    const registry = cacheRegistry;
    registry.register(new MapCacheStore("operation", map));
    assertEquals(registry.deleteKeysForContentSource(context.projectSlug, context.branch), 1);
    assertEquals([...map.keys()], [otherBranch, otherProject]);
    registry.unregister("operation");
  }
});

it("decodes encoded project, release and environment ownership without widening filters", () => {
  for (
    const source of [
      { sourceType: "branch" as const, branch: "feature:foo" },
      { sourceType: "release" as const, releaseId: "release/foo" },
      {
        sourceType: "environment" as const,
        environmentName: "production",
        releaseId: "release/foo",
      },
    ]
  ) {
    for (const build of builders) {
      const projectSlug = "project:one";
      const key = `${build({ ...source, projectSlug })}:app/page.tsx`;
      assertEquals(isValidCacheKey(key), true);
      assertEquals(extractProjectIdFromKey(key), projectSlug);
      assertEquals(isKeyForProject(`veryfront:file-cache:${key}`, projectSlug), true);
      assertEquals(isKeyForProject(key, "branch-v2"), false);
      assertEquals(isKeyForProject(key, key.split(":")[2]!), false);
      assertEquals(
        isKeyForProjectEnvironment(
          key,
          projectSlug,
          source.sourceType === "branch" ? "preview" : "production",
        ),
        true,
      );
      const map = new Map([[key, 1]]);
      cacheRegistry.register(new MapCacheStore("encoded-ownership", map));
      try {
        const sourceId = source.sourceType === "branch" ? source.branch : source.releaseId;
        assertEquals(cacheRegistry.deleteKeysForContentSource(projectSlug, sourceId), 1);
      } finally {
        cacheRegistry.unregister("encoded-ownership");
      }
      if (source.sourceType === "release" && build === buildFileCacheKeyPrefix) {
        assertEquals(isImmutableReleaseFileCacheKey(key), true);
      }
    }
  }
  for (
    const key of [
      "file:branch-v2:project:main:path",
      "stat:env-v2:ImFjbWUi:InByb2R1Y3Rpb24i:invalid:path",
    ]
  ) {
    assertEquals(isKeyForProject(key, "project"), false);
    assertEquals(isKeyForProject(key, "acme"), false);
    assertEquals(extractProjectIdFromKey(key), null);
  }
});
