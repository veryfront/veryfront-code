import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { isImmutableReleaseFileCacheKey } from "../../immutable-l1.ts";
import { isValidCacheKey } from "../api-policy.ts";
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

it("classifies named versioned environment sources as production", () => {
  const key = `${
    buildFileCacheKeyPrefix({
      sourceType: "environment",
      projectSlug: "test-project",
      environmentName: "Staging",
      releaseId: "release/1",
    })
  }:app/page.tsx`;
  assertEquals(key.startsWith("file:env-v2:"), true);
  assertEquals(isKeyForProjectEnvironment(key, "test-project", "production"), true);
  assertEquals(isKeyForProjectEnvironment(key, "test-project", "preview"), false);
  const map = new Map([[key, 1]]);
  cacheRegistry.register(new MapCacheStore("named-environment", map));
  try {
    cacheRegistry.deleteKeysForProjectEnvironment("test-project", "production");
    assertEquals(map.size, 0);
  } finally {
    cacheRegistry.unregister("named-environment");
  }
});
