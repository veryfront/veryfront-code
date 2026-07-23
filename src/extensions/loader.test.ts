import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension loader tests — topological sort and lifecycle management.
 *
 * @module extensions/loader.test
 */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ExtensionLoader } from "./loader.ts";
import { register, reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import type { Extension, ExtensionContext, ExtensionSource, ResolvedExtension } from "./types.ts";

type AbortAwareExtensionContext = ExtensionContext & {
  readonly signal?: AbortSignal;
};

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

    it("keeps the higher-priority extension when a preset child reuses its name", () => {
      const configExtension = makeExt("shared");
      const projectExtension = makeExt("shared");
      const projectPreset = makeExt("project-preset", {
        extends: [projectExtension],
      });

      const loader = new ExtensionLoader(noopLogger);
      const sorted = loader.topologicalSort(loader.flattenPresets([
        makeResolved(configExtension, "config"),
        makeResolved(projectPreset, "project"),
      ]));

      assertEquals(sorted.length, 1);
      assertEquals(sorted[0]?.source, "config");
      assertEquals(sorted[0]?.extension, configExtension);
    });

    it("rejects distinct same-priority extensions with the same name", () => {
      const loader = new ExtensionLoader(noopLogger);

      assertThrows(
        () =>
          loader.topologicalSort([
            makeResolved(makeExt("shared"), "config"),
            makeResolved(makeExt("shared"), "config"),
          ]),
        Error,
        'Duplicate extension name "shared"',
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

    it("serializes overlapping setupAll calls on the same loader", async () => {
      const firstStarted = Promise.withResolvers<void>();
      const releaseFirst = Promise.withResolvers<void>();
      const order: string[] = [];
      const first = makeExt("first", {
        async setup() {
          order.push("first:setup");
          firstStarted.resolve();
          await releaseFirst.promise;
          order.push("first:ready");
        },
        teardown() {
          order.push("first:teardown");
        },
      });
      const second = makeExt("second", {
        setup() {
          order.push("second:setup");
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      const firstSetup = loader.setupAll([makeResolved(first)], {});
      await firstStarted.promise;

      const secondSetup = loader.setupAll([makeResolved(second)], {});
      await Promise.resolve();
      await Promise.resolve();
      const secondStartedBeforeFirstSettled = order.includes("second:setup");

      releaseFirst.resolve();
      await Promise.all([firstSetup, secondSetup]);

      assertEquals(secondStartedBeforeFirstSettled, false);
      assertEquals(order, [
        "first:setup",
        "first:ready",
        "first:teardown",
        "second:setup",
      ]);
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

    it("orders consumers after the priority-winning provider and its prerequisites", async () => {
      const order: string[] = [];
      const winner = makeExt("winner", {
        contracts: { provides: ["Cache"], requires: ["Seed"] },
        setup: (ctx) => {
          ctx.require("Seed");
          order.push("winner");
          ctx.provide("Cache", { id: "winner" });
        },
      });
      const loser = makeExt("loser", {
        contracts: { provides: ["Cache"] },
        setup: (ctx) => {
          order.push("loser");
          ctx.provide("Cache", { id: "loser" });
        },
      });
      const seed = makeExt("seed", {
        contracts: { provides: ["Seed"] },
        setup: (ctx) => {
          order.push("seed");
          ctx.provide("Seed", { ready: true });
        },
      });
      const consumer = makeExt("consumer", {
        contracts: { requires: ["Cache"] },
        setup: (ctx) => {
          const cache = ctx.require<{ id: string }>("Cache");
          order.push(`consumer:${cache.id}`);
        },
      });
      const extensions = [
        makeResolved(winner, "config"),
        makeResolved(loser, "project"),
        makeResolved(seed, "config"),
        makeResolved(consumer, "config"),
      ];

      const loader = new ExtensionLoader(noopLogger);
      assertEquals(
        loader.topologicalSort(extensions).map((entry) => entry.extension.name),
        ["loser", "seed", "winner", "consumer"],
      );
      await loader.setupAll(extensions, {});

      assertEquals(order, ["loser", "seed", "winner", "consumer:winner"]);
    });

    it("rejects missing required contracts before replacing the active generation", async () => {
      let activeTeardownCalls = 0;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("active", {
          provides: { ActiveContract: { active: true } },
          teardown: () => {
            activeTeardownCalls++;
          },
        })),
      ], {});

      await assertRejects(
        () =>
          loader.setupAll([
            makeResolved(makeExt("consumer", {
              contracts: { requires: ["MissingContract"] },
            })),
          ], {}),
        Error,
        '"consumer" requires "MissingContract"',
      );

      assertEquals(activeTeardownCalls, 0);
      assertEquals(tryResolve("ActiveContract"), { active: true });
    });

    it("rolls back a provider that finishes without its declared contract", async () => {
      let teardownCalls = 0;
      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () =>
          loader.setupAll([
            makeResolved(makeExt("incomplete-provider", {
              contracts: { provides: ["CacheStore"] },
              setup: () => {},
              teardown: () => {
                teardownCalls++;
              },
            })),
          ], {}),
        Error,
        'completed setup without providing declared contract: "CacheStore"',
      );

      assertEquals(teardownCalls, 1);
      assertEquals(tryResolve("CacheStore"), undefined);
    });

    it("accepts a primed contract as a preflighted requirement", async () => {
      const marker = { seeded: true };
      let observed: unknown;
      const loader = new ExtensionLoader(noopLogger);
      loader.primeContracts({ Seeded: marker });

      await loader.setupAll([
        makeResolved(makeExt("consumer", {
          contracts: { requires: ["Seeded"] },
          setup: (ctx) => {
            observed = ctx.require("Seeded");
          },
        })),
      ], {});

      assertEquals(observed, marker);
    });
  });

  describe("setupAll() — setup timeout", () => {
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
      const hanging = makeExt("late-provider", {
        setup: (ctx) => {
          capturedProvide = ctx.provide;
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
    });

    it("revokes every registry operation on a timed-out setup context", async () => {
      let capturedContext: AbortAwareExtensionContext | undefined;
      const hanging = makeExt("stale-context", {
        setup: (ctx) => {
          capturedContext = ctx as AbortAwareExtensionContext;
          return new Promise<void>(() => {});
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(hanging)], {}, { setupTimeoutMs: 20 }),
        Error,
        "stale-context",
      );

      const marker = { generation: "new" };
      register("FreshContract", marker);
      capturedContext?.provide("ZombieContract", { poisoned: true });

      assertEquals(capturedContext?.signal?.aborted, true);
      assertEquals(capturedContext?.get("FreshContract"), undefined);
      assertThrows(
        () => capturedContext?.require("FreshContract"),
        Error,
        "no longer active",
      );
      assertEquals(tryResolve("ZombieContract"), undefined);
      assertEquals(tryResolve("FreshContract"), marker);
    });

    it("does not teardown an abort-aware timed-out setup twice", async () => {
      let teardownCount = 0;
      const abortAware = makeExt("abort-aware", {
        setup(ctx) {
          return new Promise<void>((_, reject) => {
            ctx.signal!.addEventListener(
              "abort",
              () => reject(new Error("setup aborted")),
              { once: true },
            );
          });
        },
        teardown() {
          teardownCount++;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(abortAware)], {}, { setupTimeoutMs: 20 }),
        Error,
        "abort-aware",
      );
      await Promise.resolve();
      await Promise.resolve();

      assertEquals(teardownCount, 1);
    });

    it("rejects on the setup deadline while a hanging rollback stays quarantined", async () => {
      const setupStarted = Promise.withResolvers<void>();
      const releaseSetup = Promise.withResolvers<void>();
      const teardownStarted = Promise.withResolvers<void>();
      const releaseTeardown = Promise.withResolvers<void>();
      let teardownCount = 0;
      let replacementStarted = false;
      const late = makeExt("slow-rollback", {
        async setup() {
          setupStarted.resolve();
          await releaseSetup.promise;
        },
        async teardown() {
          teardownCount++;
          teardownStarted.resolve();
          await releaseTeardown.promise;
        },
      });
      const replacement = makeExt("replacement", {
        setup() {
          replacementStarted = true;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      const timedOut = loader.setupAll(
        [makeResolved(late)],
        {},
        { setupTimeoutMs: 20 },
      );
      await setupStarted.promise;

      let deadlineId: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        timedOut.then(
          () => "resolved" as const,
          () => "rejected" as const,
        ),
        new Promise<"pending">((resolve) => {
          deadlineId = setTimeout(() => resolve("pending"), 100);
        }),
      ]);
      clearTimeout(deadlineId);

      assertEquals(outcome, "rejected");
      assertEquals(teardownCount, 0);

      const replacementSetup = loader.setupAll([makeResolved(replacement)], {});
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(replacementStarted, false);

      releaseSetup.resolve();
      await teardownStarted.promise;
      assertEquals(teardownCount, 1);
      releaseTeardown.resolve();
      await replacementSetup;

      assertEquals(teardownCount, 1);
      assertEquals(replacementStarted, true);
    });

    it("quarantines the next generation until late setup cleanup finishes", async () => {
      const setupStarted = Promise.withResolvers<void>();
      const releaseSetup = Promise.withResolvers<void>();
      let resourceOpen = false;
      let teardownCount = 0;
      let replacementStarted = false;
      const late = makeExt("late-resource", {
        async setup() {
          setupStarted.resolve();
          await releaseSetup.promise;
          resourceOpen = true;
        },
        teardown() {
          teardownCount++;
          resourceOpen = false;
        },
      });
      const replacement = makeExt("replacement", {
        setup() {
          replacementStarted = true;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      const timedOut = loader.setupAll(
        [makeResolved(late)],
        {},
        { setupTimeoutMs: 20 },
      );
      await setupStarted.promise;
      await assertRejects(() => timedOut, Error, "late-resource");

      assertEquals(resourceOpen, false);
      assertEquals(teardownCount, 0);

      const replacementSetup = loader.setupAll([makeResolved(replacement)], {});
      await Promise.resolve();
      await Promise.resolve();
      const startedBeforeLateCleanup = replacementStarted;

      releaseSetup.resolve();
      await replacementSetup;

      assertEquals(startedBeforeLateCleanup, false);
      assertEquals(resourceOpen, false);
      assertEquals(teardownCount, 1);
      assertEquals(replacementStarted, true);
    });

    it("keeps the loader quarantined when late setup cleanup fails", async () => {
      const setupStarted = Promise.withResolvers<void>();
      const releaseSetup = Promise.withResolvers<void>();
      let resourceOpen = false;
      let teardownCount = 0;
      let replacementStarted = false;
      const late = makeExt("late-cleanup-failure", {
        async setup() {
          setupStarted.resolve();
          await releaseSetup.promise;
          resourceOpen = true;
        },
        teardown() {
          teardownCount++;
          throw new Error("late cleanup failed");
        },
      });
      const replacement = makeExt("replacement", {
        setup() {
          replacementStarted = true;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      const timedOut = loader.setupAll(
        [makeResolved(late)],
        {},
        { setupTimeoutMs: 20 },
      );
      await setupStarted.promise;
      await assertRejects(() => timedOut, Error, "late-cleanup-failure");

      const replacementSetup = loader.setupAll([makeResolved(replacement)], {});
      releaseSetup.resolve();
      await assertRejects(
        () => replacementSetup,
        Error,
        "late cleanup failed",
      );

      assertEquals(resourceOpen, true);
      assertEquals(teardownCount, 1);
      assertEquals(replacementStarted, false);

      await assertRejects(
        () => loader.setupAll([makeResolved(replacement)], {}),
        Error,
        "late cleanup failed",
      );
      assertEquals(replacementStarted, false);
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

    it("revokes a successful setup context before teardown", async () => {
      let capturedContext: AbortAwareExtensionContext | undefined;
      const ext = makeExt("captures-context", {
        setup(ctx) {
          capturedContext = ctx as AbortAwareExtensionContext;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(ext)], {});
      await loader.teardownAll();

      const marker = { generation: "new" };
      register("FreshContract", marker);
      capturedContext?.provide("ZombieContract", { poisoned: true });

      assertEquals(capturedContext?.signal?.aborted, true);
      assertEquals(capturedContext?.get("FreshContract"), undefined);
      assertThrows(
        () => capturedContext?.require("FreshContract"),
        Error,
        "no longer active",
      );
      assertEquals(tryResolve("ZombieContract"), undefined);
      assertEquals(tryResolve("FreshContract"), marker);
    });

    it("keeps dependency contracts available through reverse teardown", async () => {
      const marker = { ready: true };
      const observations: unknown[] = [];
      const provider = makeExt("provider", {
        provides: { SharedDependency: marker },
        teardown() {
          observations.push(tryResolve("SharedDependency"));
        },
      });
      const consumer = makeExt("consumer", {
        contracts: { requires: ["SharedDependency"] },
        teardown() {
          observations.push(tryResolve("SharedDependency"));
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(consumer), makeResolved(provider)], {});
      await loader.teardownAll();

      assertEquals(observations, [marker, marker]);
      assertEquals(tryResolve("SharedDependency"), undefined);
    });

    it("attempts every teardown, propagates all failures, and quarantines replacement", async () => {
      const order: string[] = [];
      let replacementStarted = false;
      const firstFailure = new Error("first teardown failed");
      const secondFailure = new Error("second teardown failed");
      const first = makeExt("first", {
        teardown() {
          order.push("first");
          throw firstFailure;
        },
      });
      const second = makeExt("second", {
        teardown() {
          order.push("second");
          throw secondFailure;
        },
      });
      const replacement = makeExt("replacement", {
        setup() {
          replacementStarted = true;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(first), makeResolved(second)], {});
      const failure = await assertRejects(
        () => loader.teardownAll(),
        AggregateError,
        "Extension teardown failed",
      );

      assertEquals(order, ["second", "first"]);
      assertEquals((failure as AggregateError).errors, [secondFailure, firstFailure]);
      await assertRejects(
        () => loader.setupAll([makeResolved(replacement)], {}),
        AggregateError,
        "Extension teardown failed",
      );
      assertEquals(replacementStarted, false);
    });

    it("retains failed teardown ownership and permits an explicit cleanup retry", async () => {
      const dependency = { generation: "retiring" };
      let teardownAttempts = 0;
      let replacementStarted = false;
      const retryable = makeExt("retryable", {
        provides: { RetiringDependency: dependency },
        teardown() {
          teardownAttempts++;
          assertEquals(tryResolve("RetiringDependency"), dependency);
          if (teardownAttempts === 1) {
            throw new Error("transient teardown failure");
          }
        },
      });
      const replacement = makeExt("replacement", {
        setup() {
          replacementStarted = true;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(retryable)], {});
      await assertRejects(
        () => loader.teardownAll(),
        AggregateError,
        "transient teardown failure",
      );

      assertEquals(tryResolve("RetiringDependency"), dependency);
      await assertRejects(
        () => loader.setupAll([makeResolved(replacement)], {}),
        AggregateError,
        "transient teardown failure",
      );
      assertEquals(replacementStarted, false);

      await loader.teardownAll();
      assertEquals(teardownAttempts, 2);
      assertEquals(tryResolve("RetiringDependency"), undefined);

      await loader.setupAll([makeResolved(replacement)], {});
      assertEquals(replacementStarted, true);
      await loader.teardownAll();
    });

    it("waits for timed-out setup cleanup and invokes teardown exactly once", async () => {
      const setupStarted = Promise.withResolvers<void>();
      const releaseSetup = Promise.withResolvers<void>();
      let teardownCount = 0;
      const late = makeExt("late", {
        async setup() {
          setupStarted.resolve();
          await releaseSetup.promise;
        },
        teardown() {
          teardownCount++;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      const setup = loader.setupAll(
        [makeResolved(late)],
        {},
        { setupTimeoutMs: 10 },
      );
      await setupStarted.promise;
      await assertRejects(() => setup, Error, "late");

      let teardownSettled = false;
      const teardown = loader.teardownAll().then(() => {
        teardownSettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(teardownSettled, false);
      assertEquals(teardownCount, 0);

      releaseSetup.resolve();
      await teardown;
      assertEquals(teardownCount, 1);
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

    it("clears first-extension static and dynamic registrations on failure", async () => {
      let teardownCount = 0;
      const failing = makeExt("first-failing", {
        provides: { StaticLeak: { leaked: true } },
        setup(ctx) {
          ctx.provide("DynamicLeak", { leaked: true });
          throw new Error("first-failure");
        },
        teardown() {
          teardownCount++;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(failing)], {}),
        Error,
        "first-failure",
      );

      assertEquals(teardownCount, 1);
      assertEquals(tryResolve("StaticLeak"), undefined);
      assertEquals(tryResolve("DynamicLeak"), undefined);
    });

    it("prevalidates the whole plan before starting any extension", async () => {
      let teardownCount = 0;
      const valid = makeExt("valid", {
        provides: { ValidContract: { active: true } },
        teardown() {
          teardownCount++;
        },
      });
      const invalid = {
        name: "invalid",
        version: "1.0.0",
        capabilities: "not-an-array",
      } as unknown as Extension;

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(valid), makeResolved(invalid)], {}),
        Error,
        'Extension "invalid" is invalid',
      );

      assertEquals(teardownCount, 0);
      assertEquals(tryResolve("ValidContract"), undefined);
    });

    it("does not tear down the active generation when replacement preflight fails", async () => {
      let teardownCount = 0;
      const active = makeExt("active", {
        provides: { ActiveContract: { active: true } },
        teardown() {
          teardownCount++;
        },
      });
      const invalid = {
        name: "invalid",
        version: "1.0.0",
        capabilities: [],
        setup: "not-a-function",
      } as unknown as Extension;

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});

      await assertRejects(
        () => loader.setupAll([makeResolved(invalid)], {}),
        Error,
        'Extension "invalid" is invalid',
      );

      assertEquals(teardownCount, 0);
      assertEquals(
        tryResolve("ActiveContract"),
        { active: true },
      );
    });

    it("rejects invalid timeout values before replacing the active generation", async () => {
      let teardownCount = 0;
      const active = makeExt("active", {
        provides: { ActiveContract: { active: true } },
        teardown() {
          teardownCount++;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});

      for (const setupTimeoutMs of [-1, 0.5, Number.NaN, 2_147_483_648]) {
        await assertRejects(
          () =>
            loader.setupAll(
              [makeResolved(makeExt("replacement"))],
              {},
              { setupTimeoutMs },
            ),
          Error,
          "setupTimeoutMs",
        );
      }

      assertEquals(teardownCount, 0);
      assertEquals(
        tryResolve("ActiveContract"),
        { active: true },
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

  it("clears primed-only registrations during teardown", async () => {
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ PrimedOnly: { value: true } });

    await loader.setupAll([], {});
    assertEquals(tryResolve("PrimedOnly"), { value: true });

    await loader.teardownAll();
    assertEquals(tryResolve("PrimedOnly"), undefined);
  });
});
