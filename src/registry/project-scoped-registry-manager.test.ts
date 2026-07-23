import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import {
  runWithCacheKeyContext,
  tryGetRegistryScopeId,
} from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process/env.ts";
import { VeryfrontError } from "#veryfront/errors";
import { refreshLoggerConfig } from "#veryfront/utils/logger/index.ts";
import {
  ProjectScopedRegistryManager,
  runWithRegistryTransaction,
  runWithRegistryTransactionSavepoint,
  runWithSharedRegistryMutationsDisabled,
} from "./project-scoped-registry-manager.ts";
import { ScopedRegistryFacade } from "./scoped-registry-facade.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function captureVeryfrontError(fn: () => unknown): VeryfrontError {
  let captured: unknown;
  assertThrows(() => {
    try {
      fn();
    } catch (error) {
      captured = error;
      throw error;
    }
  }, VeryfrontError);
  assert(captured instanceof VeryfrontError);
  return captured;
}

describe("shared registry mutation policy", () => {
  it("blocks shared mutations only inside the restricted async context", async () => {
    const manager = new ProjectScopedRegistryManager<string>("policy-test");

    await assertRejects(
      () =>
        runWithSharedRegistryMutationsDisabled(async () => {
          await Promise.resolve();
          manager.registerShared("project-owned", "value");
        }),
      VeryfrontError,
      "Project modules cannot mutate shared registries",
    );

    manager.registerShared("framework-owned", "value");
    assertEquals(manager.get("framework-owned"), "value");
  });

  it("blocks shared deletion inside the restricted async context", async () => {
    const manager = new ProjectScopedRegistryManager<string>("policy-test");
    manager.registerShared("framework-owned", "value");

    await assertRejects(
      () =>
        runWithSharedRegistryMutationsDisabled(async () => {
          await Promise.resolve();
          manager.deleteShared("framework-owned");
        }),
      VeryfrontError,
      "Project modules cannot mutate shared registries",
    );

    assertEquals(manager.hasShared("framework-owned"), true);
    assertEquals(manager.deleteShared("framework-owned"), true);
    assertEquals(manager.hasShared("framework-owned"), false);
  });

  it("blocks process-wide clearing inside the restricted async context", async () => {
    const manager = new ProjectScopedRegistryManager<string>("policy-test");
    const scope = {
      projectId: "restricted-project",
      mode: "preview" as const,
      versionId: "main",
    };
    manager.registerShared("framework-owned", "shared");
    runWithCacheKeyContext(scope, () => manager.register("project-owned", "scoped"));

    await runWithSharedRegistryMutationsDisabled(async () => {
      await Promise.resolve();
      assertThrows(
        () => manager.clearProject(scope.projectId),
        VeryfrontError,
        "Project modules cannot administer process-wide registries",
      );
      assertThrows(
        () => manager.clearAll(),
        VeryfrontError,
        "Project modules cannot administer process-wide registries",
      );
    });

    assertEquals(manager.getShared("framework-owned"), "shared");
    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.getOwn("project-owned"), "scoped");
    });
  });

  it("keeps detached restricted code unprivileged in a later transaction", async () => {
    const manager = new ProjectScopedRegistryManager<string>("policy-test");
    const startDetached = deferred<void>();
    let detachedMutation!: Promise<void>;

    await runWithRegistryTransaction(async () => {
      runWithSharedRegistryMutationsDisabled(() => {
        detachedMutation = startDetached.promise.then(async () => {
          await runWithRegistryTransaction(async () => {
            manager.registerShared("project-owned", "must-not-publish");
          });
        });
      });
    });

    startDetached.resolve();
    await assertRejects(
      () => detachedMutation,
      VeryfrontError,
      "Project modules cannot mutate shared registries",
    );
    assertEquals(manager.hasShared("project-owned"), false);
  });
});

describe("ScopedRegistryFacade", () => {
  it("delegates the complete scoped and shared registry contract", () => {
    const facade = new ScopedRegistryFacade(
      new ProjectScopedRegistryManager<string>("facade-test"),
    );

    facade.registerShared("shared", "shared-value");
    facade.register("scoped", "scoped-value");
    assertEquals(facade.getShared("shared"), "shared-value");
    assertEquals(facade.hasShared("shared"), true);
    assertEquals(facade.get("shared"), "shared-value");
    assertEquals(facade.getOwn("scoped"), "scoped-value");
    assertEquals(facade.hasOwn("scoped"), true);
    assertEquals(facade.has("scoped"), true);
    assertEquals(new Set(facade.getAllIds()), new Set(["shared", "scoped"]));
    assertEquals(
      facade.getAll(),
      new Map([
        ["shared", "shared-value"],
        ["scoped", "scoped-value"],
      ]),
    );
    assertEquals(facade.getStats(), {
      projectCount: 1,
      sharedCount: 1,
      totalItems: 2,
      currentProjectItems: 1,
    });

    assertEquals(facade.delete("scoped"), true);
    facade.register("scoped", "replacement");
    facade.clear();
    assertEquals(facade.hasOwn("scoped"), false);
    assertEquals(facade.deleteShared("shared"), true);

    facade.registerShared("shared", "replacement");
    facade.register("scoped", "replacement");
    facade.clearAll();
    assertEquals(facade.getAllIds(), []);
  });
});

