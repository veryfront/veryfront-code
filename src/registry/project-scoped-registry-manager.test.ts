import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  ProjectScopedRegistryManager,
  runWithRegistryTransaction,
} from "./project-scoped-registry-manager.ts";

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
  });

  describe("delete", () => {
    it("should delete a registered project item", () => {
      const manager = createManager<string>("tool");
      manager.register("item", "value");

      assertEquals(manager.delete("item"), true);
      assertEquals(manager.get("item"), undefined);
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
  });
});

describe("ProjectScopedRegistryManager transactions", () => {
  const scope = { projectId: "project-transaction", mode: "preview" as const, versionId: "main" };

  it("keeps the live registry visible until a staged replacement commits", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    runWithCacheKeyContext(scope, () => manager.register("old-skill", "old"));

    const stageReady = Promise.withResolvers<void>();
    const releaseStage = Promise.withResolvers<void>();
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

  it("rejects registry access after a nested context changes tenant scope", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");

    await assertRejects(
      () =>
        runWithCacheKeyContext(
          scope,
          () =>
            runWithRegistryTransaction(async () => {
              manager.register("project-skill", "stable");
              await runWithCacheKeyContext(
                { projectId: "other-project", mode: "preview", versionId: "main" },
                async () => {
                  manager.get("project-skill");
                },
              );
            }),
        ),
      Error,
      "Registry scope changed during transaction",
    );

    runWithCacheKeyContext(scope, () => {
      assertEquals(manager.get("project-skill"), undefined);
    });
  });

  it("routes async descendant writes to the live registry after commit", async () => {
    const manager = new ProjectScopedRegistryManager<string>("skill");
    const lateWrite = Promise.withResolvers<void>();

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
});

// Hardening identified while investigating veryfront/veryfront-api#3952.
// The issue itself had invalid skill metadata and release-pinned requests, so
// this registry race was not its deterministic cause.
// Control-plane runs with agentSource.type === "environment" and no releaseId
// produce a request context with { productionMode: true, releaseId: null }.
// tryGetCacheKeyContext() returns null for this context (no stable distributed
// cache key without a releaseId), so buildRegistryScopeId() collapsed to
// "__default__" — a single shared scope for every project. Concurrent
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

        // Concurrent request B (different project) runs discovery — its clear()
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
