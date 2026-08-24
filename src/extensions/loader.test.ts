import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension loader tests — topological sort and lifecycle management.
 *
 * @module extensions/loader.test
 */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { ExtensionLoader } from "./loader.ts";
import {
  register,
  reset,
  resolve as resolveContract,
  tryResolve,
  unregister,
} from "./contracts.ts";
import {
  acquireContractLease,
  beginContractGeneration,
  commitContractGeneration,
  type ContractSnapshot,
  runWithContractGenerationResolution,
  sealContractGeneration,
  stageContract,
  trySnapshotContractForUse,
} from "./contract-registry-internal.ts";
import type {
  Capability,
  Extension,
  ExtensionContext,
  ExtensionLogger,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";
import { createDeferredResolvedExtension } from "./deferred-extension.ts";

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

function makeDeferred(
  name: string,
  load: (logger: ExtensionLogger) => Promise<Extension | undefined>,
): ResolvedExtension {
  return createDeferredResolvedExtension({
    name,
    source: "builtin",
    origin: `veryfront/${name}`,
    load,
  });
}

const noopLogger: ExtensionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("ExtensionLoader", () => {
  afterEach(() => {
    reset();
  });

  describe("deferred extension materialization", () => {
    it("materializes candidates before activation and runs the loaded extension normally", async () => {
      const order: string[] = [];
      const loader = new ExtensionLoader(noopLogger);
      const deferred = makeDeferred("optional", () => {
        order.push("materialize");
        return Promise.resolve(makeExt("optional", {
          contracts: { provides: ["OptionalContract"] },
          setup(ctx) {
            order.push("setup");
            ctx.provide("OptionalContract", { ready: true });
          },
        }));
      });

      await loader.setupAll([deferred], {}, {
        beforeActivate() {
          order.push("activate");
        },
      });

      assertEquals(order, ["materialize", "activate", "setup"]);
      assertEquals(tryResolve("OptionalContract"), { ready: true });
      await loader.teardownAll();
    });

    it("keeps the active generation when deferred materialization is invalid", async () => {
      let activeTeardownCount = 0;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("active", {
          provides: { ActiveContract: { active: true } },
          teardown() {
            activeTeardownCount++;
          },
        })),
      ], {});

      await assertRejects(
        () =>
          loader.setupAll([
            makeDeferred("invalid", () =>
              Promise.resolve({
                name: "invalid",
                version: "1.0.0",
                capabilities: "not-an-array",
              } as unknown as Extension)),
          ], {}),
        Error,
        'Extension "invalid" is invalid',
      );

      assertEquals(activeTeardownCount, 0);
      assertEquals(tryResolve("ActiveContract"), { active: true });
      await loader.teardownAll();
      assertEquals(activeTeardownCount, 1);
    });

    it("skips unavailable candidates and preflights dependent contracts", async () => {
      let activeTeardownCount = 0;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("active", {
          provides: { ActiveContract: { active: true } },
          teardown() {
            activeTeardownCount++;
          },
        })),
      ], {});

      await assertRejects(
        () =>
          loader.setupAll([
            makeDeferred("unavailable", () => Promise.resolve(undefined)),
            makeResolved(makeExt("consumer", {
              contracts: { requires: ["OptionalContract"] },
            })),
          ], {}),
        Error,
        '"consumer" requires "OptionalContract"',
      );

      assertEquals(activeTeardownCount, 0);
      assertEquals(tryResolve("ActiveContract"), { active: true });
      await loader.teardownAll();
    });

    it("rejects materialized identity drift before activation", async () => {
      const loader = new ExtensionLoader(noopLogger);

      await assertRejects(
        () =>
          loader.setupAll([
            makeDeferred(
              "expected",
              () => Promise.resolve(makeExt("unexpected")),
            ),
          ], {}),
        Error,
        'Deferred extension "expected" materialized as "unexpected"',
      );
    });
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
        contracts: { provides: ["A"], requires: ["B"] },
      });
      const b = makeExt("ext-b", {
        contracts: { provides: ["B"], requires: ["A"] },
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

    it("rejects dynamic contracts that the extension did not declare", async () => {
      const undeclared = makeExt("undeclared-provider", {
        setup: (ctx) => {
          ctx.provide("SurpriseContract", { active: true });
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () => loader.setupAll([makeResolved(undeclared)], {}),
        Error,
        'Extension "undeclared-provider" cannot provide undeclared contract "SurpriseContract"',
      );
      assertEquals(tryResolve("SurpriseContract"), undefined);
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
      // A setup held open past the 30 s default deadline proves that 0 arms no
      // deadline at all, rather than quietly falling back to the default.
      using time = new FakeTime();
      const gate = Promise.withResolvers<void>();
      const slow = makeExt("slow", {
        setup: () => gate.promise,
      });

      const loader = new ExtensionLoader(noopLogger);
      let settled: "resolved" | "rejected" | undefined;
      const setupAll = loader.setupAll([makeResolved(slow)], {}, { setupTimeoutMs: 0 })
        .then(() => {
          settled = "resolved";
        }, () => {
          settled = "rejected";
        });

      await time.tickAsync(120_000);
      assertEquals(
        settled,
        undefined,
        "setupTimeoutMs 0 must arm no deadline, even past the 30s default",
      );

      gate.resolve();
      await setupAll;
      assertEquals(settled, "resolved", "setup must complete once released");
      await loader.teardownAll();
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

    it("removes only the exact contracts owned by the retiring generation", async () => {
      const owned = { generation: "retiring" };
      const replacement = { generation: "replacement" };
      const unrelated = { owner: "external" };
      const extension = makeExt("owner", {
        provides: { OwnedContract: owned },
        teardown() {
          register("OwnedContract", replacement);
          register("UnrelatedContract", unrelated);
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(extension)], {});
      assertEquals(tryResolve("OwnedContract"), owned);

      await loader.teardownAll();

      assertEquals(tryResolve("OwnedContract"), replacement);
      assertEquals(tryResolve("UnrelatedContract"), unrelated);
    });

    it("preserves immediate unmanaged replacement visibility during teardown", async () => {
      const owned = Object.freeze({ generation: "retiring" });
      const replacement = Object.freeze({ generation: "replacement" });
      let observedAfterReplacement: unknown;
      const extension = makeExt("replacement-observer", {
        provides: { ReplacementVisibilityContract: owned },
        teardown() {
          register("ReplacementVisibilityContract", replacement);
          observedAfterReplacement = tryResolve(
            "ReplacementVisibilityContract",
          );
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(extension)], {});
      await loader.teardownAll();

      assertEquals(observedAfterReplacement, replacement);
      assertEquals(
        tryResolve("ReplacementVisibilityContract"),
        replacement,
      );
    });

    it("blocks nested generation admission during current teardown", async () => {
      const nestedLoader = new ExtensionLoader(noopLogger);
      let nestedFailure: unknown;
      let nestedMaterializationCalls = 0;
      let nestedBeforeTransitionCalls = 0;
      let nestedSetupCalls = 0;
      const extension = makeExt("nested-generation-owner", {
        async teardown() {
          try {
            await nestedLoader.setupAll(
              [
                makeDeferred(
                  "nested-generation-candidate",
                  () => {
                    nestedMaterializationCalls += 1;
                    return Promise.resolve(
                      makeExt("nested-generation-candidate", {
                        contracts: {
                          provides: ["NestedGenerationDependency"],
                        },
                        setup(context) {
                          nestedSetupCalls += 1;
                          context.provide(
                            "NestedGenerationDependency",
                            Object.freeze({ id: "nested" }),
                          );
                        },
                      }),
                    );
                  },
                ),
              ],
              {},
              {
                beforeTransition() {
                  nestedBeforeTransitionCalls += 1;
                },
              },
            );
          } catch (error) {
            nestedFailure = error;
          }
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(extension)], {});
      await loader.teardownAll();
      const nestedDependency = tryResolve("NestedGenerationDependency");
      await nestedLoader.teardownAll();

      assertEquals(nestedFailure instanceof Error, true);
      assertEquals(
        nestedFailure instanceof Error
          ? nestedFailure.message.includes("during extension teardown")
          : false,
        true,
      );
      assertEquals(nestedDependency, undefined);
      assertEquals(nestedMaterializationCalls, 0);
      assertEquals(nestedBeforeTransitionCalls, 0);
      assertEquals(nestedSetupCalls, 0);

      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("post-teardown-generation", {
          contracts: { provides: ["PostTeardownDependency"] },
          setup(context) {
            context.provide(
              "PostTeardownDependency",
              Object.freeze({ id: "external" }),
            );
          },
        })),
      ], {});
      assertEquals(
        tryResolve("PostTeardownDependency"),
        { id: "external" },
      );
      await replacementLoader.teardownAll();
    });

    it("remains teardown-safe after the low-level registry is reset", async () => {
      let teardownCalls = 0;
      const extension = makeExt("reset-owner", {
        provides: { ResetOwnedContract: { active: true } },
        teardown() {
          teardownCalls += 1;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(extension)], {});
      reset();
      assertEquals(tryResolve("ResetOwnedContract"), undefined);

      await loader.teardownAll();
      assertEquals(teardownCalls, 1);
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

    it("retries retirement after a quarantined contract use settles", async () => {
      const dependency = Object.freeze({ id: "quarantined" });
      let teardownCount = 0;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("quarantined-use-owner", {
          contracts: {
            provides: ["QuarantinedUseDependency"],
          },
          setup(context) {
            context.provide("QuarantinedUseDependency", dependency);
          },
          teardown() {
            teardownCount += 1;
          },
        })),
      ], {});
      const snapshot = trySnapshotContractForUse(
        "QuarantinedUseDependency",
      );
      if (snapshot === undefined) {
        throw new Error("Expected a quarantined-use snapshot");
      }
      const lease = acquireContractLease(snapshot.reference);
      lease.setRetirementHandler(() => {});
      lease.quarantine();

      await assertRejects(
        () => loader.teardownAll(),
        Error,
        "quarantined",
      );
      assertEquals(teardownCount, 0);
      assertEquals(tryResolve("QuarantinedUseDependency"), dependency);

      lease.release();
      await loader.teardownAll();
      assertEquals(teardownCount, 1);
      assertEquals(tryResolve("QuarantinedUseDependency"), undefined);
    });

    it("reports a late retirement-handler failure after final lease release", async () => {
      const retirementStarted = Promise.withResolvers<void>();
      let ownerSignal: AbortSignal | undefined;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("late-retirement-failure-owner", {
          contracts: {
            provides: ["LateRetirementFailureDependency"],
          },
          setup(context) {
            ownerSignal = (context as AbortAwareExtensionContext).signal;
            context.provide(
              "LateRetirementFailureDependency",
              Object.freeze({ id: "retiring" }),
            );
          },
        })),
      ], {});
      if (ownerSignal === undefined) {
        throw new Error("Expected the owner extension abort signal");
      }
      ownerSignal.addEventListener(
        "abort",
        () => retirementStarted.resolve(),
        { once: true },
      );
      const snapshot = trySnapshotContractForUse(
        "LateRetirementFailureDependency",
      );
      if (snapshot === undefined) {
        throw new Error("Expected a late retirement failure snapshot");
      }
      const lease = acquireContractLease(snapshot.reference);
      const retirementFailure = new Error(
        "late retirement handler failed after release",
      );

      const teardown = loader.teardownAll();
      await retirementStarted.promise;
      lease.setRetirementHandler(() => {
        lease.release();
        throw retirementFailure;
      });

      const failure = await assertRejects(() => teardown, Error);
      assertEquals(failure, retirementFailure);
    });

    it("revokes detached retirement-handler descendants before same-epoch replacement", async () => {
      const owned = Object.freeze({ id: "retiring" });
      const replacement = Object.freeze({ id: "replacement" });
      const staleRegistration = Object.freeze({ id: "stale" });
      const continueDescendant = Promise.withResolvers<void>();
      const descendantSettled = Promise.withResolvers<void>();
      let descendantDependency: unknown = owned;
      let descendantLoader: ExtensionLoader | undefined;
      let descendantSetupCalls = 0;
      let registerFailure: unknown;
      let resetFailure: unknown;
      const ownerLoader = new ExtensionLoader(noopLogger);
      await ownerLoader.setupAll([
        makeResolved(makeExt("retirement-descendant-owner", {
          contracts: {
            provides: ["RetirementDescendantDependency"],
          },
          setup(context) {
            context.provide("RetirementDescendantDependency", owned);
          },
        })),
      ], {});
      const snapshot = trySnapshotContractForUse(
        "RetirementDescendantDependency",
      );
      if (snapshot === undefined) {
        throw new Error("Expected a retirement descendant snapshot");
      }
      const lease = acquireContractLease(snapshot.reference);
      lease.setRetirementHandler(() => {
        void (async () => {
          await continueDescendant.promise;
          descendantDependency = tryResolve(
            "RetirementDescendantDependency",
          );
          try {
            register(
              "RetirementDescendantDependency",
              staleRegistration,
            );
          } catch (error) {
            registerFailure = error;
          }
          try {
            reset();
          } catch (error) {
            resetFailure = error;
          }
          descendantLoader = new ExtensionLoader(noopLogger);
          try {
            await descendantLoader.setupAll([
              makeResolved(makeExt("retirement-descendant-nested", {
                setup() {
                  descendantSetupCalls += 1;
                },
              })),
            ], {});
          } catch {
            // The observable invariant is that setup never receives authority.
          }
          descendantSettled.resolve();
        })();
        lease.release();
      });

      await ownerLoader.teardownAll();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("retirement-descendant-replacement", {
          contracts: {
            provides: ["RetirementDescendantDependency"],
          },
          setup(context) {
            context.provide(
              "RetirementDescendantDependency",
              replacement,
            );
          },
        })),
      ], {});

      continueDescendant.resolve();
      await descendantSettled.promise;
      assertEquals(descendantDependency, undefined);
      assertEquals(registerFailure instanceof Error, true);
      assertEquals(resetFailure instanceof Error, true);
      assertEquals(descendantSetupCalls, 0);
      assertEquals(
        tryResolve("RetirementDescendantDependency"),
        replacement,
      );
      if (descendantLoader !== undefined) {
        await descendantLoader.teardownAll();
      }
      await replacementLoader.teardownAll();
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

    it("uses the bounded descriptor snapshot instead of proxy get traps", () => {
      const child = makeExt("child");
      const target = makeExt("preset", { extends: [child] });
      let getCalls = 0;
      const preset = new Proxy(target, {
        get(_target, property, receiver) {
          getCalls++;
          if (property === "extends") return [receiver];
          return Reflect.get(target, property, receiver);
        },
      });
      const resolved = makeResolved(preset);
      getCalls = 0;

      const loader = new ExtensionLoader(noopLogger);
      const flat = loader.flattenPresets([resolved]);

      assertEquals(getCalls, 0);
      assertEquals(flat.length, 1);
      assertEquals(flat[0]?.extension, child);
    });

    it("bounds recursive preset graphs before stack or memory exhaustion", () => {
      let preset = makeExt("leaf");
      for (let depth = 0; depth <= 32; depth++) {
        preset = makeExt(`preset-${depth}`, { extends: [preset] });
      }

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.flattenPresets([makeResolved(preset)]),
        Error,
        "nesting exceeds 32 levels",
      );
    });

    it("bounds total preset graph work when subgraphs are shared across siblings", () => {
      // Sibling repetition of one extension object is legal, so a graph well
      // inside the depth and children limits can still expand without bound.
      const leaf = makeExt("leaf");
      const mid = makeExt("mid", { extends: Array.from({ length: 256 }, () => leaf) });
      const top = makeExt("top", { extends: Array.from({ length: 20 }, () => mid) });

      const loader = new ExtensionLoader(noopLogger);
      assertThrows(
        () => loader.flattenPresets([makeResolved(top)]),
        Error,
        "graph exceeds 4096 nodes",
      );
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

    it("keeps candidate contracts available to rollback teardown hooks", async () => {
      const candidateDependency = Object.freeze({ id: "candidate" });
      let rollbackResolvedCandidate = false;
      const provider = makeExt("candidate-provider", {
        contracts: { provides: ["CandidateDependency"] },
        setup(context) {
          context.provide("CandidateDependency", candidateDependency);
        },
        teardown() {
          rollbackResolvedCandidate =
            resolveContract("CandidateDependency") === candidateDependency;
        },
      });
      const setupFailure = new Error("candidate setup failed");
      const failing = makeExt("candidate-failure", {
        setup() {
          throw setupFailure;
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const failure = await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(failing)], {}),
        Error,
      );

      assertEquals((failure as Error).message, setupFailure.message);
      assertEquals(rollbackResolvedCandidate, true);
      assertEquals(tryResolve("CandidateDependency"), undefined);
    });

    it("restores a displaced unmanaged contract after candidate rollback", async () => {
      const unmanagedDependency = Object.freeze({ id: "unmanaged" });
      const candidateDependency = Object.freeze({ id: "candidate" });
      const rollbackStarted = Promise.withResolvers<void>();
      const continueRollback = Promise.withResolvers<void>();
      register("RollbackDependency", unmanagedDependency);
      let rollbackDependency: unknown;
      const provider = makeExt("rollback-provider", {
        contracts: { provides: ["RollbackDependency"] },
        setup(context) {
          context.provide("RollbackDependency", candidateDependency);
          assertEquals(context.require("RollbackDependency"), candidateDependency);
        },
        async teardown() {
          rollbackStarted.resolve();
          await continueRollback.promise;
          rollbackDependency = resolveContract("RollbackDependency");
        },
      });
      const setupFailure = new Error("replacement setup failed");
      const failing = makeExt("replacement-failure", {
        setup() {
          throw setupFailure;
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const activation = loader.setupAll(
        [makeResolved(provider), makeResolved(failing)],
        {},
      );
      await rollbackStarted.promise;
      try {
        assertEquals(tryResolve("RollbackDependency"), unmanagedDependency);
      } finally {
        continueRollback.resolve();
      }
      const failure = await assertRejects(() => activation, Error);

      assertEquals((failure as Error).message, setupFailure.message);
      assertEquals(rollbackDependency, candidateDependency);
      assertEquals(tryResolve("RollbackDependency"), unmanagedDependency);
    });

    it("preserves register read-your-writes during candidate rollback", async () => {
      const candidateDependency = Object.freeze({ id: "candidate" });
      const replacementDependency = Object.freeze({ id: "replacement" });
      let observedAfterRegister: unknown = candidateDependency;
      const provider = makeExt("rollback-register-provider", {
        contracts: { provides: ["RollbackRegisterDependency"] },
        setup(context) {
          context.provide(
            "RollbackRegisterDependency",
            candidateDependency,
          );
        },
      });
      const setupFailure = new Error("rollback register setup failed");
      const failing = makeExt("rollback-register-failure", {
        setup() {
          throw setupFailure;
        },
        teardown() {
          register(
            "RollbackRegisterDependency",
            replacementDependency,
          );
          observedAfterRegister = tryResolve(
            "RollbackRegisterDependency",
          );
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const failure = await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(failing)], {}),
        Error,
      );

      assertEquals((failure as Error).message, setupFailure.message);
      assertEquals(observedAfterRegister, replacementDependency);
      assertEquals(
        tryResolve("RollbackRegisterDependency"),
        replacementDependency,
      );
      await loader.teardownAll();
    });

    it("preserves unregister visibility across candidate rollback hooks", async () => {
      const candidateDependency = Object.freeze({ id: "candidate" });
      let observedAfterUnregister: unknown = candidateDependency;
      let observedByLaterHook: unknown = candidateDependency;
      const provider = makeExt("rollback-unregister-provider", {
        contracts: { provides: ["RollbackUnregisterDependency"] },
        setup(context) {
          context.provide(
            "RollbackUnregisterDependency",
            candidateDependency,
          );
        },
        teardown() {
          observedByLaterHook = tryResolve(
            "RollbackUnregisterDependency",
          );
        },
      });
      const setupFailure = new Error("rollback unregister setup failed");
      const failing = makeExt("rollback-unregister-failure", {
        setup() {
          throw setupFailure;
        },
        teardown() {
          unregister("RollbackUnregisterDependency");
          observedAfterUnregister = tryResolve(
            "RollbackUnregisterDependency",
          );
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const failure = await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(failing)], {}),
        Error,
      );

      assertEquals((failure as Error).message, setupFailure.message);
      assertEquals(observedAfterUnregister, undefined);
      assertEquals(observedByLaterHook, undefined);
      assertEquals(tryResolve("RollbackUnregisterDependency"), undefined);
      await loader.teardownAll();
    });

    it("isolates stale rollback resolution from a replacement after a low-level reset", async () => {
      const candidateDependency = Object.freeze({ id: "candidate" });
      const replacementDependency = Object.freeze({ id: "replacement" });
      const rollbackPaused = Promise.withResolvers<void>();
      const continueRollback = Promise.withResolvers<void>();
      let pausedHookDependency: unknown = candidateDependency;
      let providerTeardownCalls = 0;
      const provider = makeExt("reset-candidate-provider", {
        contracts: { provides: ["ResetCandidateDependency"] },
        setup(context) {
          context.provide("ResetCandidateDependency", candidateDependency);
        },
        teardown() {
          providerTeardownCalls += 1;
        },
      });
      const setupFailure = new Error("reset candidate setup failed");
      const failing = makeExt("reset-candidate-failure", {
        setup() {
          throw setupFailure;
        },
        async teardown() {
          rollbackPaused.resolve();
          await continueRollback.promise;
          pausedHookDependency = tryResolve("ResetCandidateDependency");
        },
      });
      const loader = new ExtensionLoader(noopLogger);
      const activation = loader.setupAll(
        [makeResolved(provider), makeResolved(failing)],
        {},
      );
      const replacementLoader = new ExtensionLoader(noopLogger);

      await rollbackPaused.promise;
      reset();
      await replacementLoader.setupAll([
        makeResolved(makeExt("reset-replacement-provider", {
          contracts: { provides: ["ResetCandidateDependency"] },
          setup(context) {
            context.provide(
              "ResetCandidateDependency",
              replacementDependency,
            );
          },
        })),
      ], {});
      continueRollback.resolve();
      const failure = await assertRejects(() => activation, Error);

      assertEquals((failure as Error).message, setupFailure.message);
      assertEquals(pausedHookDependency, undefined);
      assertEquals(providerTeardownCalls, 1);
      assertEquals(
        tryResolve("ResetCandidateDependency"),
        replacementDependency,
      );
      await loader.teardownAll();
      await replacementLoader.teardownAll();
    });

    it("does not let stale failure finalization reassert the reset transition barrier", async () => {
      const rollbackPaused = Promise.withResolvers<void>();
      const continueRollback = Promise.withResolvers<void>();
      const setupFailure = new Error("stale reset failure");
      const failing = makeExt("stale-reset-failure", {
        setup() {
          throw setupFailure;
        },
        async teardown() {
          rollbackPaused.resolve();
          await continueRollback.promise;
        },
      });
      const loader = new ExtensionLoader(noopLogger);
      const activation = loader.setupAll(
        [makeResolved(failing)],
        {},
      );

      await rollbackPaused.promise;
      reset();
      assertEquals(
        trySnapshotContractForUse("AbsentAfterReset"),
        undefined,
      );
      continueRollback.resolve();
      const failure = await assertRejects(() => activation, Error);

      assertEquals((failure as Error).message, setupFailure.message);
      assertEquals(
        trySnapshotContractForUse("AbsentAfterReset"),
        undefined,
      );
      await loader.teardownAll();
    });

    it("keeps detached rollback descendants isolated from a later registry epoch", async () => {
      const candidateDependency = Object.freeze({ id: "detached-candidate" });
      const replacementDependency = Object.freeze({ id: "detached-replacement" });
      const continueDescendant = Promise.withResolvers<void>();
      const descendantSettled = Promise.withResolvers<void>();
      let descendantDependency: unknown = candidateDependency;
      const provider = makeExt("detached-reset-provider", {
        contracts: { provides: ["DetachedResetDependency"] },
        setup(context) {
          context.provide("DetachedResetDependency", candidateDependency);
        },
        teardown() {
          void (async () => {
            await continueDescendant.promise;
            descendantDependency = tryResolve("DetachedResetDependency");
            descendantSettled.resolve();
          })();
        },
      });
      const setupFailure = new Error("detached reset setup failed");
      const failing = makeExt("detached-reset-failure", {
        setup() {
          throw setupFailure;
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const failure = await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(failing)], {}),
        Error,
      );
      assertEquals((failure as Error).message, setupFailure.message);
      reset();

      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("detached-reset-replacement", {
          contracts: { provides: ["DetachedResetDependency"] },
          setup(context) {
            context.provide(
              "DetachedResetDependency",
              replacementDependency,
            );
          },
        })),
      ], {});

      continueDescendant.resolve();
      await descendantSettled.promise;
      assertEquals(descendantDependency, undefined);
      assertEquals(
        tryResolve("DetachedResetDependency"),
        replacementDependency,
      );
      await loader.teardownAll();
      await replacementLoader.teardownAll();
    });

    it("isolates retirement handlers from a replacement registry epoch", async () => {
      const owned = Object.freeze({ id: "retiring" });
      const replacement = Object.freeze({ id: "replacement" });
      const staleRegistration = Object.freeze({ id: "stale" });
      const ownerLoader = new ExtensionLoader(noopLogger);
      await ownerLoader.setupAll([
        makeResolved(makeExt("retirement-handler-owner", {
          contracts: { provides: ["RetirementHandlerDependency"] },
          setup(context) {
            context.provide("RetirementHandlerDependency", owned);
          },
        })),
      ], {});
      const snapshot = trySnapshotContractForUse(
        "RetirementHandlerDependency",
      );
      if (snapshot === undefined) {
        throw new Error("Expected a retirement-handler contract snapshot");
      }
      const lease = acquireContractLease(snapshot.reference);
      const nestedLoader = new ExtensionLoader(noopLogger);
      let nestedSetup: Promise<void> | undefined;
      let registerFailure: unknown;
      let resetFailure: unknown;
      let resolvedInHandler: unknown = owned;
      let unregisterFailure: unknown;
      lease.setRetirementHandler(() => {
        try {
          resolvedInHandler = tryResolve("RetirementHandlerDependency");
          try {
            register("RetirementHandlerDependency", staleRegistration);
          } catch (error) {
            registerFailure = error;
          }
          try {
            unregister("RetirementHandlerDependency");
          } catch (error) {
            unregisterFailure = error;
          }
          try {
            reset();
          } catch (error) {
            resetFailure = error;
          }
          nestedSetup = nestedLoader.setupAll([
            makeResolved(makeExt("retirement-handler-nested", {
              contracts: {
                provides: ["RetirementHandlerNestedDependency"],
              },
              setup(context) {
                context.provide(
                  "RetirementHandlerNestedDependency",
                  Object.freeze({ id: "nested" }),
                );
              },
            })),
          ], {});
        } finally {
          lease.release();
        }
      });

      reset();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("retirement-handler-replacement", {
          contracts: { provides: ["RetirementHandlerDependency"] },
          setup(context) {
            context.provide("RetirementHandlerDependency", replacement);
          },
        })),
      ], {});

      await ownerLoader.teardownAll();
      let nestedFailure: unknown;
      if (nestedSetup !== undefined) {
        try {
          await nestedSetup;
        } catch (error) {
          nestedFailure = error;
        }
      }
      await nestedLoader.teardownAll();

      assertEquals(resolvedInHandler, undefined);
      assertEquals(registerFailure instanceof Error, true);
      assertEquals(resetFailure instanceof Error, true);
      assertEquals(unregisterFailure instanceof Error, true);
      assertEquals(nestedFailure instanceof Error, true);
      assertEquals(
        nestedFailure instanceof Error
          ? nestedFailure.message.includes("during extension teardown")
          : false,
        true,
      );
      assertEquals(
        tryResolve("RetirementHandlerDependency"),
        replacement,
      );
      assertEquals(
        tryResolve("RetirementHandlerNestedDependency"),
        undefined,
      );
      await replacementLoader.teardownAll();
    });

    it("isolates a retirement handler registered after draining starts", async () => {
      const owned = Object.freeze({ id: "retiring-late-handler" });
      const replacement = Object.freeze({ id: "replacement-late-handler" });
      const retirementStarted = Promise.withResolvers<void>();
      let ownerSignal: AbortSignal | undefined;
      const ownerLoader = new ExtensionLoader(noopLogger);
      await ownerLoader.setupAll([
        makeResolved(makeExt("late-retirement-handler-owner", {
          contracts: {
            provides: ["LateRetirementHandlerDependency"],
          },
          setup(context) {
            ownerSignal = (context as AbortAwareExtensionContext).signal;
            context.provide("LateRetirementHandlerDependency", owned);
          },
        })),
      ], {});
      if (ownerSignal === undefined) {
        throw new Error("Expected the owner extension abort signal");
      }
      ownerSignal.addEventListener(
        "abort",
        () => retirementStarted.resolve(),
        { once: true },
      );
      const snapshot = trySnapshotContractForUse(
        "LateRetirementHandlerDependency",
      );
      if (snapshot === undefined) {
        throw new Error("Expected a late retirement-handler contract snapshot");
      }
      const lease = acquireContractLease(snapshot.reference);

      reset();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("late-retirement-handler-replacement", {
          contracts: {
            provides: ["LateRetirementHandlerDependency"],
          },
          setup(context) {
            context.provide(
              "LateRetirementHandlerDependency",
              replacement,
            );
          },
        })),
      ], {});

      const teardown = ownerLoader.teardownAll();
      await retirementStarted.promise;
      let resetFailure: unknown;
      let resolvedInHandler: unknown = owned;
      lease.setRetirementHandler(() => {
        try {
          resolvedInHandler = tryResolve(
            "LateRetirementHandlerDependency",
          );
          try {
            reset();
          } catch (error) {
            resetFailure = error;
          }
        } finally {
          lease.release();
        }
      });
      await teardown;

      assertEquals(resolvedInHandler, undefined);
      assertEquals(resetFailure instanceof Error, true);
      assertEquals(
        tryResolve("LateRetirementHandlerDependency"),
        replacement,
      );
      await replacementLoader.teardownAll();
    });

    it("revokes detached rollback descendants before a same-epoch replacement", async () => {
      const candidateDependency = Object.freeze({ id: "same-epoch-candidate" });
      const replacementDependency = Object.freeze({ id: "same-epoch-replacement" });
      const continueDescendant = Promise.withResolvers<void>();
      const descendantSettled = Promise.withResolvers<void>();
      let descendantDependency: unknown = candidateDependency;
      let descendantFailure: unknown;
      let descendantLoader: ExtensionLoader | undefined;
      let descendantSetupCalls = 0;
      const provider = makeExt("detached-same-epoch-provider", {
        contracts: { provides: ["DetachedSameEpochDependency"] },
        setup(context) {
          context.provide("DetachedSameEpochDependency", candidateDependency);
        },
        teardown() {
          void (async () => {
            await continueDescendant.promise;
            descendantDependency = tryResolve("DetachedSameEpochDependency");
            descendantLoader = new ExtensionLoader(noopLogger);
            try {
              await descendantLoader.setupAll([
                makeResolved(makeExt("detached-same-epoch-nested", {
                  setup() {
                    descendantSetupCalls += 1;
                  },
                })),
              ], {});
            } catch (error) {
              descendantFailure = error;
            }
            descendantSettled.resolve();
          })();
        },
      });
      const setupFailure = new Error("same epoch setup failed");
      const failing = makeExt("detached-same-epoch-failure", {
        setup() {
          throw setupFailure;
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const failure = await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(failing)], {}),
        Error,
      );
      assertEquals((failure as Error).message, setupFailure.message);
      await loader.setupAll([
        makeResolved(makeExt("detached-same-epoch-replacement", {
          contracts: { provides: ["DetachedSameEpochDependency"] },
          setup(context) {
            context.provide(
              "DetachedSameEpochDependency",
              replacementDependency,
            );
          },
        })),
      ], {});

      continueDescendant.resolve();
      await descendantSettled.promise;
      assertEquals(descendantDependency, undefined);
      assertEquals(descendantFailure instanceof Error, true);
      assertEquals(
        descendantFailure instanceof Error
          ? descendantFailure.message.includes("during extension teardown")
          : false,
        true,
      );
      assertEquals(descendantSetupCalls, 0);
      assertEquals(
        tryResolve("DetachedSameEpochDependency"),
        replacementDependency,
      );
      if (descendantLoader !== undefined) {
        await descendantLoader.teardownAll();
      }
      await loader.teardownAll();
    });

    it("blocks detached rollback descendants from starting a new generation", async () => {
      const continueDescendant = Promise.withResolvers<void>();
      const descendantSettled = Promise.withResolvers<void>();
      let descendantFailure: unknown;
      let descendantLoader: ExtensionLoader | undefined;
      let descendantSetupCalls = 0;
      const provider = makeExt("detached-generation-provider", {
        teardown() {
          void (async () => {
            await continueDescendant.promise;
            descendantLoader = new ExtensionLoader(noopLogger);
            try {
              await descendantLoader.setupAll([
                makeResolved(makeExt("detached-generation-replacement", {
                  contracts: { provides: ["DetachedGenerationDependency"] },
                  setup(context) {
                    descendantSetupCalls += 1;
                    context.provide(
                      "DetachedGenerationDependency",
                      { id: "detached" },
                    );
                  },
                })),
              ], {});
            } catch (error) {
              descendantFailure = error;
            }
            descendantSettled.resolve();
          })();
        },
      });
      const setupFailure = new Error("detached generation setup failed");
      const failing = makeExt("detached-generation-failure", {
        setup() {
          throw setupFailure;
        },
      });
      const loader = new ExtensionLoader(noopLogger);

      const failure = await assertRejects(
        () => loader.setupAll([makeResolved(provider), makeResolved(failing)], {}),
        Error,
      );
      assertEquals((failure as Error).message, setupFailure.message);
      reset();

      continueDescendant.resolve();
      await descendantSettled.promise;
      assertEquals(descendantFailure instanceof Error, true);
      assertEquals(
        descendantFailure instanceof Error
          ? descendantFailure.message.includes("during extension teardown")
          : false,
        true,
      );
      assertEquals(tryResolve("DetachedGenerationDependency"), undefined);
      assertEquals(descendantSetupCalls, 0);
      if (descendantLoader !== undefined) {
        await descendantLoader.teardownAll();
      }
      await loader.teardownAll();
    });

    it("blocks stale teardown scopes from committing a pre-existing generation", async () => {
      const staleGeneration = beginContractGeneration();
      sealContractGeneration(staleGeneration);
      reset();
      const currentGeneration = beginContractGeneration();
      const staged = Object.freeze({ id: "pre-existing" });
      stageContract(
        currentGeneration,
        "PreExistingGenerationContract",
        staged,
      );

      await assertRejects(
        () =>
          runWithContractGenerationResolution(
            staleGeneration,
            () => commitContractGeneration(currentGeneration),
          ),
        Error,
        "during extension teardown",
      );
      assertEquals(tryResolve("PreExistingGenerationContract"), undefined);
      commitContractGeneration(currentGeneration);
      assertEquals(tryResolve("PreExistingGenerationContract"), staged);
      reset();
    });

    it("isolates a successful teardown from replacements committed after reset", async () => {
      const activeDependency = Object.freeze({ id: "active" });
      const replacementDependency = Object.freeze({ id: "replacement" });
      const teardownPaused = Promise.withResolvers<void>();
      const continueTeardown = Promise.withResolvers<void>();
      let teardownDependency: unknown = activeDependency;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("successful-reset-owner", {
          contracts: { provides: ["SuccessfulResetDependency"] },
          setup(context) {
            context.provide("SuccessfulResetDependency", activeDependency);
          },
          async teardown() {
            teardownPaused.resolve();
            await continueTeardown.promise;
            teardownDependency = tryResolve("SuccessfulResetDependency");
          },
        })),
      ], {});
      const teardown = loader.teardownAll();

      await teardownPaused.promise;
      reset();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("successful-reset-replacement", {
          contracts: { provides: ["SuccessfulResetDependency"] },
          setup(context) {
            context.provide(
              "SuccessfulResetDependency",
              replacementDependency,
            );
          },
        })),
      ], {});

      continueTeardown.resolve();
      await teardown;
      assertEquals(teardownDependency, undefined);
      assertEquals(
        tryResolve("SuccessfulResetDependency"),
        replacementDependency,
      );
      await replacementLoader.teardownAll();
    });

    it("blocks lifecycle-aware resolution inside a stale teardown scope", async () => {
      const teardownPaused = Promise.withResolvers<void>();
      const continueTeardown = Promise.withResolvers<void>();
      let snapshotFailure: unknown;
      let capturedReplacement: unknown;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("snapshot-reset-owner", {
          teardown: async () => {
            teardownPaused.resolve();
            await continueTeardown.promise;
            try {
              capturedReplacement = trySnapshotContractForUse(
                "SnapshotResetDependency",
              );
            } catch (error) {
              snapshotFailure = error;
            }
          },
        })),
      ], {});
      const teardown = loader.teardownAll();

      await teardownPaused.promise;
      reset();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("snapshot-reset-replacement", {
          contracts: { provides: ["SnapshotResetDependency"] },
          setup(context) {
            context.provide("SnapshotResetDependency", { id: "replacement" });
          },
        })),
      ], {});

      continueTeardown.resolve();
      await teardown;
      assertEquals(capturedReplacement, undefined);
      assertEquals(snapshotFailure instanceof Error, true);
      assertEquals(
        snapshotFailure instanceof Error
          ? snapshotFailure.message.includes("during extension teardown")
          : false,
        true,
      );
      await replacementLoader.teardownAll();
    });

    it("blocks replacement lease acquisition inside a stale teardown scope", async () => {
      const teardownPaused = Promise.withResolvers<void>();
      const continueTeardown = Promise.withResolvers<void>();
      const replacement = {
        snapshot: undefined as Readonly<ContractSnapshot<unknown>> | undefined,
      };
      let leaseAcquired = false;
      let leaseFailure: unknown;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("lease-reset-owner", {
          teardown: async () => {
            teardownPaused.resolve();
            await continueTeardown.promise;
            if (replacement.snapshot === undefined) {
              throw new Error("Expected a replacement snapshot");
            }
            try {
              const lease = acquireContractLease(
                replacement.snapshot.reference,
              );
              leaseAcquired = true;
              lease.release();
            } catch (error) {
              leaseFailure = error;
            }
          },
        })),
      ], {});
      const teardown = loader.teardownAll();

      await teardownPaused.promise;
      reset();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("lease-reset-replacement", {
          contracts: { provides: ["LeaseResetDependency"] },
          setup(context) {
            context.provide("LeaseResetDependency", { id: "replacement" });
          },
        })),
      ], {});
      replacement.snapshot = trySnapshotContractForUse(
        "LeaseResetDependency",
      );

      continueTeardown.resolve();
      await teardown;
      assertEquals(leaseAcquired, false);
      assertEquals(leaseFailure instanceof Error, true);
      assertEquals(
        leaseFailure instanceof Error
          ? leaseFailure.message.includes("during extension teardown")
          : false,
        true,
      );
      await replacementLoader.teardownAll();
    });

    it("blocks stale teardown mutations without restricting current teardown", async () => {
      const replacementRegistered = Object.freeze({ id: "registered-replacement" });
      const staleRegistered = Object.freeze({ id: "stale-registration" });
      const replacementUnregistered = Object.freeze({ id: "unregister-replacement" });
      const teardownPaused = Promise.withResolvers<void>();
      const continueTeardown = Promise.withResolvers<void>();
      let registerFailure: unknown;
      let resetFailure: unknown;
      let unregisterFailure: unknown;
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("mutation-reset-owner", {
          teardown: async () => {
            teardownPaused.resolve();
            await continueTeardown.promise;
            try {
              register("StaleRegisterDependency", staleRegistered);
            } catch (error) {
              registerFailure = error;
            }
            try {
              unregister("StaleUnregisterDependency");
            } catch (error) {
              unregisterFailure = error;
            }
            try {
              reset();
            } catch (error) {
              resetFailure = error;
            }
          },
        })),
      ], {});
      const teardown = loader.teardownAll();

      await teardownPaused.promise;
      reset();
      const replacementLoader = new ExtensionLoader(noopLogger);
      await replacementLoader.setupAll([
        makeResolved(makeExt("mutation-reset-replacement", {
          contracts: {
            provides: [
              "StaleRegisterDependency",
              "StaleUnregisterDependency",
            ],
          },
          setup(context) {
            context.provide(
              "StaleRegisterDependency",
              replacementRegistered,
            );
            context.provide(
              "StaleUnregisterDependency",
              replacementUnregistered,
            );
          },
        })),
      ], {});

      continueTeardown.resolve();
      await teardown;
      assertEquals(registerFailure instanceof Error, true);
      assertEquals(resetFailure instanceof Error, true);
      assertEquals(unregisterFailure instanceof Error, true);
      assertEquals(
        tryResolve("StaleRegisterDependency"),
        replacementRegistered,
      );
      assertEquals(
        tryResolve("StaleUnregisterDependency"),
        replacementUnregistered,
      );
      await replacementLoader.teardownAll();
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

    it("clears prior static and failing dynamic registrations on failure", async () => {
      let staticTeardownCount = 0;
      let dynamicTeardownCount = 0;
      const staticProvider = makeExt("static-provider", {
        provides: { StaticLeak: { leaked: true } },
        teardown() {
          staticTeardownCount++;
        },
      });
      const failing = makeExt("first-failing", {
        contracts: { provides: ["DynamicLeak"] },
        setup(ctx) {
          ctx.provide("DynamicLeak", { leaked: true });
          throw new Error("first-failure");
        },
        teardown() {
          dynamicTeardownCount++;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await assertRejects(
        () =>
          loader.setupAll([
            makeResolved(staticProvider),
            makeResolved(failing),
          ], {}),
        Error,
        "first-failure",
      );

      assertEquals(staticTeardownCount, 1);
      assertEquals(dynamicTeardownCount, 1);
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

    it("escapes invalid extension names in validation errors", async () => {
      const loader = new ExtensionLoader(noopLogger);
      let message = "";
      try {
        await loader.setupAll([
          makeResolved({
            name: "evil\nFORGED",
            version: "1.0.0",
            capabilities: [],
          }),
        ], {});
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      assertEquals(
        message.startsWith('Extension "<invalid>" is invalid:\n'),
        true,
      );
      assertEquals(message.split("\n")[0], 'Extension "<invalid>" is invalid:');
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

    it("rejects inherited replacement metadata before active teardown", async () => {
      let activeTeardownCount = 0;
      const active = makeExt("active", {
        provides: { ActiveContract: { active: true } },
        teardown() {
          activeTeardownCount++;
        },
      });
      const inherited = Object.assign(
        Object.create({ contracts: { provides: ["Danger"] } }),
        {
          name: "inherited",
          version: "1.0.0",
          capabilities: [],
          setup(ctx: ExtensionContext) {
            ctx.provide("Danger", {});
          },
        },
      ) as Extension;

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});
      await assertRejects(
        () => loader.setupAll([makeResolved(inherited)], {}),
        Error,
        'Extension "inherited" is invalid',
      );
      assertEquals(activeTeardownCount, 0);
      assertEquals(tryResolve("ActiveContract"), { active: true });
    });

    it("revalidates descriptor snapshots before active teardown", async () => {
      let activeTeardownCount = 0;
      let nameInspections = 0;
      const active = makeExt("active", {
        teardown() {
          activeTeardownCount++;
        },
      });
      const target = makeExt("replacement", { setup() {} });
      const replacement = new Proxy(target, {
        getOwnPropertyDescriptor(object, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
          if (property === "name" && descriptor && ++nameInspections > 1) {
            return { ...descriptor, value: "evil\nFORGED" };
          }
          return descriptor;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});
      await assertRejects(
        () => loader.setupAll([makeResolved(replacement)], {}),
        TypeError,
        "extension.name changed after validation",
      );
      assertEquals(activeTeardownCount, 0);
    });

    it("maps the exact captured capabilities before active teardown", async () => {
      let activeTeardownCount = 0;
      let capabilityInspections = 0;
      const active = makeExt("active", {
        teardown() {
          activeTeardownCount++;
        },
      });
      const target = makeExt("replacement");
      const oversized = [{
        type: "env:read",
        keys: ["A", "B", "C"].map((prefix) => `${prefix}_${"x".repeat(3_000)}`),
      }] as Capability[];
      const replacement = new Proxy(target, {
        getOwnPropertyDescriptor(object, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
          if (
            property === "capabilities" && descriptor &&
            ++capabilityInspections > 1
          ) {
            return { ...descriptor, value: oversized };
          }
          return descriptor;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});
      await assertRejects(
        () => loader.setupAll([makeResolved(replacement)], {}),
        TypeError,
        "Deno permission flags exceed",
      );
      assertEquals(activeTeardownCount, 0);
    });

    it("snapshots capability audit metadata before replacing the active generation", async () => {
      let activeTeardownCount = 0;
      let replacementSetupCount = 0;
      const debugCalls: unknown[][] = [];
      const logger: ExtensionLogger = {
        ...noopLogger,
        debug(message, ...args) {
          debugCalls.push([message, ...args]);
        },
      };
      const active = makeExt("active", {
        provides: { ActiveContract: { active: true } },
        teardown() {
          activeTeardownCount++;
        },
      });
      const capabilityArray = new Proxy(
        [{ type: "env:read", keys: ["SAFE_KEY"] }] as Capability[],
        {
          get(target, property, receiver) {
            if (property === "length" || property === "map") {
              throw new Error("live capability metadata was read");
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      const replacement = makeExt("replacement", {
        capabilities: capabilityArray,
        setup() {
          replacementSetupCount++;
        },
      });

      const loader = new ExtensionLoader(logger);
      await loader.setupAll([makeResolved(active)], {});
      await loader.setupAll([makeResolved(replacement)], {});

      assertEquals(activeTeardownCount, 1);
      assertEquals(replacementSetupCount, 1);
      assertEquals(
        debugCalls.filter(([message]) =>
          typeof message === "string" && message.includes("declares capabilities")
        ),
        [[
          'Extension "replacement" declares capabilities:',
          '"env:read" ("keys": ["SAFE_KEY"])',
        ]],
      );
    });

    it("uses immutable contract snapshots throughout replacement activation", async () => {
      let activeTeardownCount = 0;
      const active = makeExt("active", {
        provides: { ActiveContract: { active: true } },
        teardown() {
          activeTeardownCount++;
        },
      });
      const legacyImplementation = { source: "legacy" };
      const legacyProvides = new Proxy({ Danger: legacyImplementation }, {
        get(target, property, receiver) {
          if (property === "Danger") {
            throw new Error("live legacy implementation was read");
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const modernProvides = new Proxy(["DynamicContract"], {
        get(target, property, receiver) {
          if (property === "filter" || property === "length") {
            throw new Error("live modern contract metadata was read");
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const legacy = makeExt("legacy", { provides: legacyProvides });
      const modern = makeExt("modern", {
        contracts: { provides: modernProvides },
        setup(ctx) {
          ctx.provide("DynamicContract", { source: "modern" });
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});
      await loader.setupAll([makeResolved(legacy), makeResolved(modern)], {});

      assertEquals(activeTeardownCount, 1);
      assertEquals(tryResolve("Danger"), legacyImplementation);
      assertEquals(tryResolve("DynamicContract"), { source: "modern" });
    });

    it("uses snapshotted lifecycle metadata after the activation barrier", async () => {
      let activeTeardownCount = 0;
      let replacementSetupCount = 0;
      let replacementTeardownCount = 0;
      const active = makeExt("active", {
        teardown() {
          activeTeardownCount++;
        },
      });
      const replacement = makeExt("replacement", {
        capabilities: [{ type: "env:read", keys: ["SAFE_KEY"] }],
        setup() {
          replacementSetupCount++;
        },
        teardown() {
          replacementTeardownCount++;
        },
      });

      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([makeResolved(active)], {});
      await loader.setupAll([makeResolved(replacement)], {}, {
        beforeActivate() {
          replacement.name = "mutated";
          replacement.version = "mutated";
          replacement.capabilities = new Proxy([], {
            get() {
              throw new Error("live capabilities were read");
            },
          });
          replacement.setup = () => {
            throw new Error("live setup was called");
          };
          replacement.teardown = () => {
            throw new Error("live teardown was called");
          };
        },
      });
      await loader.teardownAll();

      assertEquals(activeTeardownCount, 1);
      assertEquals(replacementSetupCount, 1);
      assertEquals(replacementTeardownCount, 1);
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

    it("keeps teardown aggregation total for hostile thrown values", async () => {
      const hostile = {
        toString(): string {
          throw new Error("string conversion failed");
        },
      };
      const loader = new ExtensionLoader(noopLogger);
      await loader.setupAll([
        makeResolved(makeExt("hostile-teardown", {
          teardown() {
            throw hostile;
          },
        })),
      ], {});

      const error = await assertRejects(
        () => loader.teardownAll(),
        AggregateError,
        "[unprintable thrown value]",
      );
      assertEquals((error as AggregateError).errors, [hostile]);
    });
  });
});

describe("ExtensionLoader primeContracts", () => {
  afterEach(() => {
    reset();
  });

  it("rejects stale teardown scopes before inspecting or retaining primed contracts", async () => {
    const staleGeneration = beginContractGeneration();
    sealContractGeneration(staleGeneration);
    reset();

    const loader = new ExtensionLoader(noopLogger);
    const injected = Object.freeze({ id: "stale" });
    let inspectionCalls = 0;
    const hostileContracts = new Proxy(
      Object.create(null) as Record<string, unknown>,
      {
        ownKeys() {
          inspectionCalls += 1;
          return ["Bridge"];
        },
        getOwnPropertyDescriptor(_target, name) {
          inspectionCalls += 1;
          return name === "Bridge"
            ? {
              configurable: true,
              enumerable: true,
              value: injected,
              writable: true,
            }
            : undefined;
        },
      },
    );

    await assertRejects(
      () =>
        runWithContractGenerationResolution(
          staleGeneration,
          () => loader.primeContracts(hostileContracts),
        ),
      Error,
      "during extension teardown",
    );
    assertEquals(inspectionCalls, 0);

    await loader.setupAll([], {});
    assertEquals(tryResolve("Bridge"), undefined);
    await loader.teardownAll();

    const trusted = Object.freeze({ id: "trusted" });
    loader.primeContracts({ Bridge: trusted });
    await loader.setupAll([], {});
    assertEquals(tryResolve("Bridge"), trusted);
    await loader.teardownAll();
  });

  it("rejects blank names and undefined implementations before activation", () => {
    const loader = new ExtensionLoader(noopLogger);

    assertThrows(
      () => loader.primeContracts({ " ": { active: true } }),
      TypeError,
      "contract name must be a non-empty string without surrounding whitespace",
    );
    assertThrows(
      () => loader.primeContracts({ Missing: undefined }),
      TypeError,
      'Primed contract "Missing" must not be undefined',
    );
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

  it("clears primed-only registrations during teardown", async () => {
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ PrimedOnly: { value: true } });

    await loader.setupAll([], {});
    assertEquals(tryResolve("PrimedOnly"), { value: true });

    await loader.teardownAll();
    assertEquals(tryResolve("PrimedOnly"), undefined);
  });
});