async function captureRejectedError(
  fn: () => Promise<unknown>,
  // deno-lint-ignore no-explicit-any -- error constructors have contravariant parameters
  errorClass: new (...args: any[]) => Error,
  messageIncludes?: string,
): Promise<Error> {
  let captured: unknown;
  await assertRejects(
    async () => {
      try {
        await fn();
      } catch (error) {
        captured = error;
        throw error;
      }
    },
    errorClass,
    messageIncludes,
  );
  assert(captured instanceof Error);
  return captured;
}

describe("ProjectScopedRegistryManager", () => {
  function createManager<T>(name: string): ProjectScopedRegistryManager<T> {
    return new ProjectScopedRegistryManager<T>(name);
  }

  describe("constructor", () => {
    it("should create a registry with a given name", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.getAllIds(), []);
    });
  });

  describe("register / get", () => {
    it("should register and retrieve an item", () => {
      const manager = createManager<string>("tool");
      manager.register("my-tool", "tool-value");
      assertEquals(manager.get("my-tool"), "tool-value");
    });

    it("should return undefined for unregistered items", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.get("nonexistent"), undefined);
    });

    it("should overwrite an existing item with the same id", () => {
      const manager = createManager<string>("tool");
      manager.register("my-tool", "first");
      manager.register("my-tool", "second");
      assertEquals(manager.get("my-tool"), "second");
    });

    it("should handle complex object values", () => {
      const manager = createManager<{ name: string; version: number }>("agent");
      const agent = { name: "test-agent", version: 2 };
      manager.register("agent-1", agent);
      assertEquals(manager.get("agent-1"), agent);
    });

    it("lets a project-scoped undefined value shadow a shared value", () => {
      const manager = createManager<string | undefined>("tool");
      manager.registerShared("optional-tool", "shared");
      manager.register("optional-tool", undefined);

      assertEquals(manager.has("optional-tool"), true);
      assertEquals(manager.get("optional-tool"), undefined);
      assertEquals(manager.getAll().get("optional-tool"), undefined);
    });

    it("distinguishes an own undefined value from a missing registration", () => {
      const facade = new ScopedRegistryFacade(
        createManager<string | undefined>("tool"),
      );
      facade.registerShared("optional-tool", "shared");
      facade.register("optional-tool", undefined);

      assertEquals(facade.getOwn("optional-tool"), undefined);
      assertEquals(facade.hasOwn("optional-tool"), true);

      facade.delete("optional-tool");
      assertEquals(facade.hasOwn("optional-tool"), false);
    });

    it("isolates registries by cache scope for the same project", () => {
      const manager = createManager<string>("tool");

      runWithCacheKeyContext(
        { projectId: "proj-1", mode: "preview", versionId: "main" },
        () => manager.register("shared-tool", "main-value"),
      );

      runWithCacheKeyContext(
        { projectId: "proj-1", mode: "preview", versionId: "feature-a" },
        () => {
          assertEquals(manager.get("shared-tool"), undefined);
          manager.register("shared-tool", "feature-value");
        },
      );

      runWithCacheKeyContext(
        { projectId: "proj-1", mode: "preview", versionId: "main" },
        () => assertEquals(manager.get("shared-tool"), "main-value"),
      );

      runWithCacheKeyContext(
        { projectId: "proj-1", mode: "preview", versionId: "feature-a" },
        () => assertEquals(manager.get("shared-tool"), "feature-value"),
      );
    });
  });

  describe("registerShared / get fallback", () => {
    it("should register and retrieve a shared item", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-tool", "shared-value");
      assertEquals(manager.get("shared-tool"), "shared-value");
    });

    it("should overwrite an existing shared item", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-tool", "first");
      manager.registerShared("shared-tool", "second");
      assertEquals(manager.get("shared-tool"), "second");
    });

    it("applies the configured collision validator to shared replacements", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool", {
        validateRegistration(_id, existing, incoming) {
          if (existing !== incoming) throw new Error("conflicting definition");
        },
      });
      manager.registerShared("shared-tool", "first");

      assertThrows(
        () => manager.registerShared("shared-tool", "second"),
        Error,
        "conflicting definition",
      );
      assertEquals(manager.getShared("shared-tool"), "first");
    });

    it("should prefer project-specific item over shared item", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("tool-x", "shared-version");
      manager.register("tool-x", "project-version");
      assertEquals(manager.get("tool-x"), "project-version");
    });

    it("should fall back to shared when project item not found", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-only", "shared-value");
      assertEquals(manager.get("shared-only"), "shared-value");
    });
  });

  describe("has", () => {
    it("should return true for registered project items", () => {
      const manager = createManager<string>("tool");
      manager.register("item-a", "value-a");
      assert(manager.has("item-a"));
    });

    it("should return true for shared items", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-a", "value-a");
      assert(manager.has("shared-a"));
    });

    it("should return true for shared items even when project registry exists", () => {
      const manager = createManager<string>("tool");
      manager.register("proj-item", "pv");
      manager.registerShared("shared-item", "sv");
      assert(manager.has("shared-item"));
    });

    it("should return false for missing items", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.has("missing"), false);
    });
  });

  describe("getAllIds", () => {
    it("should return empty array when nothing registered", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.getAllIds(), []);
    });

    it("should return project item ids", () => {
      const manager = createManager<string>("tool");
      manager.register("a", "1");
      manager.register("b", "2");

      const ids = manager.getAllIds();
      assert(ids.includes("a"));
      assert(ids.includes("b"));
      assertEquals(ids.length, 2);
    });

    it("should include shared ids", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-a", "1");
      manager.register("proj-a", "2");

      const ids = manager.getAllIds();
      assert(ids.includes("shared-a"));
      assert(ids.includes("proj-a"));
      assertEquals(ids.length, 2);
    });

    it("should deduplicate ids when project overrides shared", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("tool-x", "shared");
      manager.register("tool-x", "project");

      const ids = manager.getAllIds();
      assertEquals(ids, ["tool-x"]);
    });
  });

  describe("getAll", () => {
    it("should return empty map when nothing registered", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.getAll().size, 0);
    });

    it("should return both shared and project items", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-a", "sv");
      manager.register("proj-a", "pv");

      const all = manager.getAll();
      assertEquals(all.get("shared-a"), "sv");
      assertEquals(all.get("proj-a"), "pv");
      assertEquals(all.size, 2);
    });

    it("should let project items override shared items with same id", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("tool-x", "shared");
      manager.register("tool-x", "project");

      const all = manager.getAll();
      assertEquals(all.get("tool-x"), "project");
      assertEquals(all.size, 1);
    });

    it("returns a map that callers cannot use to mutate registry membership", () => {
      const manager = createManager<string>("tool");
      manager.register("tool-a", "value-a");

      const snapshot = manager.getAll();
      snapshot.clear();
      snapshot.set("tool-b", "value-b");

      assertEquals(manager.get("tool-a"), "value-a");
      assertEquals(manager.get("tool-b"), undefined);
    });
  });

  describe("delete", () => {
    it("should delete a registered project item", () => {
      const manager = createManager<string>("tool");
      manager.register("item", "value");

      assertEquals(manager.delete("item"), true);
      assertEquals(manager.get("item"), undefined);
      assertEquals(manager.getStats().projectCount, 0);
    });

    it("should return false when deleting a non-existent item", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.delete("missing"), false);
    });

    it("should not delete shared items via delete", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-a", "value");

      assertEquals(manager.delete("shared-a"), false);
      assertEquals(manager.get("shared-a"), "value");
    });

    it("should return false when project has no registry yet", () => {
      const manager = createManager<string>("tool");
      assertEquals(manager.delete("anything"), false);
    });
  });

  describe("clear", () => {
    it("should clear all project items", () => {
      const manager = createManager<string>("tool");
      manager.register("a", "1");
      manager.register("b", "2");

      manager.clear();

      const ids = manager.getAllIds();
      assertEquals(ids.includes("a") || ids.includes("b"), false);
    });

    it("should not clear shared items", () => {
      const manager = createManager<string>("tool");
      manager.registerShared("shared-a", "value");
      manager.register("proj-a", "value");

      manager.clear();

      assertEquals(manager.get("shared-a"), "value");
      assertEquals(manager.get("proj-a"), undefined);
    });

    it("clears only scopes owned by a delimiter-bearing project ID", () => {
      const manager = createManager<string>("tool");
      const tenant = {
        projectId: "tenant",
        mode: "production" as const,
        versionId: "preview:feature",
      };
      const prefixedTenant = {
        projectId: "tenant:production",
        mode: "preview" as const,
        versionId: "feature",
      };

      runWithCacheKeyContext(tenant, () => manager.register("tenant-tool", "tenant"));
      runWithCacheKeyContext(
        prefixedTenant,
        () => manager.register("prefixed-tool", "prefixed"),
      );

      manager.clearProject("tenant");

      runWithCacheKeyContext(tenant, () => {
        assertEquals(manager.get("tenant-tool"), undefined);
      });
      runWithCacheKeyContext(prefixedTenant, () => {
        assertEquals(manager.get("prefixed-tool"), "prefixed");
      });

      runWithCacheKeyContext(tenant, () => manager.register("tenant-tool", "tenant"));
      manager.clearProject("tenant:production");

      runWithCacheKeyContext(prefixedTenant, () => {
        assertEquals(manager.get("prefixed-tool"), undefined);
      });
      runWithCacheKeyContext(tenant, () => {
        assertEquals(manager.get("tenant-tool"), "tenant");
      });
    });

    it("does not treat another scope ID as the same project ID", () => {
      const manager = createManager<string>("tool");
      const victim = {
        projectId: "victim",
        mode: "production" as const,
        versionId: "release",
      };
      const victimScopeId = runWithCacheKeyContext(victim, tryGetRegistryScopeId);
      assert(victimScopeId);
      const scopeShapedProject = {
        projectId: victimScopeId,
        mode: "preview" as const,
        versionId: "main",
      };

      runWithCacheKeyContext(victim, () => manager.register("victim-tool", "victim"));
      runWithCacheKeyContext(
        scopeShapedProject,
        () => manager.register("scope-shaped-tool", "scope-shaped"),
      );

      manager.clearProject(victimScopeId);

      runWithCacheKeyContext(victim, () => {
        assertEquals(manager.get("victim-tool"), "victim");
      });
      runWithCacheKeyContext(scopeShapedProject, () => {
        assertEquals(manager.get("scope-shaped-tool"), undefined);
      });
    });

    it("clears only the exact current scope when legacy scope text would collide", () => {
      const manager = createManager<string>("tool");
      const left = {
        projectId: "tenant:production",
        mode: "preview" as const,
        versionId: "feature",
      };
      const right = {
        projectId: "tenant",
        mode: "production" as const,
        versionId: "preview:feature",
      };

      runWithCacheKeyContext(left, () => manager.register("left-tool", "left"));
      runWithCacheKeyContext(right, () => manager.register("right-tool", "right"));

      runWithCacheKeyContext(left, () => manager.clear());

      runWithCacheKeyContext(left, () => {
        assertEquals(manager.get("left-tool"), undefined);
      });
      runWithCacheKeyContext(right, () => {
        assertEquals(manager.get("right-tool"), "right");
      });
    });

    it("clearAll removes every project scope and shared item", () => {
      const manager = createManager<string>("tool");
      const first = { projectId: "clear-all-a", mode: "preview" as const, versionId: "main" };
      const second = { projectId: "clear-all-b", mode: "preview" as const, versionId: "main" };
      manager.registerShared("shared-tool", "shared");
      runWithCacheKeyContext(first, () => manager.register("first-tool", "first"));
      runWithCacheKeyContext(second, () => manager.register("second-tool", "second"));

      manager.clearAll();

      runWithCacheKeyContext(first, () => assertEquals(manager.getAllIds(), []));
      runWithCacheKeyContext(second, () => assertEquals(manager.getAllIds(), []));
      assertEquals(manager.getStats(), {
        projectCount: 0,
        sharedCount: 0,
        totalItems: 0,
        currentProjectItems: 0,
      });
    });
  });

  describe("input and option boundaries", () => {
    it("rejects empty or control-character registry names and item IDs", () => {
      assertThrows(() => new ProjectScopedRegistryManager<string>(""), VeryfrontError);
      assertThrows(() => new ProjectScopedRegistryManager<string>("tool\nname"), VeryfrontError);
      assertThrows(
        () => new ProjectScopedRegistryManager<string>("tool\u202ename"),
        VeryfrontError,
      );

      const manager = createManager<string>("tool");
      assertThrows(() => manager.register("", "value"), VeryfrontError);
      assertThrows(() => manager.register("tool\u0085id", "value"), VeryfrontError);
      assertThrows(() => manager.register("tool\u2066id", "value"), VeryfrontError);
      assertThrows(() => manager.register("tool\ud800id", "value"), VeryfrontError);
      manager.register("tool-😀", "value");
      assertEquals(manager.get("tool-😀"), "value");
      assertThrows(() => manager.registerShared("bad\nid", "value"), VeryfrontError);
      assertThrows(() => manager.get(""), VeryfrontError);
      assertThrows(() => manager.clearProject(""), VeryfrontError);
      assertThrows(() => manager.clearProject("p".repeat(4097)), VeryfrontError);
    });

    it("snapshots the registration validator at construction", () => {
      let validationCalls = 0;
      const options: {
        validateRegistration?: (id: string, existing: string, incoming: string) => void;
      } = {
        validateRegistration: () => {
          validationCalls++;
        },
      };
      const manager = new ProjectScopedRegistryManager<string>("tool", options);
      manager.register("tool-a", "first");

      options.validateRegistration = undefined;
      manager.register("tool-a", "second");

      assertEquals(validationCalls, 1);
    });

    it("rejects unreadable or invalid capacity options without leaking getter failures", () => {
      const canary = "PRIVATE_OPTION_GETTER_CANARY";
      const hostileOptions = Object.defineProperty({}, "maxScopes", {
        get() {
          throw new Error(canary);
        },
      });

      const getterError = captureVeryfrontError(
        () => new ProjectScopedRegistryManager<string>("tool", hostileOptions),
      );
      assertEquals(getterError.message.includes(canary), false);
      assertThrows(
        () => new ProjectScopedRegistryManager<string>("tool", { maxScopes: 0 }),
        VeryfrontError,
      );
      assertThrows(
        () => new ProjectScopedRegistryManager<string>("tool", { maxItemsPerScope: 1.5 }),
        VeryfrontError,
      );
      assertThrows(
        () =>
          new ProjectScopedRegistryManager<string>("tool", {
            validateRegistration: "invalid" as unknown as (
              id: string,
              existing: string,
              incoming: string,
            ) => void,
          }),
        VeryfrontError,
      );
    });
  });

  describe("getStats", () => {
    it("reports a self-consistent transaction-local view", async () => {
      const manager = createManager<string>("tool");
      const scope = {
        projectId: "stats-project",
        mode: "preview" as const,
        versionId: "main",
      };
      manager.registerShared("shared", "shared");
      runWithCacheKeyContext(scope, () => manager.register("old", "old"));

      await runWithCacheKeyContext(scope, async () => {
        await runWithRegistryTransaction(async () => {
          manager.clear();
          manager.register("first", "first");
          manager.register("second", "second");

          assertEquals(manager.getStats(), {
            projectCount: 1,
            sharedCount: 1,
            totalItems: 3,
            currentProjectItems: 2,
          });

          manager.clear();
          assertEquals(manager.getStats(), {
            projectCount: 0,
            sharedCount: 1,
            totalItems: 1,
            currentProjectItems: 0,
          });
        });
      });
    });
  });

  describe("capacity bounds", () => {
    const firstScope = { projectId: "capacity-a", mode: "preview" as const, versionId: "main" };
    const secondScope = { projectId: "capacity-b", mode: "preview" as const, versionId: "main" };

    it("rejects a new scope after the configured scope capacity is reached", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool", { maxScopes: 1 });
      runWithCacheKeyContext(firstScope, () => manager.register("tool-a", "a"));

      const error = captureVeryfrontError(
        () => runWithCacheKeyContext(secondScope, () => manager.register("tool-b", "b")),
      );
      assertEquals(error.slug, "service-overloaded");
      assertEquals(manager.getStats().projectCount, 1);
    });

    it("bounds items per scope and across the manager", () => {
      const perScope = new ProjectScopedRegistryManager<string>("tool", {
        maxItemsPerScope: 1,
      });
      runWithCacheKeyContext(firstScope, () => {
        perScope.register("tool-a", "a");
        const error = captureVeryfrontError(() => perScope.register("tool-b", "b"));
        assertEquals(error.slug, "service-overloaded");
        assertEquals(perScope.getAllIds(), ["tool-a"]);
      });

      const total = new ProjectScopedRegistryManager<string>("tool", {
        maxScopes: 2,
        maxItemsPerScope: 2,
        maxTotalItems: 1,
      });
      runWithCacheKeyContext(firstScope, () => total.register("tool-a", "a"));
      const error = captureVeryfrontError(
        () => runWithCacheKeyContext(secondScope, () => total.register("tool-b", "b")),
      );
      assertEquals(error.slug, "service-overloaded");
      assertEquals(total.getStats().projectCount, 1);
      assertEquals(total.getStats().totalItems, 1);
    });

    it("bounds the shared registry", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool", { maxSharedItems: 1 });
      manager.registerShared("tool-a", "a");

      const error = captureVeryfrontError(() => manager.registerShared("tool-b", "b"));
      assertEquals(error.slug, "service-overloaded");
      assertEquals(manager.getAllIds(), ["tool-a"]);
    });
  });

  it("does not put registry item or tenant identifiers in debug logs", () => {
    const itemCanary = "PRIVATE_REGISTRY_ITEM_CANARY";
    const projectCanary = "PRIVATE_REGISTRY_PROJECT_CANARY";
    const previousLevel = getHostEnv("LOG_LEVEL");
    const previousFormat = getHostEnv("LOG_FORMAT");
    const originalDebug = console.debug;
    let output = "";

    setEnv("LOG_LEVEL", "DEBUG");
    setEnv("LOG_FORMAT", "text");
    refreshLoggerConfig();
    console.debug = (...args: unknown[]) => {
      output += args.map(String).join(" ");
    };

    try {
      const manager = createManager<string>("tool");
      runWithCacheKeyContext(
        { projectId: projectCanary, mode: "preview", versionId: "main" },
        () => {
          manager.register(itemCanary, "first");
          manager.register(itemCanary, "second");
          manager.delete(itemCanary);
        },
      );
    } finally {
      console.debug = originalDebug;
      if (previousLevel === undefined) deleteEnv("LOG_LEVEL");
      else setEnv("LOG_LEVEL", previousLevel);
      if (previousFormat === undefined) deleteEnv("LOG_FORMAT");
      else setEnv("LOG_FORMAT", previousFormat);
      refreshLoggerConfig();
    }

    assertEquals(output.includes(itemCanary), false);
    assertEquals(output.includes(projectCanary), false);
  });
});

