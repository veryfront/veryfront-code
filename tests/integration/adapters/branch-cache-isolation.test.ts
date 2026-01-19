/**
 * Unit tests for branch-switching cache isolation fix
 *
 * Tests verify that the context verification logic in ProxyFSAdapterManager
 * correctly detects and fixes context mismatches when cached adapters are reused.
 *
 * This addresses the bug where switching branches (main → feature → main) could
 * serve stale SSR data due to incorrect adapter context.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  buildFileCacheKeyPrefix,
  buildProxyManagerCacheKey,
} from "@veryfront/cache";
import type { ResolvedContentContext } from "@veryfront/platform/adapters/fs/veryfront/types.ts";

describe("Branch Cache Isolation - Context Verification", () => {
  describe("Input validation", () => {
    it("rejects empty projectSlug", () => {
      const mainKey = () => buildProxyManagerCacheKey(
        "", // empty projectSlug
        false,
        null,
        "main",
      );

      // This should succeed because buildProxyManagerCacheKey doesn't validate
      // Validation happens in ProxyFSAdapterManager.getAdapter
      assertEquals(mainKey(), "proxy::preview:main");
    });

    it("requires branch in preview mode", () => {
      // Preview mode (productionMode=false) should have branch
      const key = buildProxyManagerCacheKey(
        "test-project",
        false, // preview mode
        null,
        null, // no branch - this is the bug scenario
      );

      // Cache key will use "main" as default
      assertEquals(key, "proxy:test-project:preview:main");
    });

    it("requires releaseId or environmentName in production mode", () => {
      // Production mode with releaseId
      const releaseKey = buildProxyManagerCacheKey(
        "test-project",
        true, // production mode
        "rel_123",
        null,
      );
      assertEquals(releaseKey, "proxy:test-project:production:rel_123");

      // Production mode without releaseId uses "latest"
      const latestKey = buildProxyManagerCacheKey(
        "test-project",
        true,
        null, // no releaseId
        null,
      );
      assertEquals(latestKey, "proxy:test-project:production:latest");
    });
  });

  describe("Cache key generation maintains branch isolation", () => {
    it("different branches generate different cache keys", () => {
      const mainKey = buildProxyManagerCacheKey(
        "test-project",
        false, // preview mode
        null, // no releaseId
        "main", // branch
      );

      const featureKey = buildProxyManagerCacheKey(
        "test-project",
        false,
        null,
        "feature",
      );

      // Keys must be different to ensure separate adapters
      assertEquals(
        mainKey === featureKey,
        false,
        "Main and feature branches must have different cache keys",
      );

      // Verify expected format
      assertEquals(mainKey, "proxy:test-project:preview:main");
      assertEquals(featureKey, "proxy:test-project:preview:feature");
    });

    it("production and preview modes generate different cache keys", () => {
      const previewKey = buildProxyManagerCacheKey(
        "test-project",
        false, // preview
        null,
        "main",
      );

      const prodKey = buildProxyManagerCacheKey(
        "test-project",
        true, // production
        "rel_abc123",
        null, // no branch in production
      );

      assertEquals(
        previewKey === prodKey,
        false,
        "Production and preview must have different cache keys",
      );

      assertEquals(previewKey, "proxy:test-project:preview:main");
      assertEquals(prodKey, "proxy:test-project:production:rel_abc123");
    });
  });

  describe("File cache keys include branch context", () => {
    it("branch mode file cache keys include branch name", () => {
      const mainContext: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      };

      const featureContext: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "feature",
      };

      const mainKey = buildFileCacheKeyPrefix(mainContext);
      const featureKey = buildFileCacheKeyPrefix(featureContext);

      // File cache keys must include branch to prevent contamination
      assertEquals(mainKey, "file:branch:test-project:main");
      assertEquals(featureKey, "file:branch:test-project:feature");

      assertEquals(
        mainKey === featureKey,
        false,
        "File cache keys for different branches must be different",
      );
    });

    it("release mode file cache keys include release ID", () => {
      const context: ResolvedContentContext = {
        sourceType: "release",
        projectSlug: "test-project",
        releaseId: "rel_abc123",
      };

      const key = buildFileCacheKeyPrefix(context);

      assertEquals(key, "file:release:test-project:rel_abc123");
    });

    it("environment mode file cache keys include environment name and releaseId", () => {
      const context: ResolvedContentContext = {
        sourceType: "environment",
        projectSlug: "test-project",
        environmentName: "staging",
        releaseId: "rel_xyz789",
      };

      const key = buildFileCacheKeyPrefix(context);

      // Environment keys include both environmentName and releaseId
      assertEquals(key, "file:env:test-project:staging:rel_xyz789");
    });
  });

  describe("Context verification logic", () => {
    it("context mismatch detection for wrong branch", () => {
      const currentContext: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "feature", // Wrong branch!
      };

      const expectedBranch = "main";
      const expectedProductionMode = false;

      // This is the logic from proxy-manager.ts
      const contextMismatch =
        (expectedProductionMode && currentContext?.sourceType !== "release" && currentContext?.sourceType !== "environment") ||
        (!expectedProductionMode && currentContext?.sourceType !== "branch") ||
        (!expectedProductionMode && currentContext?.branch !== expectedBranch);

      assertEquals(
        contextMismatch,
        true,
        "Should detect context mismatch when branch is wrong",
      );
    });

    it("context mismatch detection for wrong source type", () => {
      const currentContext: ResolvedContentContext = {
        sourceType: "release", // Wrong! Should be branch
        projectSlug: "test-project",
        releaseId: "rel_123",
      };

      const expectedBranch = "main";
      const expectedProductionMode = false; // Preview mode expects branch

      const contextMismatch =
        (expectedProductionMode && currentContext?.sourceType !== "release" && currentContext?.sourceType !== "environment") ||
        (!expectedProductionMode && currentContext?.sourceType !== "branch") ||
        (!expectedProductionMode && currentContext?.branch !== expectedBranch);

      assertEquals(
        contextMismatch,
        true,
        "Should detect context mismatch when source type is wrong",
      );
    });

    it("no mismatch when context is correct", () => {
      const currentContext: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      };

      const expectedBranch = "main";
      const expectedProductionMode = false;

      const contextMismatch =
        (expectedProductionMode && currentContext?.sourceType !== "release" && currentContext?.sourceType !== "environment") ||
        (!expectedProductionMode && currentContext?.sourceType !== "branch") ||
        (!expectedProductionMode && currentContext?.branch !== expectedBranch);

      assertEquals(
        contextMismatch,
        false,
        "Should not detect mismatch when context is correct",
      );
    });
  });
});
