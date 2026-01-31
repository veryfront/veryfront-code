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

function assertMethod(
  adapter: MultiProjectFSAdapter,
  name: keyof MultiProjectFSAdapter,
): void {
  const value = adapter[name];
  assertExists(value);
  assertEquals(typeof value, "function");
}

function withAdapter(fn: (adapter: MultiProjectFSAdapter) => void): void {
  const adapter = createAdapter();
  try {
    fn(adapter);
  } finally {
    adapter.dispose();
  }
}

async function withAdapterAsync(
  fn: (adapter: MultiProjectFSAdapter) => Promise<void>,
): Promise<void> {
  const adapter = createAdapter();
  try {
    await fn(adapter);
  } finally {
    adapter.dispose();
  }
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
      withAdapter((adapter) => {
        assertExists(adapter);
      });
    });

    it("should have initialize method", () => {
      withAdapter((adapter) => assertMethod(adapter, "initialize"));
    });

    it("should have readFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readFile"));
    });

    it("should have readTextFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readTextFile"));
    });

    it("should have exists method", () => {
      withAdapter((adapter) => assertMethod(adapter, "exists"));
    });

    it("should have stat method", () => {
      withAdapter((adapter) => assertMethod(adapter, "stat"));
    });

    it("should have readdir method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readdir"));
    });

    it("should have resolveFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "resolveFile"));
    });

    it("should have dispose method", () => {
      withAdapter((adapter) => assertMethod(adapter, "dispose"));
    });

    it("should have runWithContext method", () => {
      withAdapter((adapter) => assertMethod(adapter, "runWithContext"));
    });

    it("should have getManagerStats method", () => {
      withAdapter((adapter) => assertMethod(adapter, "getManagerStats"));
    });

    it("should return manager stats", () => {
      withAdapter((adapter) => {
        const stats = adapter.getManagerStats();
        assertExists(stats);
        assertEquals(stats.adapters, 0);
        assertExists(stats.stats);
      });
    });

    it("initialize should resolve immediately", async () => {
      await withAdapterAsync((adapter) => adapter.initialize());
    });
  });
});

describe("isMultiProjectAdapter", () => {
  it("should export isMultiProjectAdapter function", () => {
    assertExists(isMultiProjectAdapter);
    assertEquals(typeof isMultiProjectAdapter, "function");
  });

  it("should return true for MultiProjectFSAdapter instance", () => {
    withAdapter((adapter) => {
      assertEquals(isMultiProjectAdapter(adapter), true);
    });
  });

  it("should return false for non-MultiProjectFSAdapter", () => {
    assertEquals(isMultiProjectAdapter({}), false);
    assertEquals(isMultiProjectAdapter(null), false);
    assertEquals(isMultiProjectAdapter(undefined), false);
    assertEquals(isMultiProjectAdapter("string"), false);
  });
});