describe("ProjectScopedRegistryManager transactions", () => {
  const scope = { projectId: "project-transaction", mode: "preview" as const, versionId: "main" };

  it("runs on runtimes that do not provide Promise.withResolvers", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Promise, "withResolvers");
    if (descriptor) {
      Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        value: undefined,
        writable: true,
      });
    }

    try {
      const manager = new ProjectScopedRegistryManager<string>("skill");
      await runWithCacheKeyContext(
        scope,
        () =>
          runWithRegistryTransaction(async () => {
            manager.register("node-18-compatible", "value");
          }),
      );
      runWithCacheKeyContext(scope, () => {
        assertEquals(manager.get("node-18-compatible"), "value");
      });
    } finally {
      if (descriptor) Object.defineProperty(Promise, "withResolvers", descriptor);
      else Reflect.deleteProperty(Promise, "withResolvers");
    }
  });

  it("rejects invalid transaction and savepoint callbacks", async () => {
    await assertRejects(
      () => runWithRegistryTransaction(undefined as unknown as () => Promise<void>),
      VeryfrontError,
      "callback must be a function",
    );
    assertThrows(
      () => runWithSharedRegistryMutationsDisabled(null as unknown as () => void),
      VeryfrontError,
      "callback must be a function",
    );
    await assertRejects(
      () => runWithRegistryTransactionSavepoint(async () => {}),
      VeryfrontError,
      "require an active transaction",
    );

    await runWithRegistryTransaction(async () => {
      await assertRejects(
        () =>
          runWithRegistryTransactionSavepoint(
            undefined as unknown as () => Promise<void>,
          ),
        VeryfrontError,
        "callback must be a function",
      );
      await assertRejects(
        () =>
          runWithRegistryTransactionSavepoint(async () => {}, {
            rollbackOnSuccess: "yes" as unknown as boolean,
          }),
        VeryfrontError,
        "options must be a valid object",
      );
    });
  });

  it("sanitizes unreadable savepoint options", async () => {
    const canary = "PRIVATE_SAVEPOINT_OPTION_CANARY";
    const options = Object.defineProperty({}, "rollbackOnSuccess", {
      get() {
        throw new Error(canary);
      },
    });

    const error = await captureRejectedError(
      () =>
        runWithCacheKeyContext(
          scope,
          () =>
            runWithRegistryTransaction(async () => {
              await runWithRegistryTransactionSavepoint(
                async () => {},
                options as { rollbackOnSuccess?: boolean },
              );
            }),
        ),
      VeryfrontError,
    );
    assertEquals(error.message.includes(canary), false);
  });

  it("bounds the number of mutations retained by one transaction", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill", {
      maxMutationsPerTransaction: 2,
    });

    const error = await captureRejectedError(
      () =>
        runWithCacheKeyContext(
          scope,
          () =>
            runWithRegistryTransaction(async () => {
              manager.register("skill-a", "a");
              manager.delete("skill-a");
              manager.register("skill-b", "b");
            }),
        ),
      VeryfrontError,
    );
    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, "service-overloaded");
    runWithCacheKeyContext(scope, () => assertEquals(manager.getAllIds(), []));
  });

  it("preflights a live write against staged capacity before mutating either view", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill", {
      maxItemsPerScope: 1,
    });
    const stageReady = deferred<void>();
    const releaseStage = deferred<void>();
    const transaction = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.register("staged-skill", "staged");
          stageReady.resolve();
          await releaseStage.promise;
        }),
    );
    await stageReady.promise;

    const error = captureVeryfrontError(
      () =>
        runWithCacheKeyContext(
          scope,
          () => manager.register("live-skill", "live"),
        ),
    );
    assertEquals(error.slug, "service-overloaded");
    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("staged-skill"), undefined);
      assertEquals(manager.get("live-skill"), undefined);
    });

    releaseStage.resolve();
    await transaction;
    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("staged-skill"), "staged");
      assertEquals(manager.get("live-skill"), undefined);
    });
  });

  it("keeps the live registry visible until a staged replacement commits", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    runWithCacheKeyContext(scope, () => manager.register("old-skill", "old"));

    const stageReady = deferred<void>();
    const releaseStage = deferred<void>();
    const transaction = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.clear();
          manager.register("new-skill", "new");
          stageReady.resolve();
          await releaseStage.promise;
        }),
    );

    await stageReady.promise;
    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("old-skill"), "old");
      assertEquals(manager.get("new-skill"), undefined);
    });

    releaseStage.resolve();
    await transaction;

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("old-skill"), undefined);
      assertEquals(manager.get("new-skill"), "new");
    });
  });

  it("preserves a live registration that arrives while replacement is staged", async () => {
    const manager = new ProjectScopedRegistryManager<string>("agent");
    runWithCacheKeyContext(scope, () => manager.register("old-agent", "old"));

    const stageReady = deferred<void>();
    const releaseStage = deferred<void>();
    const transaction = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.clear();
          manager.register("discovered-agent", "discovered");
          stageReady.resolve();
          await releaseStage.promise;
        }),
    );

    await stageReady.promise;
    runWithCacheKeyContext(scope, () => manager.register("route-agent", "route"));

    releaseStage.resolve();
    await transaction;

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("old-agent"), undefined);
      assertEquals(manager.get("discovered-agent"), "discovered");
      assertEquals(manager.get("route-agent"), "route");
    });
  });

  it("makes journaled live registrations visible to the active transaction", async () => {
    const manager = new ProjectScopedRegistryManager<string>("agent");
    const liveWriteFinished = deferred<void>();
    const writeLive = deferred<void>();
    const liveWrite = runWithCacheKeyContext(scope, async () => {
      await writeLive.promise;
      manager.register("route-agent", "route");
      liveWriteFinished.resolve();
    });

    await runWithCacheKeyContext(scope, async () => {
      await runWithRegistryTransaction(async () => {
        manager.register("discovered-agent", "discovered");
        writeLive.resolve();
        await liveWriteFinished.promise;

        assertEquals(manager.get("route-agent"), "route");
        assertEquals(manager.getAll().get("route-agent"), "route");
      });
    });
    await liveWrite;

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("route-agent"), "route");
      assertEquals(manager.get("discovered-agent"), "discovered");
    });
  });

  it("preserves a live deletion that arrives while mutations are staged", async () => {
    const manager = new ProjectScopedRegistryManager<string>("agent");
    runWithCacheKeyContext(scope, () => {
      manager.register("deleted-agent", "old");
      manager.register("stable-agent", "stable");
    });

    const stageReady = deferred<void>();
    const releaseStage = deferred<void>();
    const transaction = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.register("discovered-agent", "discovered");
          stageReady.resolve();
          await releaseStage.promise;
        }),
    );

    await stageReady.promise;
    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.delete("deleted-agent"), true);
    });

    releaseStage.resolve();
    await transaction;

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("deleted-agent"), undefined);
      assertEquals(manager.get("stable-agent"), "stable");
      assertEquals(manager.get("discovered-agent"), "discovered");
    });
  });

  it("honors a live clear after a transaction stages the first item", async () => {
    const manager = new ProjectScopedRegistryManager<string>("agent");
    const stageReady = deferred<void>();
    const releaseStage = deferred<void>();
    const transaction = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.register("staged-agent", "staged");
          stageReady.resolve();
          await releaseStage.promise;
        }),
    );

    await stageReady.promise;
    runWithCacheKeyContext(scope, () => manager.clear());

    releaseStage.resolve();
    await transaction;

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("staged-agent"), undefined);
    });
  });

  it("serializes concurrent transactions for the same registry scope", async () => {
    const manager = new ProjectScopedRegistryManager<string>("agent");
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    let secondStarted = false;

    const first = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.register("first-agent", "first");
          firstStarted.resolve();
          await releaseFirst.promise;
        }),
    );
    await firstStarted.promise;

    const second = runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          secondStarted = true;
          manager.register("second-agent", "second");
        }),
    );
    await Promise.resolve();
    assertEquals(secondStarted, false);

    releaseFirst.resolve();
    await Promise.all([first, second]);

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("first-agent"), "first");
      assertEquals(manager.get("second-agent"), "second");
    });
  });

  it("bounds and drains the transaction queue for one scope", async () => {
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    let queuedTransactionsCompleted = 0;
    const runTransaction = (fn: () => Promise<void>) =>
      runWithCacheKeyContext(scope, () => runWithRegistryTransaction(fn));

    const first = runTransaction(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;

    const queued = Array.from(
      { length: 255 },
      () =>
        runTransaction(async () => {
          queuedTransactionsCompleted++;
        }),
    );
    const overflow = runTransaction(async () => {});
    releaseFirst.resolve();

    const error = await captureRejectedError(() => overflow, VeryfrontError);
    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, "service-overloaded");
    await Promise.all([first, ...queued]);
    assertEquals(queuedTransactionsCompleted, 255);

    await runTransaction(async () => {
      queuedTransactionsCompleted++;
    });
    assertEquals(queuedTransactionsCompleted, 256);
  });

  it("discards staged mutations when the transaction fails", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    runWithCacheKeyContext(scope, () => manager.register("stable-skill", "stable"));

    await assertRejects(
      () =>
        runWithCacheKeyContext(
          scope,
          () =>
            runWithRegistryTransaction(async () => {
              manager.clear();
              manager.register("partial-skill", "partial");
              throw new Error("discovery failed");
            }),
        ),
      Error,
      "discovery failed",
    );

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("stable-skill"), "stable");
      assertEquals(manager.get("partial-skill"), undefined);
    });
  });

  it("rolls back only the failed nested savepoint", async () => {
    const manager = new ProjectScopedRegistryManager<string>("savepoint");

    await runWithCacheKeyContext(scope, async () => {
      await runWithRegistryTransaction(async () => {
        manager.register("before", "kept");

        await assertRejects(
          () =>
            runWithRegistryTransactionSavepoint(async () => {
              manager.register("temporary", "discarded");
              throw new Error("module failed");
            }),
          Error,
          "module failed",
        );

        assertEquals(manager.get("before"), "kept");
        assertEquals(manager.get("temporary"), undefined);
        manager.register("after", "kept");
      });

      assertEquals(manager.get("before"), "kept");
      assertEquals(manager.get("temporary"), undefined);
      assertEquals(manager.get("after"), "kept");
    });
  });

  it("can discard successful sandbox mutations while returning the result", async () => {
    const manager = new ProjectScopedRegistryManager<string>("savepoint-sandbox");

    await runWithCacheKeyContext(scope, async () => {
      await runWithRegistryTransaction(async () => {
        manager.register("before", "kept");

        const result = await runWithRegistryTransactionSavepoint(
          async () => {
            manager.register("temporary", "discarded");
            return 42;
          },
          { rollbackOnSuccess: true },
        );

        assertEquals(result, 42);
        assertEquals(manager.get("before"), "kept");
        assertEquals(manager.get("temporary"), undefined);
        manager.register("after", "kept");
      });

      assertEquals(manager.get("before"), "kept");
      assertEquals(manager.get("temporary"), undefined);
      assertEquals(manager.get("after"), "kept");
    });
  });

  it("rejects detached mutations after a savepoint callback closes", async () => {
    const manager = new ProjectScopedRegistryManager<string>("savepoint-lifetime");
    const gate = deferred<void>();
    let detachedMutation!: Promise<void>;

    await runWithCacheKeyContext(scope, async () => {
      await runWithRegistryTransaction(async () => {
        await runWithRegistryTransactionSavepoint(async () => {
          detachedMutation = gate.promise.then(() => {
            manager.register("late", "must-not-publish");
          });
        });

        gate.resolve();
        await assertRejects(
          () => detachedMutation,
          VeryfrontError,
          "initialization context is closed",
        );
        assertEquals(manager.get("late"), undefined);
      });

      assertEquals(manager.get("late"), undefined);
    });
  });

  it("rejects detached savepoint mutations after the transaction commits", async () => {
    const manager = new ProjectScopedRegistryManager<string>("savepoint-lifetime");
    const gate = deferred<void>();
    let detachedMutation!: Promise<void>;

    await runWithCacheKeyContext(scope, async () => {
      await runWithRegistryTransaction(async () => {
        await runWithRegistryTransactionSavepoint(async () => {
          detachedMutation = gate.promise.then(() => {
            manager.register("late", "must-not-publish");
          });
        });
      });

      gate.resolve();
      await assertRejects(
        () => detachedMutation,
        VeryfrontError,
        "initialization context is closed",
      );
      assertEquals(manager.get("late"), undefined);
    });
  });

  it("rejects new registry transactions from a closed savepoint lineage", async () => {
    const gate = deferred<void>();
    let detachedTransaction!: Promise<void>;

    await runWithCacheKeyContext(scope, async () => {
      await runWithRegistryTransaction(async () => {
        await runWithRegistryTransactionSavepoint(async () => {
          detachedTransaction = gate.promise.then(async () => {
            await runWithRegistryTransaction(async () => {});
          });
        });
      });

      gate.resolve();
      await assertRejects(
        () => detachedTransaction,
        VeryfrontError,
        "initialization context is closed",
      );
    });
  });

  it("preserves a live write journaled while a savepoint rolls back", async () => {
    const manager = new ProjectScopedRegistryManager<string>("savepoint-live-write");
    const writeLive = deferred<void>();

    await runWithCacheKeyContext(scope, async () => {
      const liveWrite = writeLive.promise.then(() => {
        manager.register("live", "preserved");
      });

      await runWithRegistryTransaction(async () => {
        manager.register("before", "kept");
        await assertRejects(
          () =>
            runWithRegistryTransactionSavepoint(async () => {
              manager.register("temporary", "discarded");
              writeLive.resolve();
              await liveWrite;
              throw new Error("module failed");
            }),
          Error,
          "module failed",
        );

        assertEquals(manager.get("before"), "kept");
        assertEquals(manager.get("temporary"), undefined);
        assertEquals(manager.get("live"), "preserved");
      });

      assertEquals(manager.get("before"), "kept");
      assertEquals(manager.get("temporary"), undefined);
      assertEquals(manager.get("live"), "preserved");
    });
  });

  it("rejects project-wide clearing from inside a transaction", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    runWithCacheKeyContext(scope, () => {
      manager.registerShared("shared-skill", "shared");
      manager.register("stable-skill", "stable");
    });

    for (
      const clear of [
        () => manager.clearProject(scope.projectId),
        () => manager.clearAll(),
      ]
    ) {
      const error = await captureRejectedError(
        () =>
          runWithCacheKeyContext(
            scope,
            () => runWithRegistryTransaction(async () => clear()),
          ),
        VeryfrontError,
      );
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
    }

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("shared-skill"), "shared");
      assertEquals(manager.get("stable-skill"), "stable");
    });
  });

  it("rejects registry access after a nested context changes tenant scope", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");

    const originalScopeCanary = "PRIVATE_ORIGINAL_SCOPE_CANARY";
    const nestedScopeCanary = "PRIVATE_NESTED_SCOPE_CANARY";

    const error = await captureRejectedError(
      () =>
        runWithCacheKeyContext(
          { projectId: originalScopeCanary, mode: "preview", versionId: "main" },
          () =>
            runWithRegistryTransaction(async () => {
              manager.register("project-skill", "stable");
              await runWithCacheKeyContext(
                { projectId: nestedScopeCanary, mode: "preview", versionId: "main" },
                async () => {
                  manager.get("project-skill");
                },
              );
            }),
        ),
      Error,
      "Registry scope changed during transaction",
    );
    assertEquals(error.message.includes(originalScopeCanary), false);
    assertEquals(error.message.includes(nestedScopeCanary), false);

    runWithCacheKeyContext(
      { projectId: originalScopeCanary, mode: "preview", versionId: "main" },
      () => {
        assertEquals(manager.get("project-skill"), undefined);
      },
    );
  });

  it("routes async descendant writes to the live registry after commit", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    const lateWrite = deferred<void>();

    await runWithCacheKeyContext(
      scope,
      () =>
        runWithRegistryTransaction(async () => {
          manager.register("committed-skill", "committed");
          setTimeout(() => {
            try {
              manager.clear();
              manager.register("late-skill", "late");
              lateWrite.resolve();
            } catch (error) {
              lateWrite.reject(error);
            }
          }, 0);
        }),
    );
    await lateWrite.promise;

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("committed-skill"), undefined);
      assertEquals(manager.get("late-skill"), "late");
    });
  });

  it("rejects async descendant writes after the transaction aborts", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    const gate = deferred<void>();
    let detachedMutation!: Promise<void>;

    await assertRejects(
      () =>
        runWithCacheKeyContext(
          scope,
          () =>
            runWithRegistryTransaction(async () => {
              detachedMutation = gate.promise.then(() => {
                manager.register("late-skill", "must-not-publish");
              });
              throw new Error("transaction failed");
            }),
        ),
      Error,
      "transaction failed",
    );

    gate.resolve();
    await assertRejects(
      () => detachedMutation,
      VeryfrontError,
      "transaction is already aborted",
    );
    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("late-skill"), undefined);
    });
  });
});

