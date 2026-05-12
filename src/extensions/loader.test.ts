import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension loader tests — topological sort and lifecycle management.
 *
 * @module extensions/loader.test
 */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ExtensionLoader } from "./loader.ts";
import { reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";

function makeResolved(
  ext: Extension,
  source: ExtensionSource = "config",
): ResolvedExtension {
  return { extension: ext, source, origin: ext.name };
}

function makeExt(name: string, overrides: Partial<Extension> = {}): Extension {
  return { name, version: "1.0.0", capabilities: [], ...overrides };
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("ExtensionLoader", () => {
  afterEach(() => {
    reset();
  });

  describe("topologicalSort()", () => {
    it("should sort providers before consumers", () => {
      const provider = makeExt("provider", { provides: { CacheStore: {} } });
      const consumer = makeExt("consumer", {
        capabilities: [{ type: "contract", name: "CacheStore" }],
      });

      const loader = new ExtensionLoader(noopLogger);
      const sorted = loader.topologicalSort([
        makeResolved(consumer),
        makeResolved(provider),
      ]);

      assertEquals(sorted[0]?.extension.name, "provider");
      assertEquals(sorted[1]?.extension.name, "consumer");
    });

    it("should keep original order when no dependencies exist", () => {
      const a = makeExt("alpha");
      const b = makeExt("beta");

      const loader = new ExtensionLoader(noopLogger);
      const sorted = loader.topologicalSort([makeResolved(a), makeResolved(b)]);
      assertEquals(sorted[0]?.extension.name, "alpha");
      assertEquals(sorted[1]?.extension.name, "beta");
    });

    it("should handle duplicate extension names without false circular error", () => {
      const ext = makeExt("shared");
      const loader = new ExtensionLoader(noopLogger);
      const sorted = loader.topologicalSort([
        makeResolved(ext),
        makeResolved(ext),
      ]);
      assertEquals(sorted.length, 1);
      assertEquals(sorted[0]?.extension.name, "shared");
    });

    it("should throw on circular dependencies", () => {
      const a = makeExt("ext-a", {
        provides: { A: {} },
        capabilities: [{ type: "contract", name: "B" }],
      });
      const b = makeExt("ext-b", {
        provides: { B: {} },
        capabilities: [{ type: "contract", name: "A" }],
      });

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.topologicalSort([makeResolved(a), makeResolved(b)]),
        Error,
        "Circular",
      );
    });
  });

  describe("setupAll()", () => {
    it("should call setup() on each extension in order", async () => {
      const order: string[] = [];
      const a = makeExt("ext-a", {
        setup: () => {
          order.push("a");
        },
      });
      const b = makeExt("ext-b", {
        setup: () => {
          order.push("b");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(a), makeResolved(b)], {});
      assertEquals(order, ["a", "b"]);
    });

    it("should teardown previous extensions when called twice", async () => {
      const order: string[] = [];
      const ext = makeExt("ext-a", {
        setup: () => {
          order.push("setup");
        },
        teardown: () => {
          order.push("teardown");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(ext)], {});
      await loader.setupAll([makeResolved(ext)], {});
      assertEquals(order, ["setup", "teardown", "setup"]);
    });

    it("should throw on contract conflicts", async () => {
      const a = makeExt("ext-a", { provides: { Bundler: {} } });
      const b = makeExt("ext-b", { provides: { Bundler: {} } });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(a), makeResolved(b)], {}),
        Error,
        "Extension conflicts",
      );
    });

    it("should register static provides before calling setup()", async () => {
      let resolved: unknown;
      const provider = makeExt("provider", {
        provides: { CacheStore: { id: "redis" } },
      });
      const consumer = makeExt("consumer", {
        setup: (ctx) => {
          resolved = ctx.get("CacheStore");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(provider), makeResolved(consumer)], {});
      assertEquals((resolved as { id: string }).id, "redis");
    });
  });

  describe("teardownAll()", () => {
    it("should call teardown() in reverse order", async () => {
      const order: string[] = [];
      const a = makeExt("ext-a", {
        teardown: () => {
          order.push("a");
        },
      });
      const b = makeExt("ext-b", {
        teardown: () => {
          order.push("b");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(a), makeResolved(b)], {});
      await loader.teardownAll();
      assertEquals(order, ["b", "a"]);
    });
  });

  describe("flattenPresets()", () => {
    it("should expand extensions with extends arrays", () => {
      const child1 = makeExt("child1");
      const child2 = makeExt("child2");
      const preset = makeExt("preset", { extends: [child1, child2] });

      const loader = new ExtensionLoader(noopLogger);
      const flat = loader.flattenPresets([makeResolved(preset)]);
      assertEquals(flat.length, 2);
      assertEquals(flat[0]?.extension.name, "child1");
      assertEquals(flat[1]?.extension.name, "child2");
    });

    it("should recursively flatten nested presets", () => {
      const leaf = makeExt("leaf");
      const innerPreset = makeExt("inner-preset", { extends: [leaf] });
      const outerPreset = makeExt("outer-preset", { extends: [innerPreset] });

      const loader = new ExtensionLoader(noopLogger);
      const flat = loader.flattenPresets([makeResolved(outerPreset)]);
      assertEquals(flat.length, 1);
      assertEquals(flat[0]?.extension.name, "leaf");
    });

    it("should keep non-preset extensions as-is", () => {
      const ext = makeExt("standalone");
      const loader = new ExtensionLoader(noopLogger);
      const flat = loader.flattenPresets([makeResolved(ext)]);
      assertEquals(flat.length, 1);
      assertEquals(flat[0]?.extension.name, "standalone");
    });

    it("should throw controlled error on cyclic extends (A -> B -> A)", () => {
      const a = makeExt("ext-a");
      const b = makeExt("ext-b", { extends: [a] });
      a.extends = [b];

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.flattenPresets([makeResolved(a)]),
        Error,
        "Circular preset extends",
      );
    });

    it("should throw on self-referential extends (A -> A)", () => {
      const a = makeExt("ext-a");
      a.extends = [a];

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.flattenPresets([makeResolved(a)]),
        Error,
        "Circular preset extends",
      );
    });

    it("should accept diamond graph with shared leaf (not a cycle)", () => {
      const leaf = makeExt("leaf");
      const preset = makeExt("preset", { extends: [leaf, leaf] });

      const loader = new ExtensionLoader(noopLogger);
      const flat = loader.flattenPresets([makeResolved(preset)]);
      assertEquals(flat.length, 2);
      assertEquals(flat[0]?.extension.name, "leaf");
      assertEquals(flat[1]?.extension.name, "leaf");
    });
  });

  describe("setupAll() — source priority on register()", () => {
    it("should register the higher-priority provider's impl when two sources provide the same contract", async () => {
      const configProvider = makeExt("config-cache", {
        provides: { Cache: { id: "config-impl" } },
      });
      const packageProvider = makeExt("package-cache", {
        provides: { Cache: { id: "package-impl" } },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll(
        [
          makeResolved(configProvider, "config"),
          makeResolved(packageProvider, "package"),
        ],
        {},
      );

      assertEquals((tryResolve("Cache") as { id: string }).id, "config-impl");
    });

    it("should win regardless of iteration order (lower-priority first)", async () => {
      const configProvider = makeExt("config-cache", {
        provides: { Cache: { id: "config-impl" } },
      });
      const projectProvider = makeExt("project-cache", {
        provides: { Cache: { id: "project-impl" } },
      });

      const loader = new ExtensionLoader(noopLogger);
      // Pass project first to prove order-insensitivity.
      await loader.setupAll(
        [
          makeResolved(projectProvider, "project"),
          makeResolved(configProvider, "config"),
        ],
        {},
      );

      assertEquals((tryResolve("Cache") as { id: string }).id, "config-impl");
    });
  });

  describe("setupAll() — rollback on setup failure", () => {
    it("should teardown previously-loaded extensions when a later setup throws", async () => {
      const order: string[] = [];
      const a = makeExt("ext-a", {
        setup: () => {
          order.push("a-setup");
        },
        teardown: () => {
          order.push("a-teardown");
        },
      });
      const b = makeExt("ext-b", {
        setup: () => {
          throw new Error("boom");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(a), makeResolved(b)], {}),
        Error,
        "boom",
      );
      assertEquals(order, ["a-setup", "a-teardown"]);
    });

    it("should call teardown() on the failing extension (best-effort)", async () => {
      const order: string[] = [];
      const failing = makeExt("failing", {
        setup: () => {
          order.push("setup");
          throw new Error("boom");
        },
        teardown: () => {
          order.push("teardown");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(failing)], {}),
        Error,
        "boom",
      );
      assertEquals(order, ["setup", "teardown"]);
    });

    it("should clear the contract registry so failed provides do not leak", async () => {
      const a = makeExt("ext-a", {
        provides: { Cache: { id: "a-impl" } },
      });
      const failing = makeExt("failing", {
        setup: () => {
          throw new Error("boom");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(a), makeResolved(failing)], {}),
        Error,
        "boom",
      );
      assertEquals(tryResolve("Cache"), undefined);
    });

    it("should not throw when failing extension has no teardown hook", async () => {
      const failing = makeExt("failing", {
        setup: () => {
          throw new Error("boom");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(failing)], {}),
        Error,
        "boom",
      );
    });
  });
});

describe("ExtensionLoader primeContracts", () => {
  it("applies primed contracts after teardownAll so extensions can resolve them", async () => {
    const loader = new ExtensionLoader(noopLogger);
    const marker = { hello: "world" };
    loader.primeContracts({ Primed: marker });

    let observed: unknown = "unobserved";
    const resolved: ResolvedExtension = {
      source: "local-file",
      origin: "virtual://t",
      extension: {
        name: "t-ext",
        version: "0.0.1",
        capabilities: [],
        setup(ctx) {
          observed = ctx.require("Primed");
        },
      },
    };
    await loader.setupAll([resolved], {});
    assertEquals(observed, marker);
    assertEquals(resolveContract("Primed"), marker);
  });
});
