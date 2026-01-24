import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isMultiProjectAdapter, MultiProjectFSAdapter } from "./multi-project-adapter.ts";

function createAdapter(): MultiProjectFSAdapter {
  return new MultiProjectFSAdapter({
    veryfront: {
      baseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
  });
}

function assertMethod(adapter: MultiProjectFSAdapter, name: keyof MultiProjectFSAdapter): void {
  const value = adapter[name];
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("MultiProjectFSAdapter", () => {
  describe("class", () => {
    it("should export MultiProjectFSAdapter class", () => {
      assertExists(MultiProjectFSAdapter);
      assertEquals(typeof MultiProjectFSAdapter, "function");
    });
  });

  describe("instance", () => {
    it("should be instantiable with minimal config", () => {
      const adapter = createAdapter();
      assertExists(adapter);
      adapter.dispose();
    });

    it("should have initialize method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "initialize");
      adapter.dispose();
    });

    it("should have readFile method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "readFile");
      adapter.dispose();
    });

    it("should have readTextFile method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "readTextFile");
      adapter.dispose();
    });

    it("should have exists method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "exists");
      adapter.dispose();
    });

    it("should have stat method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "stat");
      adapter.dispose();
    });

    it("should have readdir method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "readdir");
      adapter.dispose();
    });

    it("should have resolveFile method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "resolveFile");
      adapter.dispose();
    });

    it("should have dispose method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "dispose");
      adapter.dispose();
    });

    it("should have runWithContext method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "runWithContext");
      adapter.dispose();
    });

    it("should have getManagerStats method", () => {
      const adapter = createAdapter();
      assertMethod(adapter, "getManagerStats");
      adapter.dispose();
    });

    it("should return manager stats", () => {
      const adapter = createAdapter();
      const stats = adapter.getManagerStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      adapter.dispose();
    });

    it("initialize should resolve immediately", async () => {
      const adapter = createAdapter();
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
    const adapter = createAdapter();
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