// Hardening identified while investigating veryfront/veryfront-api#3952.
// The issue itself had invalid skill metadata and release-pinned requests, so
// this registry race was not its deterministic cause.
// Control-plane runs with agentSource.type === "environment" and no releaseId
// produce a request context with { productionMode: true, releaseId: null }.
// tryGetCacheKeyContext() returns null for this context (no stable distributed
// cache key without a releaseId), so buildRegistryScopeId() collapsed to
// "__default__", a single shared scope for every project. Concurrent
// requests' skillRegistry.clear() calls stomped each other's skills, producing
// "Skill not found. Available skills: none" when load_skill executed.
describe("concurrent environment-source runs with no releaseId", () => {
  it("skills registered by project-x must survive project-y discovery clear", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");

    // Request A: project-x, environment source, no releaseId
    // (mirrors withAgentSourceContext options for type === "environment")
    await runWithRequestContext(
      {
        projectSlug: "project-x",
        projectId: "proj-x",
        token: "tok-a",
        productionMode: true,
        releaseId: null,
        environmentName: "Development",
      },
      async () => {
        manager.clear();
        manager.register("oncall-triage", "skill-x");
        assertEquals(
          manager.getAll().size,
          1,
          "project-x skill must be registered in its own scope",
        );

        // Concurrent request B (different project) runs discovery. Its clear()
        // must not wipe project-x's scope.
        await runWithRequestContext(
          {
            projectSlug: "project-y",
            projectId: "proj-y",
            token: "tok-b",
            productionMode: true,
            releaseId: null,
            environmentName: "Production",
          },
          async () => {
            manager.clear();
          },
        );

        assertEquals(
          manager.getAll().size,
          1,
          "project-x skill must survive project-y's discovery clear",
        );
      },
    );
  });
});
