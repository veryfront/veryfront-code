import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension loader tests: topological sort and lifecycle management.
 *
 * @module extensions/loader.test
 */

import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { ExtensionLoader } from "./loader.ts";
import { register, reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
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

afterEach(() => {
  reset();
});

describe("ExtensionLoader", () => {
  describe("topologicalSort()", () => {
    it("should sort providers before consumers", () => {
      const provider = makeExt("provider", { provides: { CacheStore: {} } });
      const consumer = makeExt("consumer", {
        contracts: { requires: ["CacheStore"] },
      });

      const loader = new ExtensionLoader(noopLogger);
      const sorted = loader.topologicalSort([
        makeResolved(consumer),
        makeResolved(provider),
      ]);

      assertEquals(sorted[0]?.extension.name, "provider");
      assertEquals(sorted[1]?.extension.name, "consumer");
    });

    it("sorts dynamic contract providers before explicit requires", () => {
      const provider = makeExt("provider", {
        contracts: { provides: ["CacheStore"] },
        setup: (ctx) => ctx.provide("CacheStore", { id: "dynamic" }),
      });
      const consumer = makeExt("consumer", {
        contracts: { requires: ["CacheStore"] },
        setup: (ctx) => ctx.require("CacheStore"),
      });

      const loader = new ExtensionLoader(noopLogger);
      const sorted = loader.topologicalSort([
        makeResolved(consumer),
        makeResolved(provider),
      ]);

      assertEquals(sorted.map((entry) => entry.extension.name), [
        "provider",
        "consumer",
      ]);
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

    it("rejects distinct extensions with the same name", () => {
      const loader = new ExtensionLoader(noopLogger);

      assertThrows(
        () =>
          loader.topologicalSort([
            makeResolved(makeExt("shared")),
            makeResolved(makeExt("shared")),
          ]),
        Error,
        "Duplicate extension name",
      );
    });

    it("should throw on circular dependencies", () => {
      const a = makeExt("ext-a", {
        provides: { A: {} },
        contracts: { requires: ["B"] },
      });
      const b = makeExt("ext-b", {
        provides: { B: {} },
        contracts: { requires: ["A"] },
      });

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.topologicalSort([makeResolved(a), makeResolved(b)]),
        Error,
        "Circular",
      );
    });

    it("contains hostile direct lifecycle helper inputs", () => {
      const loader = new ExtensionLoader(noopLogger);
      for (const operation of ["flattenPresets", "topologicalSort"] as const) {
        const revoked = Proxy.revocable([], {});
        revoked.revoke();
        let error: unknown;
        try {
          loader[operation](revoked.proxy as ResolvedExtension[]);
        } catch (caught) {
          error = caught;
        }
        assertEquals(error instanceof VeryfrontError, true);
        assertEquals(String(error).includes("revoked"), false);

        const revokedExtension = Proxy.revocable({}, {});
        revokedExtension.revoke();
        error = undefined;
        try {
          loader[operation]([{
            extension: revokedExtension.proxy as Extension,
            source: "config",
            origin: "hostile",
          }]);
        } catch (caught) {
          error = caught;
        }
        assertEquals(error instanceof VeryfrontError, true);
        assertEquals(String(error).includes("revoked"), false);
      }
    });
  });

  describe("setupAll()", () => {
    it("snapshots extension manifests before queued lifecycle work starts", async () => {
      const originalContract = { owner: "original" };
      const events: string[] = [];
      const config = { marker: "original" };
      const extension = makeExt("original", {
        provides: { StableContract: originalContract },
        setup: (context) => {
          events.push(`original:${context.config.marker}`);
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const setup = loader.setupAll([makeResolved(extension)], config);
      extension.name = "mutated";
      extension.provides = { StableContract: { owner: "mutated" } };
      extension.setup = () => {
        events.push("mutated");
      };
      config.marker = "mutated";
      await setup;

      assertEquals(events, ["original:original"]);
      assertEquals(resolveContract("StableContract"), originalContract);
    });

    it("reads stateful manifest fields once at the setup boundary", async () => {
      let nameReads = 0;
      let capabilityTypeReads = 0;
      const capability = {} as { type: string };
      Object.defineProperty(capability, "type", {
        enumerable: true,
        get() {
          capabilityTypeReads++;
          return "fs:read";
        },
      });
      const extension = {
        version: "1.0.0",
        capabilities: [capability],
      } as Extension;
      Object.defineProperty(extension, "name", {
        enumerable: true,
        get() {
          nameReads++;
          return "stateful";
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        { extension, source: "config", origin: "stateful" },
      ], {});

      assertEquals(nameReads, 1);
      assertEquals(capabilityTypeReads, 1);
    });

    it("rejects malformed resolved entries and project config without leaking hostile errors", async () => {
      const canary = "private-resolved-entry";
      const hostile = new Proxy({}, {
        get() {
          throw new Error(canary);
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const resolvedError = await assertRejects(
        () => loader.setupAll([hostile as ResolvedExtension], {}),
        Error,
        "Resolved extension",
      );
      assert(resolvedError instanceof Error);
      assertEquals(resolvedError.message.includes(canary), false);
      await assertRejects(
        () => loader.setupAll([], null as unknown as Record<string, unknown>),
        Error,
        "Project config",
      );
    });

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

    it("does not treat one extension's static and declared contract as two providers", async () => {
      const provider = makeExt("provider", {
        contracts: { provides: ["Bundler"] },
        provides: { Bundler: { id: "bundler" } },
      });
      const loader = new ExtensionLoader(noopLogger);

      await loader.setupAll([makeResolved(provider)], {});
      assertEquals(tryResolve("Bundler"), { id: "bundler" });
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

    it("should order setup by explicit contract metadata", async () => {
      const order: string[] = [];
      const provider = makeExt("provider", {
        contracts: { provides: ["CacheStore"] },
        setup: (ctx) => {
          order.push("provider");
          ctx.provide("CacheStore", { id: "dynamic" });
        },
      });
      const consumer = makeExt("consumer", {
        contracts: { requires: ["CacheStore"] },
        setup: (ctx) => {
          const cache = ctx.require<{ id: string }>("CacheStore");
          order.push(`consumer:${cache.id}`);
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(consumer), makeResolved(provider)], {});

      assertEquals(order, ["provider", "consumer:dynamic"]);
    });

    it("rolls back earlier extensions when a later extension is invalid", async () => {
      let teardownCalls = 0;
      const provider = makeExt("provider", {
        provides: { CacheStore: { id: "memory" } },
        teardown: () => {
          teardownCalls++;
        },
      });
      const invalid = {
        name: "invalid",
        version: "1.0.0",
        capabilities: [],
        setup: "not-a-function",
      } as unknown as Extension;

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(invalid)], {}),
        Error,
        "setup must be a function",
      );

      assertEquals(teardownCalls, 0);
      assertEquals(tryResolve("CacheStore"), undefined);
    });

    it("does not let logger failures mask a successful lifecycle", async () => {
      const throwingLogger = {
        debug: () => {
          throw new Error("logger-failure");
        },
        info: () => {
          throw new Error("logger-failure");
        },
        warn: () => {
          throw new Error("logger-failure");
        },
        error: () => {
          throw new Error("logger-failure");
        },
      };
      const extension = makeExt("logged", {
        capabilities: [{ type: "fs:read", paths: ["/private/path"] }],
        provides: { LoggedContract: { ok: true } },
      });

      const loader = new ExtensionLoader(throwingLogger);
      await loader.setupAll([makeResolved(extension)], {});
      assertEquals(tryResolve("LoggedContract"), { ok: true });
      await loader.teardownAll();
    });

    it("preserves structured logger arguments supplied by extensions", async () => {
      const records: unknown[][] = [];
      const logger = {
        debug: (...args: unknown[]) => records.push(args),
        info: (...args: unknown[]) => records.push(args),
        warn: (...args: unknown[]) => records.push(args),
        error: (...args: unknown[]) => records.push(args),
      };
      const extension = makeExt("structured-logger", {
        setup: (ctx) => {
          ctx.logger.info("extension message", { attempt: 1 });
        },
      });

      const loader = new ExtensionLoader(logger);
      await loader.setupAll([makeResolved(extension)], {});

      assertEquals(
        records.some((args) =>
          args[0] === "extension message" &&
          (args[1] as { attempt?: number } | undefined)?.attempt === 1
        ),
        true,
      );
    });
  });

  describe("setupAll(): setup timeout", () => {
    it("rejects invalid timeout values before setup starts", async () => {
      for (const setupTimeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        let setupCalls = 0;
        const extension = makeExt("invalid-timeout", {
          setup: () => {
            setupCalls++;
          },
        });
        const loader = new ExtensionLoader(noopLogger);

        await assertRejects(
          () => loader.setupAll([makeResolved(extension)], {}, { setupTimeoutMs }),
          Error,
          "non-negative safe integer",
        );
        assertEquals(setupCalls, 0);
      }

      const canary = "private-timeout-option";
      const hostileOptions = new Proxy({}, {
        get() {
          throw new Error(canary);
        },
      });
      const error = await assertRejects(
        () =>
          new ExtensionLoader(noopLogger).setupAll(
            [],
            {},
            hostileOptions as { setupTimeoutMs?: number },
          ),
        Error,
        "options",
      );
      assert(error instanceof Error);
      assertEquals(error.message.includes(canary), false);

      const revokedOptions = Proxy.revocable({}, {});
      revokedOptions.revoke();
      await assertRejects(
        () =>
          new ExtensionLoader(noopLogger).setupAll(
            [],
            {},
            revokedOptions.proxy,
          ),
        Error,
        "options",
      );

      const revokedTeardownOptions = Proxy.revocable({}, {});
      revokedTeardownOptions.revoke();
      await assertRejects(
        () => new ExtensionLoader(noopLogger).teardownAll(revokedTeardownOptions.proxy),
        Error,
        "options",
      );
    });

    it("should throw a timeout error when setup() never resolves within the configured timeout", async () => {
      const hanging = makeExt("hanging", {
        setup: () => new Promise<void>(() => {}), // never resolves
      });

      const loader = new ExtensionLoader(noopLogger);
      const err = await assertRejects(
        () => loader.setupAll([makeResolved(hanging)], {}, { setupTimeoutMs: 50 }),
        Error,
        "hanging",
      );
      assertEquals((err as { slug?: string }).slug, "extension-setup-timeout");
    });

    it("should include the timeout value in the error message", async () => {
      const hanging = makeExt("slow-ext", {
        setup: () => new Promise<void>(() => {}),
      });

      const loader = new ExtensionLoader(noopLogger);
      const err = await assertRejects(
        () => loader.setupAll([makeResolved(hanging)], {}, { setupTimeoutMs: 75 }),
        Error,
      );
      assertEquals((err as Error).message.includes("75ms"), true);
    });

    it("should ignore provide() from a timed-out setup that resumes later", async () => {
      let capturedProvide: ((contract: string, impl: unknown) => void) | undefined;
      let capturedRequire: ((contract: string) => unknown) | undefined;
      let signal: AbortSignal | undefined;
      const hanging = makeExt("late-provider", {
        setup: (ctx) => {
          capturedProvide = ctx.provide;
          capturedRequire = ctx.require;
          signal = ctx.signal;
          return new Promise<void>(() => {}); // never resolves
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(hanging)], {}, { setupTimeoutMs: 50 }),
        Error,
        "late-provider",
      );

      // Simulate the losing setup promise resuming after rollback and trying
      // to mutate the contract registry through its stale context.
      capturedProvide?.("LateContract", { id: "poisoned" });
      assertEquals(tryResolve("LateContract"), undefined);
      assertEquals(signal?.aborted, true);
      assertThrows(
        () => capturedRequire?.("FutureContract"),
        Error,
        "no longer active",
      );
    });

    it("should rollback already-loaded extensions on timeout of a later one", async () => {
      const order: string[] = [];
      const a = makeExt("ext-a", {
        setup: () => {
          order.push("a-setup");
        },
        teardown: () => {
          order.push("a-teardown");
        },
      });
      const hanging = makeExt("hanging", {
        setup: () => new Promise<void>(() => {}),
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(a), makeResolved(hanging)], {}, { setupTimeoutMs: 50 }),
        Error,
        "hanging",
      );
      assertEquals(order, ["a-setup", "a-teardown"]);
    });

    it("should not time out when setup() completes within the limit", async () => {
      const fast = makeExt("fast", {
        setup: () => Promise.resolve(),
      });

      const loader = new ExtensionLoader(noopLogger);
      // Should not throw
      await loader.setupAll([makeResolved(fast)], {}, { setupTimeoutMs: 5_000 });
    });

    it("should disable timeout when setupTimeoutMs is 0", async () => {
      // A setup that takes longer than a tight timeout would catch,
      // but we call with 0 (disabled) so it must not throw.
      const slow = makeExt("slow", {
        setup: () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
      });

      const loader = new ExtensionLoader(noopLogger);
      // With a 5 ms timeout this would fail; with 0 (disabled) it must succeed.
      await loader.setupAll([makeResolved(slow)], {}, { setupTimeoutMs: 0 });
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

    it("continues teardown when one extension never settles", async () => {
      let earlierTeardownCalls = 0;
      const earlier = makeExt("earlier", {
        teardown: () => {
          earlierTeardownCalls++;
        },
      });
      const hanging = makeExt("hanging-teardown", {
        teardown: () => new Promise<void>(() => {}),
      });
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(earlier), makeResolved(hanging)], {});

      let guardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          loader.teardownAll({ teardownTimeoutMs: 20 }),
          new Promise<never>((_, reject) => {
            guardTimer = setTimeout(
              () => reject(new Error("teardown remained unbounded")),
              250,
            );
          }),
        ]);
      } finally {
        clearTimeout(guardTimer);
      }

      assertEquals(earlierTeardownCalls, 1);
    });

    it("aborts a cooperative teardown when its deadline expires", async () => {
      let observedSignal: AbortSignal | undefined;
      let observedPhase: string | undefined;
      const extension = makeExt("cooperative-teardown", {
        teardown: async (...args: unknown[]) => {
          const context = args[0] as {
            signal: AbortSignal;
            phase: string;
          };
          observedSignal = context.signal;
          observedPhase = context.phase;
          await new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      });
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(extension)], {});

      await loader.teardownAll({ teardownTimeoutMs: 5 });

      assertEquals(observedPhase, "shutdown");
      assertEquals(observedSignal?.aborted, true);
    });

    it("restores contracts that existed before the loader lifecycle", async () => {
      const baseline = { id: "baseline" };
      register("BaselineContract", baseline);
      const extension = makeExt("temporary", {
        provides: { TemporaryContract: { id: "temporary" } },
      });
      const loader = new ExtensionLoader(noopLogger);

      await loader.setupAll([makeResolved(extension)], {});
      await loader.teardownAll();

      assertEquals(tryResolve("BaselineContract"), baseline);
      assertEquals(tryResolve("TemporaryContract"), undefined);
    });

    it("aborts the setup context before running teardown", async () => {
      let signal: AbortSignal | undefined;
      let teardownSawAborted = false;
      const extension = makeExt("abort-aware", {
        setup: (ctx) => {
          signal = ctx.signal;
        },
        teardown: () => {
          teardownSawAborted = signal?.aborted === true;
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      await loader.setupAll([makeResolved(extension)], {});
      assertEquals(signal?.aborted, false);
      await loader.teardownAll();
      assertEquals(teardownSawAborted, true);
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

    it("rejects preset chains deeper than the lifecycle budget", () => {
      let extension = makeExt("leaf");
      for (let depth = 0; depth < 70; depth++) {
        extension = makeExt(`preset-${depth}`, { extends: [extension] });
      }

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.flattenPresets([makeResolved(extension)]),
        Error,
        "depth",
      );
    });

    it("rejects preset expansion beyond the flattened extension budget", () => {
      let extension = makeExt("leaf");
      for (let depth = 0; depth < 13; depth++) {
        extension = makeExt(`fanout-${depth}`, { extends: [extension, extension] });
      }

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.flattenPresets([makeResolved(extension)]),
        Error,
        "flatten",
      );
    });
  });

  describe("setupAll(): source priority on register()", () => {
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

    it("should keep dynamic ctx.provide() source priority order-insensitive", async () => {
      const configProvider = makeExt("config-cache", {
        contracts: { provides: ["Cache"] },
        setup: (ctx) => ctx.provide("Cache", { id: "config-impl" }),
      });
      const projectProvider = makeExt("project-cache", {
        contracts: { provides: ["Cache"] },
        setup: (ctx) => ctx.provide("Cache", { id: "project-impl" }),
      });

      const loader = new ExtensionLoader(noopLogger);
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

  describe("setupAll(): rollback on setup failure", () => {
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
      let teardownPhase: string | undefined;
      let teardownSignal: AbortSignal | undefined;
      const failing = makeExt("failing", {
        setup: () => {
          order.push("setup");
          throw new Error("boom");
        },
        teardown: (context) => {
          assert(context);
          teardownPhase = context.phase;
          teardownSignal = context.signal;
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
      assertEquals(teardownPhase, "rollback");
      assertEquals(teardownSignal?.aborted, true);
    });

    it("marks previously loaded extension teardown as rollback after setup failure", async () => {
      const phases: Array<string | undefined> = [];
      const loaded = makeExt("loaded", {
        teardown: (context) => {
          phases.push(context?.phase);
        },
      });
      const failing = makeExt("failing", {
        setup: () => {
          throw new Error("boom");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(loaded), makeResolved(failing)], {}),
        Error,
        "boom",
      );

      assertEquals(phases, ["rollback"]);
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
  it("snapshots primed contracts for each queued setup lifecycle", async () => {
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ Initial: { id: "initial" } });

    const setup = loader.setupAll([], {});
    loader.primeContracts({ Late: { id: "late" } });
    await setup;

    assertEquals(tryResolve("Initial"), { id: "initial" });
    assertEquals(tryResolve("Late"), undefined);

    await loader.setupAll([], {});
    assertEquals(tryResolve("Late"), { id: "late" });
  });

  it("rejects invalid contract snapshots without partially updating the prime set", async () => {
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ Existing: { id: "existing" } });

    assertThrows(
      () => loader.primeContracts({ Added: { id: "added" }, Invalid: undefined }),
      Error,
      "cannot be undefined",
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assertThrows(
      () => loader.primeContracts(revoked.proxy),
      Error,
      "Primed contracts must be an object",
    );

    await loader.setupAll([], {});
    assertEquals(tryResolve("Existing"), { id: "existing" });
    assertEquals(tryResolve("Added"), undefined);
  });

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

  it("removes primed contracts after an empty lifecycle", async () => {
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ PrimedOnly: { id: "prime" } });

    await loader.setupAll([], {});
    assertEquals(tryResolve("PrimedOnly"), { id: "prime" });
    await loader.teardownAll();
    assertEquals(tryResolve("PrimedOnly"), undefined);
  });
});

describe("ExtensionLoader lifecycle serialization", () => {
  it("serializes overlapping setup calls on one loader", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const first = makeExt("first", {
      setup: async () => {
        events.push("first:start");
        markFirstStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first:end");
      },
      teardown: () => {
        events.push("first:teardown");
      },
    });
    const second = makeExt("second", {
      setup: () => {
        events.push("second:setup");
      },
    });
    const loader = new ExtensionLoader(noopLogger);

    const firstSetup = loader.setupAll([makeResolved(first)], {}, { setupTimeoutMs: 0 });
    await firstStarted;
    const secondSetup = loader.setupAll([makeResolved(second)], {});
    await Promise.resolve();
    assertEquals(events, ["first:start"]);

    releaseFirst?.();
    await Promise.all([firstSetup, secondSetup]);
    assertEquals(events, [
      "first:start",
      "first:end",
      "first:teardown",
      "second:setup",
    ]);
  });

  it("replaces an active loader lifecycle without corrupting contracts", async () => {
    const first = new ExtensionLoader(noopLogger);
    const second = new ExtensionLoader(noopLogger);
    const firstContract = { owner: "first" };
    const secondContract = { owner: "second" };
    let firstTeardownCount = 0;

    await first.setupAll([
      makeResolved(makeExt("first", {
        provides: { SharedContract: firstContract },
        teardown: () => {
          firstTeardownCount++;
        },
      })),
    ], {});

    await second.setupAll([
      makeResolved(makeExt("second", { provides: { SharedContract: secondContract } })),
    ], {});
    assertEquals(firstTeardownCount, 1);
    assertEquals(resolveContract("SharedContract"), secondContract);

    await first.teardownAll();
    assertEquals(resolveContract("SharedContract"), secondContract);

    await second.teardownAll();
    assertEquals(tryResolve("SharedContract"), undefined);
  });
});
