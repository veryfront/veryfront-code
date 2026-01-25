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
  return new ProxyFSAdapterManager({
    baseConfig,
    ...options,
  });
}

describe("ProxyFSAdapterManager", () => {
  describe("class", () => {
    it("should export ProxyFSAdapterManager class", () => {
      assertExists(ProxyFSAdapterManager);
      assertEquals(typeof ProxyFSAdapterManager, "function");
    });
  });

  describe("instance", () => {
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
  });

  describe("methods", () => {
    it("should have getAdapter method", () => {
      const manager = createManager();
      assertExists(manager.getAdapter);
      assertEquals(typeof manager.getAdapter, "function");
      manager.dispose();
    });

    it("should have hasAdapter method", () => {
      const manager = createManager();
      assertExists(manager.hasAdapter);
      assertEquals(typeof manager.hasAdapter, "function");
      manager.dispose();
    });

    it("should have getStats method", () => {
      const manager = createManager();
      assertExists(manager.getStats);
      assertEquals(typeof manager.getStats, "function");
      manager.dispose();
    });

    it("should have dispose method", () => {
      const manager = createManager();
      assertExists(manager.dispose);
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
      // Production mode requires releaseId
      assertEquals(
        manager.hasAdapter("project", true, "rel-123", "main"),
        manager.hasAdapter("project", true, "rel-123", "feature-x"),
      );
      manager.dispose();
    });
  });

  describe("getStats", () => {
    it("should return stats object", () => {
      const manager = createManager();
      const stats = manager.getStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      manager.dispose();
    });
  });
});
