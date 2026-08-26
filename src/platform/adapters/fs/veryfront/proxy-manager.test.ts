import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/index.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import { getGetAdapterParamsSchema } from "./schemas/index.ts";

const baseConfig = {
  veryfront: {
    apiBaseUrl: "https://api.example.com",
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

/**
 * Adapter factory whose adapters skip network initialization and record every
 * dispose() call, so cache lifecycle assertions can observe adapter teardown.
 */
function createRecordingAdapterFactory(disposedSlugs: string[]) {
  return (config: ConstructorParameters<typeof VeryfrontFSAdapter>[0]): VeryfrontFSAdapter => {
    const projectSlug = config.veryfront?.projectSlug ?? "";
    const adapter = new VeryfrontFSAdapter(config);
    adapter.initialize = () => Promise.resolve();
    const disposeAdapter = adapter.dispose.bind(adapter);
    adapter.dispose = (): void => {
      disposedSlugs.push(projectSlug);
      disposeAdapter();
    };
    return adapter;
  };
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
  it("keeps credential-bearing adapter collections outside the public object graph", () => {
    const manager = createManager();
    try {
      const ownProperties = Object.getOwnPropertyNames(manager);
      assertEquals(ownProperties.includes("adapters"), false);
      assertEquals(ownProperties.includes("pendingAdapters"), false);
    } finally {
      manager.dispose();
    }
  });

  it("uses the validation method captured before project code can replace it", async () => {
    const manager = createManager({
      adapterFactory: (config) => {
        const adapter = new VeryfrontFSAdapter(config);
        adapter.initialize = () => Promise.resolve();
        return adapter;
      },
    });
    const schema = getGetAdapterParamsSchema();
    const originalSafeParse = schema.safeParse;
    let poisonedCalls = 0;
    schema.safeParse = ((...args: Parameters<typeof originalSafeParse>) => {
      poisonedCalls += 1;
      return originalSafeParse.apply(schema, args);
    }) as typeof schema.safeParse;
    try {
      await manager.getAdapter("my-project", "request-token", undefined, false);
      assertEquals(poisonedCalls, 0);
    } finally {
      schema.safeParse = originalSafeParse;
      manager.dispose();
    }
  });

  it("canonicalizes hosted project IDs without a mutable trim hook", async () => {
    const manager = createManager({
      baseConfig: {
        veryfront: {
          ...baseConfig.veryfront,
          proxyMode: true,
        },
      },
      adapterFactory: (config) => {
        const adapter = new VeryfrontFSAdapter(config);
        adapter.initialize = () => Promise.resolve();
        return adapter;
      },
    });
    await manager.getAdapter(
      "my-project",
      "signed-user-token",
      "canonical-project-id",
      false,
    );
    const originalTrim = String.prototype.trim;
    let poisonedCalls = 0;
    String.prototype.trim = function () {
      poisonedCalls += 1;
      throw new Error("project trim hook must not run");
    };

    try {
      await manager.getAdapter(
        "my-project",
        "signed-user-token",
        "canonical-project-id",
        false,
      );
      assertEquals(poisonedCalls, 0);
    } finally {
      String.prototype.trim = originalTrim;
      manager.dispose();
    }
  });

  describe("exact preview source", () => {
    it("propagates a missing push branch without loading main", async () => {
      const branch = "push-20260324t121046";
      const error = API_CLIENT_ERROR.create({
        detail: "API request failed: 404 Not Found",
        status: 404,
        context: {
          details: {
            responseText: JSON.stringify({ detail: `Branch '${branch}' not found` }),
            url:
              `https://api.example.com/projects/my-project/files?limit=100&sort_by=updated_at&sort_order=desc&branch=${
                encodeURIComponent(branch)
              }`,
          },
        },
      });
      const attemptedBranches: Array<string | null | undefined> = [];
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            const context = adapter.getContentContext();
            attemptedBranches.push(context?.sourceType === "branch" ? context.branch : null);
            throw error;
          };
          return adapter;
        },
      });

      try {
        await assertRejects(
          () =>
            manager.getAdapter(
              "my-project",
              "test-token",
              undefined,
              false,
              null,
              null,
              branch,
            ),
          Error,
          "API request failed: 404 Not Found",
        );
        assertEquals(attemptedBranches, [branch]);
        assertEquals(manager.hasAdapter("my-project", false, null, "main"), false);
      } finally {
        manager.dispose();
      }
    });

    it("disposes the uncached adapter when initialization fails", async () => {
      let disposeCalls = 0;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.reject(new Error("init failed"));
          const originalDispose = adapter.dispose.bind(adapter);
          adapter.dispose = () => {
            disposeCalls++;
            originalDispose();
          };
          return adapter;
        },
      });

      try {
        await assertRejects(
          () =>
            manager.getAdapter(
              "my-project",
              "test-token",
              undefined,
              false,
              null,
              null,
              "main",
            ),
          Error,
          "init failed",
        );
        assertEquals(disposeCalls, 1);
        assertEquals(manager.hasAdapter("my-project", false, null, "main"), false);
      } finally {
        manager.dispose();
      }
    });
  });

  describe("adapter identity", () => {
    function stubbedManager(): ProxyFSAdapterManager {
      return createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
    }

    it("keeps distinct preview environments on separate adapters", async () => {
      const manager = stubbedManager();
      try {
        const unnamed = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
        );
        const preview = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          "preview",
          "main",
        );

        assertNotStrictEquals(unnamed, preview);
      } finally {
        manager.dispose();
      }
    });

    it("reuses an unnamed preview adapter after a named one is created", async () => {
      const manager = stubbedManager();
      try {
        const first = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
        );
        const named = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          "preview",
          "main",
        );
        const again = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
        );

        assertNotStrictEquals(first, named);
        assertStrictEquals(first, again);
      } finally {
        manager.dispose();
      }
    });

    it("treats an empty environment name as unnamed", async () => {
      const manager = stubbedManager();
      try {
        const empty = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          "",
          "main",
        );
        const unnamed = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
        );

        assertStrictEquals(empty, unnamed);
      } finally {
        manager.dispose();
      }
    });

    it("ignores releaseId when resolving a preview adapter identity", async () => {
      const manager = stubbedManager();
      try {
        const withRelease = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          "release-7",
          null,
          "main",
        );
        const withoutRelease = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
        );

        assertStrictEquals(withRelease, withoutRelease);
      } finally {
        manager.dispose();
      }
    });

    it("ignores branch when resolving a production adapter identity", async () => {
      const manager = stubbedManager();
      try {
        const withBranch = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          "Production",
          "main",
        );
        const withoutBranch = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          "Production",
          null,
        );

        assertStrictEquals(withBranch, withoutBranch);
      } finally {
        manager.dispose();
      }
    });
  });

  describe("exact production source", () => {
    it("rejects mutable environment selection without an immutable release", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["my-project", "test-token", undefined, true, null, "Production", null],
          "releaseId is required in production mode",
        );
      } finally {
        manager.dispose();
      }
    });

    it("keeps environment name and release id in the resolved context", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          "Production",
          null,
        );

        assertEquals(adapter.getContentContext(), {
          sourceType: "environment",
          projectSlug: "my-project",
          environmentName: "Production",
          releaseId: "release-42",
        });
      } finally {
        manager.dispose();
      }
    });

    it("keeps a release-only source distinct from the production environment", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          null,
          null,
        );

        assertEquals(adapter.getContentContext(), {
          sourceType: "release",
          projectSlug: "my-project",
          releaseId: "release-42",
        });
      } finally {
        manager.dispose();
      }
    });

    it("uses the release-only identity for lookup and eviction", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          null,
          null,
        );

        assertEquals(manager.hasAdapter("my-project", true, "release-42"), true);
        assertEquals(
          manager.hasAdapter("my-project", true, "release-42", null, "Production"),
          false,
        );

        manager.evictAdapter("my-project", true, "release-42");
        assertEquals(manager.hasAdapter("my-project", true, "release-42"), false);
      } finally {
        manager.dispose();
      }
    });
  });

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

    it("rejects non-positive or non-integral adapter limits", () => {
      for (const maxAdapters of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => createManager({ maxAdapters }),
          RangeError,
          "maxAdapters must be a positive safe integer",
        );
      }
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

  describe("idle cleanup", () => {
    it("disposes idle adapters and keeps adapters inside their idle window", async () => {
      const idleDisposedSlugs: string[] = [];
      const retainedDisposedSlugs: string[] = [];
      const idleManager = createManager({
        cleanupIntervalMs: 5,
        maxIdleMs: 0,
        adapterFactory: createRecordingAdapterFactory(idleDisposedSlugs),
      });
      const retainingManager = createManager({
        cleanupIntervalMs: 5,
        maxIdleMs: 60_000,
        adapterFactory: createRecordingAdapterFactory(retainedDisposedSlugs),
      });

      try {
        await idleManager.getAdapter("idle-project", "token", undefined, false, null, null, "main");
        await retainingManager.getAdapter(
          "fresh-project",
          "token",
          undefined,
          false,
          null,
          null,
          "main",
        );
        assertEquals(idleManager.getStats().adapters, 1, "the idle adapter starts cached");
        assertEquals(retainingManager.getStats().adapters, 1, "the fresh adapter starts cached");

        await waitFor(() => idleManager.getStats().adapters === 0, {
          message: "an idle adapter must be removed by the cleanup timer",
        });
        assertEquals(
          idleDisposedSlugs,
          ["idle-project"],
          "an idle adapter must be disposed, not just dropped",
        );

        // Both managers share a cleanup interval, so the eviction above proves
        // the timer has ticked for the retaining manager too.
        assertEquals(
          retainingManager.getStats().adapters,
          1,
          "an adapter inside its idle window must survive the same cleanup ticks",
        );
        assertEquals(
          retainedDisposedSlugs,
          [],
          "an adapter inside its idle window must not be disposed",
        );
      } finally {
        idleManager.dispose();
        retainingManager.dispose();
      }
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

    it("should differentiate adapters by branch in preview mode", async () => {
      const manager = createManager({
        adapterFactory: createRecordingAdapterFactory([]),
      });
      try {
        await manager.getAdapter("project", "token", undefined, false, null, null, "main");
        await manager.getAdapter("project", "token", undefined, false, null, null, "feature-x");

        assertEquals(
          manager.hasAdapter("project", false, null, "main"),
          true,
          "the main-branch adapter must be selectable",
        );
        assertEquals(
          manager.hasAdapter("project", false, null, "feature-x"),
          true,
          "the feature-branch adapter must be selectable",
        );
        assertEquals(
          manager.hasAdapter("project", false, null, "other"),
          false,
          "branch must be part of preview adapter selection",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should treat null branch as main branch", async () => {
      const manager = createManager({
        adapterFactory: createRecordingAdapterFactory([]),
      });
      try {
        await manager.getAdapter("my-project", "test-token", undefined, false, null, null, "main");

        assertEquals(
          manager.hasAdapter("my-project", false, null, null),
          true,
          "null branch resolves to the cached main-branch adapter",
        );
        assertEquals(
          manager.hasAdapter("my-project", false, null, "main"),
          true,
          "the cached adapter is still selectable by its explicit branch",
        );
        assertEquals(
          manager.hasAdapter("my-project", false, null, "feature-x"),
          false,
          "another branch must not resolve to the main-branch adapter",
        );

        manager.evictAdapter("my-project", false, null, null);

        assertEquals(
          manager.hasAdapter("my-project", false, null, "main"),
          false,
          "eviction by null branch must remove the main-branch adapter",
        );
      } finally {
        manager.dispose();
      }
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

    it("rejects release-less production cache lookups", () => {
      const manager = createManager();
      assertThrows(
        () => manager.hasAdapter("project", true, null, null, "Production"),
        Error,
        "Missing releaseId in production",
      );
      assertThrows(
        () => manager.evictAdapter("project", true, null, null, "Production"),
        Error,
        "Missing releaseId in production",
      );
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

    it("does not expose credential principals in public adapter keys", async () => {
      const credentialPrincipal =
        "478bc71887c1235cd3040630d0f3e8eb1cabd4797951e480e90c006428962952";
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      try {
        await manager.getAdapter(
          "diagnostic-project",
          "vf_test_diagnostic_credential",
          "project-one",
          false,
          null,
          null,
          "feature-branch",
        );
        await manager.getAdapter(
          "diagnostic-project",
          "different-diagnostic-credential",
          "project-one",
          false,
          null,
          null,
          "feature-branch",
        );
        await manager.getAdapter(
          "diagnostic-project",
          "vf_test_diagnostic_credential",
          "project-one",
          true,
          "release-one",
          "Production",
          null,
        );

        const statsKeys = Object.keys(manager.getStats().stats);
        const serializedKeys = JSON.stringify(statsKeys);
        assertEquals(statsKeys.length, 3);
        assertEquals(serializedKeys.includes(credentialPrincipal), false);
        assertEquals(/[a-f0-9]{64}/.test(serializedKeys), false);
        assertEquals(serializedKeys.includes("diagnostic-project"), true);
        assertEquals(serializedKeys.includes("project-one"), true);
        assertEquals(serializedKeys.includes("feature-branch"), true);
        assertEquals(serializedKeys.includes("release-one"), true);
        assertEquals(serializedKeys.includes("Production"), true);
        assertEquals(statsKeys.some((key) => key.endsWith(":instance:2")), true);
      } finally {
        manager.dispose();
      }
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

    it("should clear all adapters on dispose", async () => {
      const disposedSlugs: string[] = [];
      const manager = createManager({
        adapterFactory: createRecordingAdapterFactory(disposedSlugs),
      });

      await manager.getAdapter("test-project", "test-token", undefined, false, null, null, "main");
      assertEquals(manager.getStats().adapters, 1, "a cached adapter is tracked before dispose");

      manager.dispose();

      assertEquals(manager.getStats().adapters, 0, "dispose must clear the adapter map");
      assertEquals(
        disposedSlugs,
        ["test-project"],
        "dispose must dispose each cached adapter's timers and socket",
      );
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

    it("reports whether adapter selection waited for materialization", async () => {
      const manager = createManager({
        adapterFactory: createRecordingAdapterFactory([]),
      });
      const initializedNow: boolean[] = [];
      try {
        await manager.getAdapter(
          "project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
          (initialized) => initializedNow.push(initialized),
        );
        await manager.getAdapter(
          "project",
          "test-token",
          undefined,
          false,
          null,
          null,
          "main",
          (initialized) => initializedNow.push(initialized),
        );

        assertEquals(initializedNow, [true, false]);
      } finally {
        manager.dispose();
      }
    });

    it("should remove all adapters on dispose", async () => {
      const disposedSlugs: string[] = [];
      const manager = createManager({
        adapterFactory: createRecordingAdapterFactory(disposedSlugs),
      });

      await manager.getAdapter("project-one", "test-token", undefined, false, null, null, "main");
      await manager.getAdapter("project-two", "test-token", undefined, false, null, null, "main");
      assertEquals(manager.getStats().adapters, 2, "both cached adapters are tracked");

      manager.dispose();

      assertEquals(manager.getStats().adapters, 0, "dispose must clear every cached adapter");
      assertEquals(
        disposedSlugs.slice().sort(),
        ["project-one", "project-two"],
        "dispose must dispose every cached adapter, not just the first",
      );
    });
  });

  describe("hosted tenant and credential isolation", () => {
    it("fails closed when shared proxy mode has no canonical project ID", async () => {
      const manager = createManager({
        baseConfig: {
          ...baseConfig,
          veryfront: { ...baseConfig.veryfront, proxyMode: true },
        },
      });
      try {
        await assertGetAdapterRejects(
          manager,
          ["reusable-slug", "tenant-token", undefined, false, null, null, "main"],
          "require a canonical project ID",
        );
      } finally {
        manager.dispose();
      }
    });

    it("does not reuse source adapters after a project slug is reassigned", async () => {
      const observedProjectIds: Array<string | undefined> = [];
      const manager = createManager({
        baseConfig: {
          ...baseConfig,
          veryfront: { ...baseConfig.veryfront, proxyMode: true },
        },
        adapterFactory: (config) => {
          observedProjectIds.push(config.veryfront?.projectId);
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const first = await manager.getAdapter(
          "reusable-slug",
          "same-token",
          "project-one",
          false,
          null,
          null,
          "main",
        );
        const reassigned = await manager.getAdapter(
          "reusable-slug",
          "same-token",
          "project-two",
          false,
          null,
          null,
          "main",
        );

        assertNotStrictEquals(first, reassigned);
        assertEquals(observedProjectIds, ["project-one", "project-two"]);
        assertEquals(manager.getStats().adapters, 2);
      } finally {
        manager.dispose();
      }
    });

    it("partitions concurrent adapters by immutable credential principal", async () => {
      const observedTokens: Array<string | undefined> = [];
      const manager = createManager({
        baseConfig: {
          ...baseConfig,
          veryfront: { ...baseConfig.veryfront, proxyMode: true },
        },
        adapterFactory: (config) => {
          observedTokens.push(config.veryfront?.apiToken);
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => await Promise.resolve();
          adapter.setRequestToken = () => {
            throw new Error("cached adapter token must remain immutable");
          };
          return adapter;
        },
      });
      try {
        const [first, second] = await Promise.all([
          manager.getAdapter(
            "tenant",
            "credential-one",
            "project-one",
            false,
            null,
            null,
            "main",
          ),
          manager.getAdapter(
            "tenant",
            "credential-two",
            "project-one",
            false,
            null,
            null,
            "main",
          ),
        ]);

        assertNotStrictEquals(first, second);
        assertEquals(observedTokens.toSorted(), ["credential-one", "credential-two"]);
      } finally {
        manager.dispose();
      }
    });

    it("partitions credential principals after Array.from is replaced", async () => {
      const originalArrayFrom = Array.from;
      const manager = createManager({
        baseConfig: {
          ...baseConfig,
          veryfront: { ...baseConfig.veryfront, proxyMode: true },
        },
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      try {
        Array.from = ((source: unknown, ...args: unknown[]) => {
          if (source instanceof Uint8Array) return [];
          return Reflect.apply(originalArrayFrom, Array, [source, ...args]);
        }) as typeof Array.from;

        const first = await manager.getAdapter(
          "tenant",
          "credential-one",
          "project-one",
          false,
          null,
          null,
          "main",
        );
        const second = await manager.getAdapter(
          "tenant",
          "credential-two",
          "project-one",
          false,
          null,
          null,
          "main",
        );

        assertNotStrictEquals(first, second);
      } finally {
        Array.from = originalArrayFrom;
        manager.dispose();
      }
    });

    it("does not dispatch adapter creation through a mutable prototype property", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      const prototype = ProxyFSAdapterManager.prototype as unknown as Record<
        string,
        unknown
      >;
      const originalCreateAdapter = Object.getOwnPropertyDescriptor(
        prototype,
        "createAdapter",
      );
      let interceptedToken: string | undefined;
      Object.defineProperty(prototype, "createAdapter", {
        configurable: true,
        value: (...args: unknown[]) => {
          interceptedToken = args[3] as string | undefined;
          throw new Error("mutable createAdapter dispatch was invoked");
        },
      });

      try {
        const adapter = await manager.getAdapter(
          "tenant",
          "signed-user-token",
          "project-one",
          false,
          null,
          null,
          "main",
        );

        assertExists(adapter);
        assertEquals(interceptedToken, undefined);
      } finally {
        if (originalCreateAdapter) {
          Object.defineProperty(prototype, "createAdapter", originalCreateAdapter);
        } else {
          Reflect.deleteProperty(prototype, "createAdapter");
        }
        manager.dispose();
      }
    });

    it("uses captured concrete setup methods after project prototype mutation", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          (adapter as unknown as { initialized: boolean }).initialized = true;
          return adapter;
        },
      });
      const originalSetContentContext = Object.getOwnPropertyDescriptor(
        VeryfrontFSAdapter.prototype,
        "setContentContext",
      )!;
      const originalInitialize = Object.getOwnPropertyDescriptor(
        VeryfrontFSAdapter.prototype,
        "initialize",
      )!;
      const observedTokens: string[] = [];
      const observeToken = function (this: { apiToken?: string }) {
        if (this.apiToken) observedTokens.push(this.apiToken);
      };
      Object.defineProperty(VeryfrontFSAdapter.prototype, "setContentContext", {
        configurable: true,
        value: function (this: { apiToken?: string }) {
          observeToken.call(this);
        },
      });
      Object.defineProperty(VeryfrontFSAdapter.prototype, "initialize", {
        configurable: true,
        value: function (this: { apiToken?: string }) {
          observeToken.call(this);
          return Promise.resolve();
        },
      });

      try {
        const adapter = await manager.getAdapter(
          "tenant",
          "signed-user-token",
          "project-one",
          false,
          null,
          null,
          "main",
        );

        assertExists(adapter);
        assertEquals(observedTokens, []);
      } finally {
        Object.defineProperty(
          VeryfrontFSAdapter.prototype,
          "setContentContext",
          originalSetContentContext,
        );
        Object.defineProperty(
          VeryfrontFSAdapter.prototype,
          "initialize",
          originalInitialize,
        );
        manager.dispose();
      }
    });

    it("does not expose credential principals in logs or cache invariant errors", async () => {
      const token = "vf_test_diagnostic_credential";
      const credentialPrincipal =
        "478bc71887c1235cd3040630d0f3e8eb1cabd4797951e480e90c006428962952";
      const entries: LogEntry[] = [];
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const originalConsoleDebug = console.debug;
      const originalConsoleError = console.error;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      try {
        Deno.env.set("LOG_LEVEL", "DEBUG");
        refreshLoggerConfig();
        __registerLogRecordEmitter((entry) => entries.push(entry));
        console.debug = () => {};
        console.error = () => {};

        const adapter = await manager.getAdapter(
          "diagnostic-project",
          token,
          "project-one",
          false,
          null,
          null,
          "feature-branch",
        );
        adapter.setContentContext({
          sourceType: "branch",
          projectSlug: "diagnostic-project",
          branch: "different-branch",
        });

        const error = await assertRejects(() =>
          manager.getAdapter(
            "diagnostic-project",
            token,
            "project-one",
            false,
            null,
            null,
            "feature-branch",
          )
        );
        const diagnostics = JSON.stringify({
          entries,
          error: {
            message: error instanceof Error ? error.message : String(error),
            detail: (error as { detail?: unknown }).detail,
            context: (error as { context?: unknown }).context,
          },
        });

        assertEquals(diagnostics.includes(token), false);
        assertEquals(diagnostics.includes(credentialPrincipal), false);
        assertEquals(diagnostics.includes("diagnostic-project"), true);
        assertEquals(diagnostics.includes("project-one"), true);
        assertEquals(diagnostics.includes("feature-branch"), true);
      } finally {
        manager.dispose();
        console.debug = originalConsoleDebug;
        console.error = originalConsoleError;
        __resetLogRecordEmitterForTests();
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        refreshLoggerConfig();
      }
    });

    it("reserves capacity for pending adapter initialization", async () => {
      const initializationGate = Promise.withResolvers<void>();
      const firstInitializationStarted = Promise.withResolvers<void>();
      let factoryCalls = 0;
      let firstRequest: Promise<VeryfrontFSAdapter> | undefined;
      const manager = createManager({
        maxAdapters: 1,
        adapterFactory: (config) => {
          factoryCalls += 1;
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = factoryCalls === 1
            ? () => {
              firstInitializationStarted.resolve();
              return initializationGate.promise;
            }
            : () => Promise.resolve();
          return adapter;
        },
      });

      try {
        firstRequest = manager.getAdapter(
          "tenant-one",
          "credential-one",
          undefined,
          false,
          null,
          null,
          "main",
        );
        await firstInitializationStarted.promise;

        const overload = await assertRejects(() =>
          manager.getAdapter(
            "tenant-two",
            "credential-two",
            undefined,
            false,
            null,
            null,
            "main",
          )
        );
        assertEquals((overload as { slug?: string }).slug, "service-overloaded");
        assertEquals(factoryCalls, 1);

        initializationGate.resolve();
        const first = await firstRequest;
        assertEquals(manager.getStats().adapters, 1);

        const second = await manager.getAdapter(
          "tenant-two",
          "credential-two",
          undefined,
          false,
          null,
          null,
          "main",
        );
        assertNotStrictEquals(first, second);
        assertEquals(factoryCalls, 2);
        assertEquals(manager.getStats().adapters, 1);
      } finally {
        initializationGate.resolve();
        await firstRequest?.catch(() => {});
        manager.dispose();
      }
    });

    it("evicts the least recently used adapter, not the most recent", async () => {
      const disposedSlugs: string[] = [];
      let clock = 1_000_000;
      const manager = createManager({
        maxAdapters: 2,
        now: () => clock,
        adapterFactory: createRecordingAdapterFactory(disposedSlugs),
      });

      try {
        await manager.getAdapter("tenant-a", "credential", undefined, false, null, null, "main");
        clock += 1_000;
        await manager.getAdapter("tenant-b", "credential", undefined, false, null, null, "main");
        clock += 1_000;
        // Refreshing A makes B the least recently used entry.
        await manager.getAdapter("tenant-a", "credential", undefined, false, null, null, "main");
        clock += 1_000;
        await manager.getAdapter("tenant-c", "credential", undefined, false, null, null, "main");

        assertEquals(
          manager.hasAdapter("tenant-a", false, null, "main"),
          true,
          "the most recently used adapter must survive admission",
        );
        assertEquals(
          manager.hasAdapter("tenant-b", false, null, "main"),
          false,
          "the least recently used adapter must be the one evicted",
        );
        assertEquals(
          disposedSlugs,
          ["tenant-b"],
          "eviction must dispose only the least recently used adapter",
        );
      } finally {
        manager.dispose();
      }
    });

    it("releases a reserved slot after synchronous initialization failure", async () => {
      let factoryCalls = 0;
      const manager = createManager({
        maxAdapters: 1,
        adapterFactory: (config) => {
          factoryCalls += 1;
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = factoryCalls === 1
            ? () => {
              throw new Error("synchronous initialization failure");
            }
            : () => Promise.resolve();
          return adapter;
        },
      });

      try {
        await assertRejects(
          () =>
            manager.getAdapter(
              "tenant-one",
              "credential-one",
              undefined,
              false,
              null,
              null,
              "main",
            ),
          Error,
          "synchronous initialization failure",
        );

        const recovered = await manager.getAdapter(
          "tenant-two",
          "credential-two",
          undefined,
          false,
          null,
          null,
          "main",
        );
        assertExists(recovered);
        assertEquals(factoryCalls, 2);
        assertEquals(manager.getStats().adapters, 1);
      } finally {
        manager.dispose();
      }
    });

    it("evicts a cached adapter whose resolved source context is corrupted", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "tenant",
          "credential",
          "project-one",
          false,
          null,
          null,
          "main",
        );
        adapter.setContentContext({
          sourceType: "branch",
          projectSlug: "tenant",
          branch: "other",
        });

        await assertRejects(
          () =>
            manager.getAdapter(
              "tenant",
              "credential",
              "project-one",
              false,
              null,
              null,
              "main",
            ),
          Error,
          "Context mismatch",
        );
        assertEquals(manager.hasAdapter("tenant", false, null, "main", null, "project-one"), false);
      } finally {
        manager.dispose();
      }
    });
  });
});
