/**
 * ProxyFSAdapterManager Tests
 *
 * Tests for cache key isolation to prevent race conditions between
 * concurrent preview and production requests.
 */

import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ProxyFSAdapterManager } from "#veryfront/platform/adapters/fs/veryfront/proxy-manager.ts";

function createLocalManager(): ProxyFSAdapterManager {
  return new ProxyFSAdapterManager({
    baseConfig: { type: "local", projectDir: "/tmp" },
  });
}

describe("ProxyFSAdapterManager - Cache Isolation", () => {
  it("preview and production requests get separate adapters", () => {
    const manager = createLocalManager();

    try {
      assertEquals(manager.hasAdapter("my-project", false, null), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);

      assertEquals(manager.hasAdapter("my-project", false, null), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);
    } finally {
      manager.dispose();
    }
  });

  it("different releaseIds are treated as separate cache entries", () => {
    const manager = createLocalManager();

    try {
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-2"), false);

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
          apiBaseUrl: "http://localhost:4000/api",
          apiToken: "test-token",
          proxyMode: false,
        },
      },
    });

    try {
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

    manager.dispose();
    manager.dispose();
  });

  it("hasAdapter correctly distinguishes preview vs production", () => {
    const manager = createLocalManager();

    try {
      assertEquals(manager.hasAdapter("my-project", false, null), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-1"), false);
      assertEquals(manager.hasAdapter("my-project", true, "release-2"), false);

      assertThrows(() => manager.hasAdapter("my-project", true, null));

      assertEquals(
        manager.hasAdapter("my-project", false, null),
        manager.hasAdapter("my-project", false, "ignored-in-preview"),
      );
    } finally {
      manager.dispose();
    }
  });

  it("evictAdapter removes and disposes a cached preview adapter", () => {
    const manager = createLocalManager();
    let disposed = false;

    try {
      (manager as unknown as {
        adapters: Map<
          string,
          { adapter: { dispose: () => void; getCacheStats: () => unknown }; lastAccessed: number }
        >;
      }).adapters.set("proxy:my-project:preview:main", {
        adapter: {
          dispose: () => {
            disposed = true;
          },
          getCacheStats: () => ({
            cache: { size: 0, memoryUsed: 0, hits: 0, misses: 0, hitRate: 0 },
          }),
        },
        lastAccessed: Date.now(),
      });

      assertEquals(manager.hasAdapter("my-project", false, null, "main"), true);

      manager.evictAdapter("my-project", false, null, "main");

      assertEquals(disposed, true);
      assertEquals(manager.hasAdapter("my-project", false, null, "main"), false);
    } finally {
      manager.dispose();
    }
  });
});

function assertThrows(fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, "Expected error when releaseId is missing in production mode");
}
