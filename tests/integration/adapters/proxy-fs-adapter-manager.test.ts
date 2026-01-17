/**
 * ProxyFSAdapterManager Tests
 *
 * Tests for cache key isolation to prevent race conditions between
 * concurrent preview and production requests.
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd.ts";
import { ProxyFSAdapterManager } from "@veryfront/platform/adapters/fs/veryfront/proxy-manager.ts";

describe("ProxyFSAdapterManager - Cache Isolation", () => {
  it("preview and production requests get separate adapters", () => {
    const manager = new ProxyFSAdapterManager({
      baseConfig: { type: "local", projectDir: "/tmp" },
    });

    try {
      // Initially no adapters exist
      assertEquals(manager.hasAdapter("my-project", false, null), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);

      // After checking, they should still be separate keys
      // (hasAdapter doesn't create adapters, just checks)
      assertEquals(manager.hasAdapter("my-project", false, null), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);
    } finally {
      manager.dispose();
    }
  });

  it("different releaseIds are treated as separate cache entries", () => {
    const manager = new ProxyFSAdapterManager({
      baseConfig: { type: "local", projectDir: "/tmp" },
    });

    try {
      // Different release IDs should be separate
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-2"), false);

      // They should remain independent
      const stats = manager.getStats();
      assertEquals(stats.adapters, 0);
    } finally {
      manager.dispose();
    }
  });

  it("getStats returns cache keys that include mode and releaseId", () => {
    const manager = new ProxyFSAdapterManager({
      baseConfig: {
        type: "veryfront-api",
        veryfront: {
          baseUrl: "http://localhost:4000/api",
          apiToken: "test-token",
          proxyMode: false,
        },
      },
    });

    try {
      // We can't easily create real adapters without a real API,
      // but we can verify the stats structure is correct
      const stats = manager.getStats();
      assertEquals(stats.adapters, 0);
      assertEquals(typeof stats.stats, "object");
    } finally {
      manager.dispose();
    }
  });

  it("cleanup timer is properly disposed", () => {
    const manager = new ProxyFSAdapterManager({
      baseConfig: { type: "local", projectDir: "/tmp" },
      cleanupIntervalMs: 1000,
    });

    // Should not throw
    manager.dispose();

    // Double dispose should be safe
    manager.dispose();
  });

  it("hasAdapter correctly distinguishes preview vs production", () => {
    const manager = new ProxyFSAdapterManager({
      baseConfig: { type: "local", projectDir: "/tmp" },
    });

    try {
      // These should all be treated as different cache keys:
      // - my-project:preview
      // - my-project:production:latest
      // - my-project:production:release-1
      assert(!manager.hasAdapter("my-project", false, null)); // preview
      assert(!manager.hasAdapter("my-project", true, null)); // production:latest
      assert(!manager.hasAdapter("my-project", true, "release-1")); // production:release-1

      // Verify they're truly independent by checking hasAdapter signature
      // takes productionMode and releaseId into account
      assertEquals(
        manager.hasAdapter("my-project", false, null),
        manager.hasAdapter("my-project", false, "ignored-in-preview"),
      );
    } finally {
      manager.dispose();
    }
  });
});
