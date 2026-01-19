import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isMultiProjectAdapter, MultiProjectFSAdapter } from "./multi-project-adapter.ts";

describe("MultiProjectFSAdapter", () => {
  describe("class", () => {
    it("should export MultiProjectFSAdapter class", () => {
      assertExists(MultiProjectFSAdapter);
      assertEquals(typeof MultiProjectFSAdapter, "function");
    });
  });

  describe("instance", () => {
    it("should be instantiable with minimal config", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter);
      adapter.dispose();
    });

    it("should have initialize method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.initialize);
      assertEquals(typeof adapter.initialize, "function");
      adapter.dispose();
    });

    it("should have readFile method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.readFile);
      assertEquals(typeof adapter.readFile, "function");
      adapter.dispose();
    });

    it("should have readTextFile method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.readTextFile);
      assertEquals(typeof adapter.readTextFile, "function");
      adapter.dispose();
    });

    it("should have exists method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.exists);
      assertEquals(typeof adapter.exists, "function");
      adapter.dispose();
    });

    it("should have stat method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.stat);
      assertEquals(typeof adapter.stat, "function");
      adapter.dispose();
    });

    it("should have readdir method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.readdir);
      assertEquals(typeof adapter.readdir, "function");
      adapter.dispose();
    });

    it("should have resolveFile method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.resolveFile);
      assertEquals(typeof adapter.resolveFile, "function");
      adapter.dispose();
    });

    it("should have dispose method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.dispose);
      assertEquals(typeof adapter.dispose, "function");
      adapter.dispose();
    });

    it("should have runWithContext method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.runWithContext);
      assertEquals(typeof adapter.runWithContext, "function");
      adapter.dispose();
    });

    it("should have getManagerStats method", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      assertExists(adapter.getManagerStats);
      assertEquals(typeof adapter.getManagerStats, "function");
      adapter.dispose();
    });

    it("should return manager stats", () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      const stats = adapter.getManagerStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      adapter.dispose();
    });

    it("initialize should resolve immediately", async () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          baseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      });
      await adapter.initialize();
      adapter.dispose();
    });
  });
});

describe("isMultiProjectAdapter", () => {
  it("should export isMultiProjectAdapter function", () => {
    assertExists(isMultiProjectAdapter);
    assertEquals(typeof isMultiProjectAdapter, "function");
  });

  it("should return true for MultiProjectFSAdapter instance", () => {
    const adapter = new MultiProjectFSAdapter({
      veryfront: {
        baseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test-project",
        cache: { enabled: false },
      },
    });
    assertEquals(isMultiProjectAdapter(adapter), true);
    adapter.dispose();
  });

  it("should return false for non-MultiProjectFSAdapter", () => {
    assertEquals(isMultiProjectAdapter({}), false);
    assertEquals(isMultiProjectAdapter(null), false);
    assertEquals(isMultiProjectAdapter(undefined), false);
    assertEquals(isMultiProjectAdapter("string"), false);
  });
});
