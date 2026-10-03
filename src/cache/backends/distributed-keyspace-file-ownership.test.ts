import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { getOwnedDistributedCacheNamespaceDescriptors } from "./distributed-keyspace.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildStatCacheKeyPrefix,
  scopeFileOperationCacheKeyPrefix,
} from "../keys/builders/file.ts";

function defaultOwnership(key: string) {
  const descriptor = getOwnedDistributedCacheNamespaceDescriptors().find(({ prefix }) =>
    prefix === "vf:cache:default:"
  );
  return descriptor?.matchProjectOwnership?.(key) ?? null;
}

it("owns versioned file, stat and directory keys by their decoded project", () => {
  const sources = [
    { context: { sourceType: "branch" as const, branch: "feature/foo" }, env: "preview" as const },
    {
      context: { sourceType: "release" as const, releaseId: "release/1" },
      env: "production" as const,
    },
    {
      context: {
        sourceType: "environment" as const,
        environmentName: "Staging",
        releaseId: "release/1",
      },
      env: "production" as const,
    },
  ];
  for (const build of [buildFileCacheKeyPrefix, buildStatCacheKeyPrefix, buildDirCacheKeyPrefix]) {
    for (const { context, env } of sources) {
      const prefix = build({ ...context, projectSlug: "project:one" });
      assertEquals(prefix.split(":")[1]?.endsWith("-v2"), true, prefix);
      const key = `${scopeFileOperationCacheKeyPrefix(prefix, "authority:abc")}:app/page.tsx`;
      assertEquals(defaultOwnership(key), { projectSlug: "project:one", environment: env });
    }
  }
});

it("keeps legacy ownership and refuses malformed versioned segments", () => {
  assertEquals(defaultOwnership("file:branch:acme:main:app/page.tsx"), {
    projectSlug: "acme",
    environment: "preview",
  });
  assertEquals(defaultOwnership("files:release:acme:rel-1"), {
    projectSlug: "acme",
    environment: "production",
  });
  assertEquals(defaultOwnership("file:branch-v2:not%base64:IngiIg:app/page.tsx"), null);
  assertEquals(defaultOwnership("stat:env-v2:ImFjbWUi:InByb2R1Y3Rpb24i:invalid:path"), null);
});
