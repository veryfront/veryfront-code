import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { persistResolvedModule } from "./persistence.ts";
import type { MdxPrimaryPublicationPermit } from "./distributed-cache.ts";

const noopLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  time: (_label, fn) => fn(),
  child: () => noopLog,
  component: () => noopLog,
};

describe("module-fetcher/persistence", () => {
  it("passes the exact opaque permit and manifest authority to the distributed writer", async () => {
    const calls: string[] = [];
    const pathCache = new Map<string, string>();
    const publicationPermit = Object.freeze({}) as MdxPrimaryPublicationPermit;
    const bundleManifestAuthority = Object.freeze({
      manifestId: "b".repeat(64),
      bundleHashes: Object.freeze(["bbb222"]),
    });

    const result = await persistResolvedModule({
      normalizedPath: "_vf_modules/app/page.js",
      moduleCode: "export default 1;",
      esmCacheDir: "/cache",
      pathCache,
      log: noopLog,
      projectSlug: "docs",
      reactVersion: "19.1.1",
      sourceContentHash: "source-hash",
      importMapFingerprint: "a".repeat(64),
      dependencyPinningCacheKey: "on:pins",
      moduleServerOrigin: "https://preview.example",
      distributedCachePublication: {
        publicationPermit,
        projectId: "project-1",
        contentSourceId: "preview-main",
        bundleManifestAuthority,
      },
      writeToDistributedCache: (
        receivedPermit,
        projectId,
        contentSourceId,
        moduleCode,
        receivedManifestAuthority,
        normalizedPath,
      ) => {
        calls.push("distributed");
        assertStrictEquals(receivedPermit, publicationPermit);
        assertEquals(projectId, "project-1");
        assertEquals(contentSourceId, "preview-main");
        assertEquals(moduleCode, "export default 1;");
        assertStrictEquals(receivedManifestAuthority, bundleManifestAuthority);
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
        return Promise.resolve();
      },
      cacheLocalModule: (
        normalizedPath,
        moduleCode,
        esmCacheDir,
        receivedPathCache,
        _log,
        reactVersion,
        sourceContentHash,
        importMapFingerprint,
        dependencyPinningCacheKey,
        moduleServerOrigin,
      ) => {
        calls.push("local");
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
        assertEquals(moduleCode, "export default 1;");
        assertEquals(esmCacheDir, "/cache");
        assertEquals(receivedPathCache, pathCache);
        assertEquals(reactVersion, "19.1.1");
        assertEquals(sourceContentHash, "source-hash");
        assertEquals(importMapFingerprint, "a".repeat(64));
        assertEquals(dependencyPinningCacheKey, "on:pins");
        assertEquals(moduleServerOrigin, "https://preview.example");
        return Promise.resolve("/cache/page.mjs");
      },
    });

    assertEquals(calls, ["distributed", "local"]);
    assertEquals(result, "/cache/page.mjs");
  });
});
