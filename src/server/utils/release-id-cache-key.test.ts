/**
 * Tests for release ID handling in cache key generation.
 *
 * Verifies that:
 * 1. Production cache keys include releaseId for proper cache invalidation
 * 2. Preview mode ignores releaseId (uses draft content)
 * 3. Domain lookup is triggered for veryfront.com domains in production mode
 */

import { assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { buildCacheKey } from "../../platform/adapters/proxy-fs-adapter-manager.ts";

describe("buildCacheKey", () => {
  describe("production mode", () => {
    it("includes releaseId in cache key when provided", () => {
      const key = buildCacheKey("my-project", true, "release-abc123");
      assertEquals(key, "my-project:production:release-abc123");
    });

    it("uses 'latest' when releaseId is null", () => {
      const key = buildCacheKey("my-project", true, null);
      assertEquals(key, "my-project:production:latest");
    });

    it("generates different keys for different releases", () => {
      const key1 = buildCacheKey("my-project", true, "release-v1");
      const key2 = buildCacheKey("my-project", true, "release-v2");

      assertEquals(key1, "my-project:production:release-v1");
      assertEquals(key2, "my-project:production:release-v2");
      // Keys must be different for cache invalidation to work
      assertEquals(key1 !== key2, true);
    });
  });

  describe("preview mode", () => {
    it("ignores releaseId in preview mode", () => {
      const keyWithRelease = buildCacheKey("my-project", false, "release-abc123");
      const keyWithoutRelease = buildCacheKey("my-project", false, null);

      assertEquals(keyWithRelease, "my-project:preview");
      assertEquals(keyWithoutRelease, "my-project:preview");
      // Preview keys should be the same regardless of releaseId
      assertEquals(keyWithRelease, keyWithoutRelease);
    });
  });
});

describe("domain lookup conditions", () => {
  /**
   * Simulates the condition logic from universal-handler/index.ts
   * to verify when domain lookup should be triggered.
   */
  function shouldLookupDomain(opts: {
    projectSlug: string | undefined;
    isVeryfrontDomain: boolean;
    proxyEnv: "preview" | "production" | undefined;
  }): { shouldLookup: boolean; reason: string } {
    const { projectSlug, isVeryfrontDomain, proxyEnv } = opts;

    const needsProjectSlug = !projectSlug && !isVeryfrontDomain;
    const needsReleaseId = proxyEnv === "production" && isVeryfrontDomain && !!projectSlug;

    if (needsProjectSlug) {
      return { shouldLookup: true, reason: "custom_domain" };
    }
    if (needsReleaseId) {
      return { shouldLookup: true, reason: "release_id_for_cache" };
    }
    return { shouldLookup: false, reason: "none" };
  }

  describe("veryfront.com subdomains", () => {
    it("triggers lookup in production mode to get releaseId", () => {
      const result = shouldLookupDomain({
        projectSlug: "my-project",
        isVeryfrontDomain: true,
        proxyEnv: "production",
      });

      assertEquals(result.shouldLookup, true);
      assertEquals(result.reason, "release_id_for_cache");
    });

    it("skips lookup in preview mode (uses draft content)", () => {
      const result = shouldLookupDomain({
        projectSlug: "my-project",
        isVeryfrontDomain: true,
        proxyEnv: "preview",
      });

      assertEquals(result.shouldLookup, false);
    });

    it("skips lookup when environment is undefined", () => {
      const result = shouldLookupDomain({
        projectSlug: "my-project",
        isVeryfrontDomain: true,
        proxyEnv: undefined,
      });

      assertEquals(result.shouldLookup, false);
    });
  });

  describe("custom domains", () => {
    it("triggers lookup to get projectSlug", () => {
      const result = shouldLookupDomain({
        projectSlug: undefined,
        isVeryfrontDomain: false,
        proxyEnv: "production",
      });

      assertEquals(result.shouldLookup, true);
      assertEquals(result.reason, "custom_domain");
    });

    it("triggers lookup regardless of environment", () => {
      const previewResult = shouldLookupDomain({
        projectSlug: undefined,
        isVeryfrontDomain: false,
        proxyEnv: "preview",
      });

      const productionResult = shouldLookupDomain({
        projectSlug: undefined,
        isVeryfrontDomain: false,
        proxyEnv: "production",
      });

      assertEquals(previewResult.shouldLookup, true);
      assertEquals(productionResult.shouldLookup, true);
    });
  });

  describe("internal/monitoring requests", () => {
    it("skips lookup when projectSlug is already known on custom domain", () => {
      // This can happen if slug was passed via proxy headers
      const result = shouldLookupDomain({
        projectSlug: "my-project",
        isVeryfrontDomain: false,
        proxyEnv: "production",
      });

      assertEquals(result.shouldLookup, false);
    });
  });
});
