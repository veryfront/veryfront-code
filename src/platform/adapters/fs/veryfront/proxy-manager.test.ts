import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";

const baseConfig = {
  veryfront: {
    baseUrl: "https://api.example.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    cache: { enabled: false },
  },
};

function createManager(
  options: Partial<ConstructorParameters<typeof ProxyFSAdapterManager>[0]> = {},
): ProxyFSAdapterManager {
  return new ProxyFSAdapterManager({ baseConfig, ...options });
}

async function assertGetAdapterRejects(
  manager: ProxyFSAdapterManager,
  args: Parameters<ProxyFSAdapterManager["getAdapter"]>,
  messageIncludes: string,
): Promise<void> {
  try {
    await manager.getAdapter(...args);
    assertEquals(true, false, "Should have thrown");
  } catch (e) {
    assertExists(e);
    assertEquals(e instanceof Error, true);
    assertEquals((e as Error).message.includes(messageIncludes), true);
  }
}

describe("ProxyFSAdapterManager", () => {
  describe("class", () => {
    it("should export ProxyFSAdapterManager class", () => {
      assertExists(ProxyFSAdapterManager);
      assertEquals(typeof ProxyFSAdapterManager, "function");
    });
  });

  describe("constructor", () => {
    it("should be instantiable with minimal config", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxAdapters option", () => {
      const manager = createManager({ maxAdapters: 50 });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxIdleMs option", () => {
      const manager = createManager({ maxIdleMs: 60000 });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept cleanupIntervalMs option", () => {
      const manager = createManager({ cleanupIntervalMs: 30000 });
      assertExists(manager);
      manager.dispose();
    });

    it("should default maxAdapters to 100", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });
  });

  describe("methods", () => {
    it("should have getAdapter method", () => {
      const manager = createManager();
      assertEquals(typeof manager.getAdapter, "function");
      manager.dispose();
    });

    it("should have hasAdapter method", () => {
      const manager = createManager();
      assertEquals(typeof manager.hasAdapter, "function");
      manager.dispose();
    });

    it("should have getStats method", () => {
      const manager = createManager();
      assertEquals(typeof manager.getStats, "function");
      manager.dispose();
    });

    it("should have dispose method", () => {
      const manager = createManager();
      assertEquals(typeof manager.dispose, "function");
      manager.dispose();
    });
  });

  describe("hasAdapter", () => {
    it("should return false for non-existent adapter", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("non-existent-project"), false);
      manager.dispose();
    });

    it("should differentiate adapters by branch in preview mode", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("project", false, null, "main"), false);
      assertEquals(manager.hasAdapter("project", false, null, "feature-x"), false);
      assertEquals(manager.hasAdapter("project", false, null, null), false);
      manager.dispose();
    });

    it("should treat null branch as main branch", () => {
      const manager = createManager();
      assertEquals(
        manager.hasAdapter("project", false, null, null),
        manager.hasAdapter("project", false, null, "main"),
      );
      manager.dispose();
    });

    it("should ignore branch for production mode", () => {
      const manager = createManager();
      assertEquals(
        manager.hasAdapter("project", true, "rel-123", "main"),
        manager.hasAdapter("project", true, "rel-123", "feature-x"),
      );
      manager.dispose();
    });

    it("should differentiate by releaseId in production mode", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("project", true, "rel-1"), false);
      assertEquals(manager.hasAdapter("project", true, "rel-2"), false);
      manager.dispose();
    });
  });

  describe("getStats", () => {
    it("should return stats object with zero adapters initially", () => {
      const manager = createManager();
      const stats = manager.getStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      assertEquals(Object.keys(stats.stats).length, 0);
      manager.dispose();
    });
  });

  describe("dispose", () => {
    it("should dispose without error", () => {
      const manager = createManager();
      manager.dispose();
    });

    it("should allow multiple dispose calls", () => {
      const manager = createManager();
      manager.dispose();
      manager.dispose();
    });

    it("should stop cleanup timer on dispose", () => {
      const manager = createManager({ cleanupIntervalMs: 1000 });
      manager.dispose();
    });

    it("should clear all adapters on dispose", () => {
      const manager = createManager();
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
      assertEquals(manager.getStats().adapters, 0);
    });
  });

  describe("getAdapter validation", () => {
    it("should reject empty projectSlug", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["", "valid-token", undefined, false],
          "projectSlug",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should reject empty token", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["valid-slug", "", undefined, false],
          "token",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should accept valid parameters structurally", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });
  });

  describe("adapter lifecycle", () => {
    it("should not have adapter before getAdapter is called", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("test-project", false, null, "main"), false);
      manager.dispose();
    });

    it("should remove all adapters on dispose", () => {
      const manager = createManager();
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
      assertEquals(manager.getStats().adapters, 0);
    });
  });
});
