import "#veryfront/schemas/_test-setup.ts";

import { AsyncLocalStorage } from "node:async_hooks";
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
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { registerRequestContextFinalizer } from "./request-context.ts";

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

    it("should have source-qualified style config methods", () => {
      withAdapter((adapter) => {
        assertMethod(adapter, "createStyleConfigBinding");
        assertMethod(adapter, "installStyleConfig");
      });
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

    it("keeps request and adapter diagnostics isolated from ambient timing poisoning", async () => {
      const adapter = createAdapter();
      const originalManager = (adapter as any).manager;
      const performancePrototype = Object.getPrototypeOf(performance) as {
        now: typeof performance.now;
      };
      const originalPerformanceNow = performancePrototype.now;
      const originalToFixed = Number.prototype.toFixed;
      let content: string | undefined;

      (adapter as any).manager = {
        getAdapter() {
          return Promise.resolve({
            readFile: () => Promise.resolve("captured diagnostics"),
          });
        },
        getStats: () => ({ adapters: 0, stats: [] }),
        dispose: () => {},
      };

      try {
        performancePrototype.now = (() => {
          throw new Error("ambient performance.now must not run");
        }) as typeof performance.now;
        Number.prototype.toFixed = (() => {
          throw new Error("ambient Number.toFixed must not run");
        }) as typeof Number.prototype.toFixed;

        content = await adapter.runWithContext(
          "diagnostic-project",
          "diagnostic-token",
          () => adapter.readFile("pages/index.tsx"),
          "diagnostic-id",
          { branch: "main" },
        );
      } finally {
        performancePrototype.now = originalPerformanceNow;
        Number.prototype.toFixed = originalToFixed;
        (adapter as any).manager = originalManager;
        adapter.dispose();
      }

      assertEquals(content, "captured diagnostics");
    });

    it("disposes manager and default adapter independently and clears retry state", () => {
      const adapter = createAdapter();
      const originalManager = (adapter as any).manager;
      const managerError = new Error("manager cleanup failed");
      const defaultAdapterError = new Error("default adapter cleanup failed");
      let managerDisposeCalls = 0;
      let defaultAdapterDisposeCalls = 0;
      let firstFailure: unknown;
      let secondFailure: unknown;

      (adapter as any).manager = {
        dispose() {
          managerDisposeCalls++;
          if (managerDisposeCalls === 1) throw managerError;
        },
      };
      adapter.setDefaultAdapter({
        dispose() {
          defaultAdapterDisposeCalls++;
          throw defaultAdapterError;
        },
      } as any);

      try {
        try {
          adapter.dispose();
        } catch (error) {
          firstFailure = error;
        }
        try {
          adapter.dispose();
        } catch (error) {
          secondFailure = error;
        }

        assertEquals(firstFailure instanceof AggregateError, true);
        assertEquals((firstFailure as AggregateError).errors, [
          managerError,
          defaultAdapterError,
        ]);
        assertEquals(secondFailure, undefined);
        assertEquals(managerDisposeCalls, 2);
        assertEquals(defaultAdapterDisposeCalls, 1);
        assertEquals((adapter as any).defaultAdapter, undefined);
      } finally {
        (adapter as any).defaultAdapter = undefined;
        (adapter as any).manager = originalManager;
        adapter.dispose();
      }
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

    it("does not recover finalized credentials from detached adapter work", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const releaseDetachedWork = Promise.withResolvers<void>();
        let detachedWork: Promise<void> | undefined;
        let detachedError: unknown;
        let managerCalls = 0;

        (adapter as any).manager = {
          getAdapter() {
            managerCalls++;
            return Promise.resolve({
              readFile: () => Promise.resolve("must not be reached"),
            });
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "detached-project",
            "detached-token",
            async () => {
              detachedWork = (async () => {
                await releaseDetachedWork.promise;
                try {
                  await adapter.readFile("secret.ts");
                } catch (error) {
                  detachedError = error;
                }
              })();
            },
            "detached-id",
            { branch: "main" },
          );

          releaseDetachedWork.resolve();
          await detachedWork;
        } finally {
          releaseDetachedWork.resolve();
          await detachedWork;
          (adapter as any).manager = originalManager;
        }

        assertEquals(managerCalls, 0);
        assertEquals(detachedError instanceof Error, true);
        assertEquals(
          (detachedError as Error).message.includes("No request context available"),
          true,
        );
      });
    });

    it("routes concurrent style config bindings to their exact project adapters", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const installed: Array<{
          projectSlug: string;
          bindingProjectSlug: string;
          configProjectSlug: unknown;
        }> = [];
        const projectAdapters = new Map(
          ["project-a", "project-b"].map((projectSlug) => {
            const binding = Object.freeze({
              projectSlug,
              sourceKey: `${projectSlug}:release-1`,
              sourceRevision: 1,
            });
            return [
              projectSlug,
              {
                createStyleConfigBinding: () => binding,
                installStyleConfig: (
                  receivedBinding: typeof binding,
                  config: Readonly<Record<string, unknown>>,
                ) => {
                  installed.push({
                    projectSlug,
                    bindingProjectSlug: receivedBinding.projectSlug,
                    configProjectSlug: config.projectSlug,
                  });
                  return receivedBinding === binding;
                },
              },
            ] as const;
          }),
        );

        (adapter as any).manager = {
          getAdapter(projectSlug: string) {
            return Promise.resolve(projectAdapters.get(projectSlug));
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          const results = await Promise.all(
            ["project-a", "project-b"].map((projectSlug) =>
              adapter.runWithContext(
                projectSlug,
                `${projectSlug}-token`,
                async () => {
                  const binding = await adapter.createStyleConfigBinding();
                  await Promise.resolve();
                  return await adapter.installStyleConfig(
                    binding,
                    Object.freeze({ projectSlug }),
                  );
                },
                `${projectSlug}-id`,
                { productionMode: true, releaseId: "release-1" },
              )
            ),
          );

          assertEquals(results, [true, true]);
          assertEquals(
            installed.sort((a, b) => a.projectSlug.localeCompare(b.projectSlug)),
            [
              {
                projectSlug: "project-a",
                bindingProjectSlug: "project-a",
                configProjectSlug: "project-a",
              },
              {
                projectSlug: "project-b",
                bindingProjectSlug: "project-b",
                configProjectSlug: "project-b",
              },
            ],
          );
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

  it("separates immutable file API authority from cache API provenance", async () => {
    await runWithRequestContext(
      {
        projectSlug: "proj",
        projectId: "project-id",
        token: "request-token",
      },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx?.requestApiCredential, {
          projectSlug: "proj",
          projectId: "project-id",
          token: "request-token",
        });
        assertEquals(Object.isFrozen(ctx?.requestApiCredential), true);
        assertEquals(ctx?.cacheApiCredential, undefined);
      },
    );
  });

  it("uses captured request-context primordials after ambient poisoning", async () => {
    const originalMap = globalThis.Map;
    const originalArrayPush = Array.prototype.push;
    const originalFreeze = Object.freeze;
    const originalGetStore = AsyncLocalStorage.prototype.getStore;
    const originalRun = AsyncLocalStorage.prototype.run;
    const originalSetAdd = Set.prototype.add;
    const originalSetForEach = Set.prototype.forEach;
    const originalWeakMapDelete = WeakMap.prototype.delete;
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    let credentialFrozen = false;
    let cacheCredentialFrozen = false;
    let fileCacheUsesCapturedMap = false;
    let finalizerCalls = 0;
    const cleanupError = new Error("captured cleanup error");
    let cleanupCaught: unknown;

    try {
      globalThis.Map = class PoisonedMap {
        constructor() {
          throw new Error("ambient Map constructor must not run");
        }
      } as unknown as MapConstructor;
      Array.prototype.push = (() => {
        throw new Error("ambient Array.push must not run");
      }) as typeof Array.prototype.push;
      Object.freeze = ((value: object) => value) as typeof Object.freeze;
      AsyncLocalStorage.prototype.getStore = (() => {
        throw new Error("ambient AsyncLocalStorage.getStore must not run");
      }) as typeof AsyncLocalStorage.prototype.getStore;
      AsyncLocalStorage.prototype.run = (() => {
        throw new Error("ambient AsyncLocalStorage.run must not run");
      }) as typeof AsyncLocalStorage.prototype.run;
      Set.prototype.add = (() => {
        throw new Error("ambient Set.add must not run");
      }) as typeof Set.prototype.add;
      Set.prototype.forEach = (() => {
        throw new Error("ambient Set.forEach must not run");
      }) as typeof Set.prototype.forEach;
      WeakMap.prototype.delete = (() => {
        throw new Error("ambient WeakMap.delete must not run");
      }) as typeof WeakMap.prototype.delete;
      WeakMap.prototype.get = (() => {
        throw new Error("ambient WeakMap.get must not run");
      }) as typeof WeakMap.prototype.get;
      WeakMap.prototype.set = (() => {
        throw new Error("ambient WeakMap.set must not run");
      }) as typeof WeakMap.prototype.set;
      WeakSet.prototype.add = (() => {
        throw new Error("ambient WeakSet.add must not run");
      }) as typeof WeakSet.prototype.add;
      WeakSet.prototype.has = (() => {
        throw new Error("ambient WeakSet.has must not run");
      }) as typeof WeakSet.prototype.has;

      try {
        await runWithRequestContext(
          {
            projectSlug: "primordial-project",
            projectId: "primordial-id",
            token: "primordial-token",
            tokenProvenance: "project-bound",
          },
          async () => {
            const context = getCurrentRequestContext();
            if (!context) throw new Error("request context was not installed");
            credentialFrozen = context.requestApiCredential !== undefined &&
              Object.isFrozen(context.requestApiCredential);
            cacheCredentialFrozen = context.cacheApiCredential !== undefined &&
              Object.isFrozen(context.cacheApiCredential);
            fileCacheUsesCapturedMap = context.fileCache instanceof originalMap;
            setRequestScopedFile("file:test.ts", "content");
            if (getRequestScopedFile("file:test.ts") !== "content") {
              throw new Error("captured request file cache methods were not used");
            }
            registerRequestContextFinalizer(context, () => {
              finalizerCalls++;
              throw cleanupError;
            });
            registerRequestContextFinalizer(context, () => {
              finalizerCalls++;
            });
          },
        );
      } catch (error) {
        cleanupCaught = error;
      }
    } finally {
      globalThis.Map = originalMap;
      Array.prototype.push = originalArrayPush;
      Object.freeze = originalFreeze;
      AsyncLocalStorage.prototype.getStore = originalGetStore;
      AsyncLocalStorage.prototype.run = originalRun;
      Set.prototype.add = originalSetAdd;
      Set.prototype.forEach = originalSetForEach;
      WeakMap.prototype.delete = originalWeakMapDelete;
      WeakMap.prototype.get = originalWeakMapGet;
      WeakMap.prototype.set = originalWeakMapSet;
      WeakSet.prototype.add = originalWeakSetAdd;
      WeakSet.prototype.has = originalWeakSetHas;
    }

    assertEquals(credentialFrozen, true);
    assertEquals(cacheCredentialFrozen, true);
    assertEquals(fileCacheUsesCapturedMap, true);
    assertEquals(finalizerCalls, 2);
    assertEquals(cleanupCaught, cleanupError);
  });

  it("runs every finalizer without replacing the primary request failure", async () => {
    const primaryError = new Error("primary request failure");
    const cleanupError = new Error("cleanup failure");
    const finalized: string[] = [];
    let caught: unknown;

    try {
      await runWithRequestContext(
        { projectSlug: "proj", token: "tok" },
        async () => {
          const context = getCurrentRequestContext();
          if (!context) throw new Error("request context was not installed");
          registerRequestContextFinalizer(context, () => {
            finalized.push("first");
            throw cleanupError;
          });
          registerRequestContextFinalizer(context, () => {
            finalized.push("second");
          });
          throw primaryError;
        },
      );
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, primaryError);
    assertEquals(finalized, ["first", "second"]);
  });

  it("surfaces cleanup failure after a successful request and still runs later finalizers", async () => {
    const cleanupError = new Error("cleanup failure");
    const finalized: string[] = [];
    let caught: unknown;

    try {
      await runWithRequestContext(
        { projectSlug: "proj", token: "tok" },
        async () => {
          const context = getCurrentRequestContext();
          if (!context) throw new Error("request context was not installed");
          registerRequestContextFinalizer(context, () => {
            finalized.push("first");
            throw cleanupError;
          });
          registerRequestContextFinalizer(context, () => {
            finalized.push("second");
          });
        },
      );
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, cleanupError);
    assertEquals(finalized, ["first", "second"]);
  });

  it("revokes ambient credentials from detached work after request completion", async () => {
    const releaseDetachedWork = Promise.withResolvers<void>();
    let detachedContext: ReturnType<typeof getCurrentRequestContext> | undefined;
    let detachedWork: Promise<void> | undefined;

    await runWithRequestContext(
      {
        projectSlug: "detached-project",
        token: "detached-token",
      },
      async () => {
        detachedWork = (async () => {
          await releaseDetachedWork.promise;
          detachedContext = getCurrentRequestContext();
        })();
      },
    );

    releaseDetachedWork.resolve();
    await detachedWork;
    assertEquals(detachedContext, null);
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

describe("cache request-context bridge", () => {
  it("ignores post-import replacement of the legacy writable global", async () => {
    const globals = globalThis as Record<string, unknown>;
    const key = "__vf_multi_project_adapter";
    const hadOwnValue = Object.hasOwn(globals, key);
    const originalValue = globals[key];
    globals[key] = {
      getCurrentRequestContext: () => ({
        projectSlug: "attacker-project",
        projectId: "attacker-id",
        token: "attacker-token",
        productionMode: true,
        releaseId: "attacker-release",
      }),
    };

    try {
      const context = await runWithRequestContext(
        {
          projectSlug: "real-project",
          projectId: "real-id",
          token: "real-token",
          branch: "real-branch",
        },
        async () => tryGetCacheKeyContext(),
      );

      assertEquals(context, {
        projectId: "real-id",
        mode: "preview",
        versionId: "real-branch",
      });
    } finally {
      if (hadOwnValue) globals[key] = originalValue;
      else delete globals[key];
    }
  });
});
