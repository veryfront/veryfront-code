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
