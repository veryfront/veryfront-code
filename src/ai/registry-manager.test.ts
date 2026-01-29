import { describe, it } from "@veryfront/testing/bdd";
import { assert, assertEquals } from "@veryfront/testing/assert";
import { ProjectScopedRegistryManager } from "./registry-manager.ts";

describe("ProjectScopedRegistryManager", () => {
  describe("constructor", () => {
    it("should create a registry with a given name", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      // Registry starts empty
      assertEquals(manager.getAllIds(), []);
    });
  });

  describe("register / get", () => {
    it("should register and retrieve an item", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("my-tool", "tool-value");
      assertEquals(manager.get("my-tool"), "tool-value");
    });

    it("should return undefined for unregistered items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      assertEquals(manager.get("nonexistent"), undefined);
    });

    it("should overwrite an existing item with the same id", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("my-tool", "first");
      manager.register("my-tool", "second");
      assertEquals(manager.get("my-tool"), "second");
    });

    it("should handle complex object values", () => {
      const manager = new ProjectScopedRegistryManager<{ name: string; version: number }>("agent");
      const agent = { name: "test-agent", version: 2 };
      manager.register("agent-1", agent);
      assertEquals(manager.get("agent-1"), agent);
    });
  });

  describe("registerShared / get fallback", () => {
    it("should register and retrieve a shared item", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-tool", "shared-value");
      assertEquals(manager.get("shared-tool"), "shared-value");
    });

    it("should overwrite an existing shared item", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-tool", "first");
      manager.registerShared("shared-tool", "second");
      assertEquals(manager.get("shared-tool"), "second");
    });

    it("should prefer project-specific item over shared item", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("tool-x", "shared-version");
      manager.register("tool-x", "project-version");
      assertEquals(manager.get("tool-x"), "project-version");
    });

    it("should fall back to shared when project item not found", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-only", "shared-value");
      // No project-level registration for "shared-only"
      assertEquals(manager.get("shared-only"), "shared-value");
    });
  });

  describe("has", () => {
    it("should return true for registered project items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("item-a", "value-a");
      assert(manager.has("item-a"));
    });

    it("should return true for shared items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "value-a");
      assert(manager.has("shared-a"));
    });

    it("should return false for missing items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      assertEquals(manager.has("missing"), false);
    });
  });

  describe("getAllIds", () => {
    it("should return empty array when nothing registered", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      assertEquals(manager.getAllIds(), []);
    });

    it("should return project item ids", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("a", "1");
      manager.register("b", "2");
      const ids = manager.getAllIds();
      assert(ids.includes("a"));
      assert(ids.includes("b"));
      assertEquals(ids.length, 2);
    });

    it("should include shared ids", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "1");
      manager.register("proj-a", "2");
      const ids = manager.getAllIds();
      assert(ids.includes("shared-a"));
      assert(ids.includes("proj-a"));
      assertEquals(ids.length, 2);
    });

    it("should deduplicate ids when project overrides shared", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("tool-x", "shared");
      manager.register("tool-x", "project");
      const ids = manager.getAllIds();
      assertEquals(ids.length, 1);
      assertEquals(ids[0], "tool-x");
    });
  });

  describe("getAll", () => {
    it("should return empty map when nothing registered", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      assertEquals(manager.getAll().size, 0);
    });

    it("should return both shared and project items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "sv");
      manager.register("proj-a", "pv");
      const all = manager.getAll();
      assertEquals(all.get("shared-a"), "sv");
      assertEquals(all.get("proj-a"), "pv");
      assertEquals(all.size, 2);
    });

    it("should let project items override shared items with same id", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("tool-x", "shared");
      manager.register("tool-x", "project");
      const all = manager.getAll();
      assertEquals(all.get("tool-x"), "project");
      assertEquals(all.size, 1);
    });
  });

  describe("delete", () => {
    it("should delete a registered project item", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("item", "value");
      const result = manager.delete("item");
      assertEquals(result, true);
      assertEquals(manager.get("item"), undefined);
    });

    it("should return false when deleting a non-existent item", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      assertEquals(manager.delete("missing"), false);
    });

    it("should not delete shared items via delete", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "value");
      // delete only targets project registry
      const result = manager.delete("shared-a");
      assertEquals(result, false);
      // shared item is still accessible
      assertEquals(manager.get("shared-a"), "value");
    });

    it("should return false when project has no registry yet", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      // No register calls at all - no project registry exists
      assertEquals(manager.delete("anything"), false);
    });
  });

  describe("clear", () => {
    it("should clear all project items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("a", "1");
      manager.register("b", "2");
      manager.clear();
      assertEquals(manager.getAllIds().filter((id) => id === "a" || id === "b").length, 0);
    });

    it("should not clear shared items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "value");
      manager.register("proj-a", "value");
      manager.clear();
      assertEquals(manager.get("shared-a"), "value");
      assertEquals(manager.get("proj-a"), undefined);
    });
  });

  describe("clearProject", () => {
    it("should clear a specific project's registry", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      // Register in default project
      manager.register("item", "value");
      // clearProject with the default project ID
      manager.clearProject("__default__");
      assertEquals(manager.get("item"), undefined);
    });

    it("should not affect other projects or shared items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "sv");
      manager.register("proj-a", "pv");
      // Clear a different project
      manager.clearProject("other-project");
      assertEquals(manager.get("shared-a"), "sv");
      assertEquals(manager.get("proj-a"), "pv");
    });
  });

  describe("clearAll", () => {
    it("should clear all project and shared registries", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("shared-a", "sv");
      manager.register("proj-a", "pv");
      manager.clearAll();
      assertEquals(manager.get("shared-a"), undefined);
      assertEquals(manager.get("proj-a"), undefined);
      assertEquals(manager.getAllIds(), []);
    });
  });

  describe("getStats", () => {
    it("should return zero stats for empty registry", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      const stats = manager.getStats();
      assertEquals(stats.projectCount, 0);
      assertEquals(stats.sharedCount, 0);
      assertEquals(stats.totalItems, 0);
      assertEquals(stats.currentProjectItems, 0);
    });

    it("should count project items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("a", "1");
      manager.register("b", "2");
      const stats = manager.getStats();
      assertEquals(stats.projectCount, 1); // one project (__default__)
      assertEquals(stats.currentProjectItems, 2);
      assertEquals(stats.totalItems, 2);
    });

    it("should count shared items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.registerShared("s1", "v1");
      manager.registerShared("s2", "v2");
      const stats = manager.getStats();
      assertEquals(stats.sharedCount, 2);
      assertEquals(stats.totalItems, 2);
    });

    it("should count both project and shared items", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("p1", "v1");
      manager.registerShared("s1", "v2");
      const stats = manager.getStats();
      assertEquals(stats.projectCount, 1);
      assertEquals(stats.sharedCount, 1);
      assertEquals(stats.totalItems, 2);
      assertEquals(stats.currentProjectItems, 1);
    });

    it("should reflect stats after clear", () => {
      const manager = new ProjectScopedRegistryManager<string>("tool");
      manager.register("a", "1");
      manager.registerShared("s", "2");
      manager.clearAll();
      const stats = manager.getStats();
      assertEquals(stats.projectCount, 0);
      assertEquals(stats.sharedCount, 0);
      assertEquals(stats.totalItems, 0);
      assertEquals(stats.currentProjectItems, 0);
    });
  });
});
