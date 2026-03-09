import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCurrentRequestContext,
  getRequestScopedFile,
  isMultiProjectAdapter,
  MultiProjectFSAdapter,
  runWithRequestContext,
  setRequestScopedFile,
  wrapWithCurrentContext,
} from "./multi-project-adapter.ts";

function createAdapter(): MultiProjectFSAdapter {
  return new MultiProjectFSAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
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

describe("getCurrentRequestContext", () => {
  it("should return null when no context is active", () => {
    assertEquals(getCurrentRequestContext(), null);
  });

  it("should return context within runWithRequestContext", async () => {
    await runWithRequestContext(
      { projectSlug: "test-project", token: "test-token" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertExists(ctx);
        assertEquals(ctx!.projectSlug, "test-project");
        assertEquals(ctx!.token, "test-token");
        assertEquals(ctx!.productionMode, false);
      },
    );
  });

  it("should return null after context exits", async () => {
    await runWithRequestContext(
      { projectSlug: "test", token: "token" },
      async () => {},
    );
    assertEquals(getCurrentRequestContext(), null);
  });
});

describe("runWithRequestContext", () => {
  it("should set productionMode from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", productionMode: true },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.productionMode, true);
      },
    );
  });

  it("should set releaseId from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", releaseId: "rel-123" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.releaseId, "rel-123");
      },
    );
  });

  it("should set projectId from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", projectId: "pid-456" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.projectId, "pid-456");
      },
    );
  });

  it("should default releaseId to null", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.releaseId, null);
      },
    );
  });

  it("should return the callback result", async () => {
    const result = await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => 42,
    );
    assertEquals(result, 42);
  });

  it("should provide a fileCache map", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertExists(ctx!.fileCache);
        assertEquals(ctx!.fileCache instanceof Map, true);
      },
    );
  });
});

describe("getRequestScopedFile / setRequestScopedFile", () => {
  it("should return undefined when no context is active", () => {
    assertEquals(getRequestScopedFile("key"), undefined);
  });

  it("should set and get files within context", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        setRequestScopedFile("file:test.ts", "content");
        assertEquals(getRequestScopedFile("file:test.ts"), "content");
      },
    );
  });

  it("should return undefined for non-existent keys within context", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        assertEquals(getRequestScopedFile("nonexistent"), undefined);
      },
    );
  });

  it("should not persist across contexts", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        setRequestScopedFile("key1", "value1");
      },
    );

    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        assertEquals(getRequestScopedFile("key1"), undefined);
      },
    );
  });
});

describe("wrapWithCurrentContext", () => {
  it("should return the same function when no context is active", () => {
    const fn = () => "hello";
    const wrapped = wrapWithCurrentContext(fn);
    assertEquals(wrapped, fn);
  });

  it("should preserve context in wrapped function", async () => {
    let wrappedFn: (() => string | null) | null = null;

    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        wrappedFn = wrapWithCurrentContext(() => {
          return getCurrentRequestContext()?.projectSlug ?? null;
        });
      },
    );

    assertExists(wrappedFn);
    assertEquals(wrappedFn!(), "proj");
  });
});

describe("globalThis.__vf_multi_project_adapter", () => {
  it("should be registered on globalThis", () => {
    assertExists(globalThis.__vf_multi_project_adapter);
  });

  it("should have getCurrentRequestContext function", () => {
    assertEquals(
      typeof globalThis.__vf_multi_project_adapter!.getCurrentRequestContext,
      "function",
    );
  });

  it("should have getRequestScopedFile function", () => {
    assertEquals(typeof globalThis.__vf_multi_project_adapter!.getRequestScopedFile, "function");
  });

  it("should have setRequestScopedFile function", () => {
    assertEquals(typeof globalThis.__vf_multi_project_adapter!.setRequestScopedFile, "function");
  });
});
