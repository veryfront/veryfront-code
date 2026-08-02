import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ProjectScopedRegistryManager } from "./project-scoped-registry-manager.ts";
import { ScopedRegistryFacade } from "./scoped-registry-facade.ts";

describe("ScopedRegistryFacade", () => {
  it("preserves the manager's scoped and shared registry contract", () => {
    const manager = new ProjectScopedRegistryManager<string>("test");
    const registry = new ScopedRegistryFacade(manager);

    registry.registerShared("shared", "shared-value");
    registry.registerShared("shadowed", "shared-shadowed-value");
    registry.register("project", "project-value");
    registry.register("shadowed", "project-shadowed-value");

    assertEquals(registry.get("shared"), "shared-value");
    assertEquals(registry.get("shadowed"), "project-shadowed-value");
    assertEquals(registry.getOwn("shared"), undefined);
    assertEquals(registry.getOwn("project"), "project-value");
    assertEquals(registry.has("project"), true);
    assertEquals(new Set(registry.getAllIds()), new Set(["shared", "shadowed", "project"]));
    assertEquals(
      registry.getAll(),
      new Map([
        ["shared", "shared-value"],
        ["shadowed", "project-shadowed-value"],
        ["project", "project-value"],
      ]),
    );
    assertEquals(registry.getStats(), {
      projectCount: 1,
      sharedCount: 2,
      totalItems: 4,
      currentProjectItems: 2,
    });

    assertEquals(registry.delete("project"), true);
    registry.clear();
    assertEquals(registry.get("shadowed"), "shared-shadowed-value");

    registry.clearAll();
    assertEquals(registry.getAll(), new Map());
  });
});
