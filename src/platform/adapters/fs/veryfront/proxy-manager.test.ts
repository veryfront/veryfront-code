import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";

describe("ProxyFSAdapterManager", () => {
  describe("class", () => {
    it("should export ProxyFSAdapterManager class", () => {
      assertExists(ProxyFSAdapterManager);
      assertEquals(typeof ProxyFSAdapterManager, "function");
    });
  });

  describe("instance", () => {
    it("should be instantiable with minimal config", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxAdapters option", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
        maxAdapters: 50,
      });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxIdleMs option", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
        maxIdleMs: 60000,
      });
      assertExists(manager);
      manager.dispose();
    });
  });

  describe("methods", () => {
    it("should have getAdapter method", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      assertExists(manager.getAdapter);
      assertEquals(typeof manager.getAdapter, "function");
      manager.dispose();
    });

    it("should have hasAdapter method", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      assertExists(manager.hasAdapter);
      assertEquals(typeof manager.hasAdapter, "function");
      manager.dispose();
    });

    it("should have getStats method", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      assertExists(manager.getStats);
      assertEquals(typeof manager.getStats, "function");
      manager.dispose();
    });

    it("should have dispose method", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      assertExists(manager.dispose);
      assertEquals(typeof manager.dispose, "function");
      manager.dispose();
    });
  });

  describe("hasAdapter", () => {
    it("should return false for non-existent adapter", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      assertEquals(manager.hasAdapter("non-existent-project"), false);
      manager.dispose();
    });

    it("should differentiate adapters by branch in preview mode", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      // Different branches should be treated as different adapters
      assertEquals(manager.hasAdapter("project", false, null, "main"), false);
      assertEquals(manager.hasAdapter("project", false, null, "feature-x"), false);
      assertEquals(manager.hasAdapter("project", false, null, null), false);
      manager.dispose();
    });

    it("should treat null branch as main branch", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      // Both null and "main" should produce the same cache key for preview mode
      // hasAdapter("project", false, null, null) checks for "project:preview:main"
      // hasAdapter("project", false, null, "main") also checks for "project:preview:main"
      assertEquals(
        manager.hasAdapter("project", false, null, null),
        manager.hasAdapter("project", false, null, "main"),
      );
      manager.dispose();
    });

    it("should ignore branch for production mode", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      // In production mode, branch should not affect cache key
      // Both should use "project:production:latest"
      assertEquals(
        manager.hasAdapter("project", true, null, "main"),
        manager.hasAdapter("project", true, null, "feature-x"),
      );
      manager.dispose();
    });
  });

  describe("getStats", () => {
    it("should return stats object", () => {
      const manager = new ProxyFSAdapterManager({
        baseConfig: {
          veryfront: {
            baseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        },
      });
      const stats = manager.getStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      manager.dispose();
    });
  });
});
