import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearRequestScopedFileCache,
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

    it("should have readOptionalTextFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readOptionalTextFile"));
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

    it("should have refreshSourceSnapshot method", () => {
      withAdapter((adapter) => assertMethod(adapter, "refreshSourceSnapshot"));
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

    it("refreshSourceSnapshot should delegate and clear request-scoped file cache", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let refreshedReason: string | undefined;
        let capturedProjectSlug: string | undefined;
        let capturedProjectId: string | undefined;
        let capturedBranch: string | null | undefined;
        let cachedBeforeRefresh: string | undefined;
        let cachedAfterRefresh: string | undefined;

        (adapter as any).manager = {
          getAdapter(
            projectSlug: string,
            _token: string,
            projectId?: string,
            _productionMode?: boolean,
            _releaseId?: string | null,
            _environmentName?: string | null,
            branch?: string | null,
          ) {
            capturedProjectSlug = projectSlug;
            capturedProjectId = projectId;
            capturedBranch = branch;
            return Promise.resolve({
              refreshSourceSnapshot(reason?: string) {
                refreshedReason = reason;
                return Promise.resolve();
              },
            });
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "test-token",
            async () => {
              setRequestScopedFile("file:pages/index.mdx", "stale-content");
              cachedBeforeRefresh = getRequestScopedFile("file:pages/index.mdx");
              await adapter.refreshSourceSnapshot("review-comment");
              cachedAfterRefresh = getRequestScopedFile("file:pages/index.mdx");
            },
            "project-id-a",
            { branch: "main" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(refreshedReason, "review-comment");
        assertEquals(capturedProjectSlug, "project-a");
        assertEquals(capturedProjectId, "project-id-a");
        assertEquals(capturedBranch, "main");
        assertEquals(cachedBeforeRefresh, "stale-content");
        assertEquals(cachedAfterRefresh, undefined);
      });
    });

    it("delegates optional text reads to the active project adapter", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let optionalPath: string | undefined;
        let normalReadCalled = false;

        (adapter as any).manager = {
          getAdapter() {
            return Promise.resolve({
              readOptionalTextFile(path: string) {
                optionalPath = path;
                return Promise.resolve("optional stylesheet");
              },
              readTextFile() {
                normalReadCalled = true;
                return Promise.resolve("normal read");
              },
            });
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          const content = await adapter.runWithContext(
            "project-a",
            "test-token",
            () => adapter.readOptionalTextFile("app/globals.css"),
            "project-id-a",
            { branch: "main" },
          );

          assertEquals(content, "optional stylesheet");
          assertEquals(optionalPath, "app/globals.css");
          assertEquals(normalReadCalled, false);
        } finally {
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("materializes production release adapters before running the context callback", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let getAdapterCalled = false;
        let callbackSawMaterializedAdapter = false;
        let capturedProjectSlug: string | undefined;
        let capturedProjectId: string | undefined;
        let capturedProductionMode: boolean | undefined;
        let capturedReleaseId: string | null | undefined;
        let capturedEnvironmentName: string | null | undefined;

        (adapter as any).manager = {
          getAdapter(
            projectSlug: string,
            _token: string,
            projectId?: string,
            productionMode?: boolean,
            releaseId?: string | null,
            environmentName?: string | null,
          ) {
            getAdapterCalled = true;
            capturedProjectSlug = projectSlug;
            capturedProjectId = projectId;
            capturedProductionMode = productionMode;
            capturedReleaseId = releaseId;
            capturedEnvironmentName = environmentName;
            return Promise.resolve({});
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-release",
            "test-token",
            async () => {
              callbackSawMaterializedAdapter = getAdapterCalled;
            },
            "project-id-release",
            {
              productionMode: true,
              releaseId: "rel-first-hit",
              environmentName: "production",
            },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(callbackSawMaterializedAdapter, true);
        assertEquals(capturedProjectSlug, "project-release");
        assertEquals(capturedProjectId, "project-id-release");
        assertEquals(capturedProductionMode, true);
        assertEquals(capturedReleaseId, "rel-first-hit");
        assertEquals(capturedEnvironmentName, "production");
      });
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

  it("should set branch from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", branch: "feature-branch" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.branch, "feature-branch");
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

  it("should clear all files in the current context", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        setRequestScopedFile("file:a.ts", "a");
        setRequestScopedFile("file:b.ts", "b");

        assertEquals(clearRequestScopedFileCache(), 2);
        assertEquals(getRequestScopedFile("file:a.ts"), undefined);
        assertEquals(getRequestScopedFile("file:b.ts"), undefined);
      },
    );
  });

  it("should return zero when no context is active", () => {
    assertEquals(clearRequestScopedFileCache(), 0);
  });
});

describe("wrapWithCurrentContext", () => {
  it("should return the same function when no context is active", () => {
    const fn = () => "hello";
    const wrapped = wrapWithCurrentContext(fn);
    assertEquals(wrapped, fn);
  });

  it("should preserve context in wrapped function", async () => {
    const projectSlug = await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        const wrappedFn = wrapWithCurrentContext(() => {
          return getCurrentRequestContext()?.projectSlug ?? null;
        });
        return wrappedFn();
      },
    );

    assertEquals(projectSlug, "proj");
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

  it("should have clearRequestScopedFileCache function", () => {
    assertEquals(
      typeof globalThis.__vf_multi_project_adapter!.clearRequestScopedFileCache,
      "function",
    );
  });
});
