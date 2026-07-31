import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type SkillScriptExecutionReporter,
  type SkillScriptExecutorProvider,
  SkillScriptExecutorProviderName,
  snapshotSkillScriptExecutorProvider,
} from "#veryfront/extensions/skill/script-executor-provider.ts";
import { createIntrinsicPromiseContinuation } from "../extensions/promise-intrinsics-internal.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { createSkillOperationBudget, SkillOperationTimeoutError } from "./operation-budget.ts";
import {
  executeSkillScriptWithProvider,
  resolveSkillScriptExecutionBackend,
} from "./provider-executor.ts";
import type { SkillScriptExecutor } from "./types.ts";

type Settlement<T> =
  | { readonly kind: "fulfilled"; readonly value: T }
  | { readonly kind: "rejected"; readonly reason: unknown }
  | { readonly kind: "pending" };

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 20): Promise<Settlement<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): Settlement<T> => ({ kind: "fulfilled", value }),
        (reason: unknown): Settlement<T> => ({ kind: "rejected", reason }),
      ),
      new Promise<Settlement<T>>((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: "pending" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function withRegisteredProvider<T>(
  provider: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = tryResolve<unknown>(SkillScriptExecutorProviderName);
  register(SkillScriptExecutorProviderName, provider);
  try {
    return await run();
  } finally {
    unregister(SkillScriptExecutorProviderName);
    if (previous !== undefined) register(SkillScriptExecutorProviderName, previous);
  }
}

function providerForResult(label: string): SkillScriptExecutorProvider {
  return {
    prepare(_input, reporter) {
      return {
        activate() {
          reporter.resolveResult({ stdout: label, stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
}

Deno.test("skill provider backend gives an explicit executor absolute precedence", async () => {
  let providerTrapCalls = 0;
  const hostileProvider = new Proxy({}, {
    ownKeys() {
      providerTrapCalls += 1;
      throw new Error("registered provider must not be inspected");
    },
  });
  const explicit: SkillScriptExecutor = {
    execute: () => Promise.resolve({ stdout: "explicit", stderr: "", exitCode: 0 }),
  };

  await withRegisteredProvider(hostileProvider, () => {
    const backend = resolveSkillScriptExecutionBackend(explicit);
    assertEquals(backend.kind, "executor");
    if (backend.kind === "executor") assertEquals(backend.executor, explicit);
    assertEquals(providerTrapCalls, 0);
  });
});

Deno.test("skill provider backend preserves built-ins only when no provider is registered", () => {
  const previous = tryResolve<unknown>(SkillScriptExecutorProviderName);
  unregister(SkillScriptExecutorProviderName);
  try {
    const backend = resolveSkillScriptExecutionBackend();
    assertEquals(backend.kind, "executor");
  } finally {
    if (previous !== undefined) register(SkillScriptExecutorProviderName, previous);
  }
});

Deno.test("skill provider backend fails closed for malformed registrations", async () => {
  await withRegisteredProvider(
    { prepare: "not a function" },
    () => {
      assertThrows(
        () => resolveSkillScriptExecutionBackend(),
        TypeError,
        "function data property",
      );
    },
  );
});

Deno.test("skill provider backend snapshots each registry generation per execution", async () => {
  const previous = tryResolve<unknown>(SkillScriptExecutorProviderName);
  try {
    register(SkillScriptExecutorProviderName, providerForResult("generation-a"));
    const first = resolveSkillScriptExecutionBackend();
    assertEquals(first.kind, "provider");

    register(SkillScriptExecutorProviderName, providerForResult("generation-b"));
    const second = resolveSkillScriptExecutionBackend();
    assertEquals(second.kind, "provider");
    if (first.kind !== "provider" || second.kind !== "provider") return;

    const firstResult = await executeSkillScriptWithProvider(
      first.provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
    const secondResult = await executeSkillScriptWithProvider(
      second.provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
    assertEquals(firstResult.stdout, "generation-a");
    assertEquals(secondResult.stdout, "generation-b");
  } finally {
    unregister(SkillScriptExecutorProviderName);
    if (previous !== undefined) register(SkillScriptExecutorProviderName, previous);
  }
});

Deno.test("skill provider execution pins an in-flight generation across registry replacement", async () => {
  const previous = tryResolve<unknown>(SkillScriptExecutorProviderName);
  let firstReporter!: Readonly<SkillScriptExecutionReporter>;
  let firstActivationCalls = 0;
  try {
    register(SkillScriptExecutorProviderName, {
      prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
        firstReporter = reporter;
        return {
          activate() {
            firstActivationCalls += 1;
          },
          terminate(reason?: unknown) {
            reporter.rejectResult(reason);
            reporter.resolveTerminal();
          },
        };
      },
    });
    const first = resolveSkillScriptExecutionBackend();
    assertEquals(first.kind, "provider");
    if (first.kind !== "provider") return;
    const firstExecution = executeSkillScriptWithProvider(
      first.provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
    assertEquals(firstActivationCalls, 1);

    register(SkillScriptExecutorProviderName, providerForResult("generation-b"));
    const second = resolveSkillScriptExecutionBackend();
    assertEquals(second.kind, "provider");
    if (second.kind !== "provider") return;

    firstReporter.resolveResult({ stdout: "generation-a", stderr: "", exitCode: 0 });
    firstReporter.resolveTerminal();
    assertEquals((await firstExecution).stdout, "generation-a");
    assertEquals(
      (
        await executeSkillScriptWithProvider(
          second.provider,
          { scriptPath: "/skills/demo/scripts/run.ts" },
          createSkillOperationBudget({ timeoutMs: 1_000 }),
        )
      ).stdout,
      "generation-b",
    );
  } finally {
    unregister(SkillScriptExecutorProviderName);
    if (previous !== undefined) register(SkillScriptExecutorProviderName, previous);
  }
});

Deno.test("skill provider execution remains pending until terminal cleanup", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return {
        activate() {
          reporter.resolveResult({ stdout: "done", stderr: "", exitCode: 0 });
        },
        terminate(reason?: unknown) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });
  const execution = executeSkillScriptWithProvider(
    provider,
    { scriptPath: "/skills/demo/scripts/run.ts" },
    createSkillOperationBudget({ timeoutMs: 1_000 }),
  );

  assertEquals((await settleWithin(execution)).kind, "pending");
  reporter.resolveTerminal();
  assertEquals(await execution, { stdout: "done", stderr: "", exitCode: 0 });
});

Deno.test("skill provider execution terminates without activation when aborted during prepare", async () => {
  const controller = new AbortController();
  const cancellation = new Error("cancel before activation");
  let activationCalls = 0;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      controller.abort(cancellation);
      return {
        activate() {
          activationCalls += 1;
        },
        terminate(reason?: unknown) {
          terminationCalls += 1;
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  await assertRejects(
    () =>
      executeSkillScriptWithProvider(
        provider,
        {
          scriptPath: "/skills/demo/scripts/run.ts",
          abortSignal: controller.signal,
        },
        createSkillOperationBudget({
          abortSignal: controller.signal,
          timeoutMs: 1_000,
        }),
      ),
    Error,
    "cancel before activation",
  );
  assertEquals(activationCalls, 0);
  assertEquals(terminationCalls, 1);
});

Deno.test("skill provider execution forwards active cancellation once and drains cleanup", async () => {
  const controller = new AbortController();
  const cancellation = new Error("cancel active execution");
  let terminationCalls = 0;
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return {
        activate() {
          controller.abort(cancellation);
        },
        terminate(reason?: unknown) {
          terminationCalls += 1;
          reporter.rejectResult(reason);
          queueMicrotask(() => reporter.resolveTerminal());
        },
      };
    },
  });

  await assertRejects(
    () =>
      executeSkillScriptWithProvider(
        provider,
        {
          scriptPath: "/skills/demo/scripts/run.ts",
          abortSignal: controller.signal,
        },
        createSkillOperationBudget({
          abortSignal: controller.signal,
          timeoutMs: 1_000,
        }),
      ),
    Error,
    "cancel active execution",
  );
  assertEquals(terminationCalls, 1);
});

Deno.test("skill provider timeout bounds uncooperative cleanup after its grace", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return {
        activate() {},
        terminate(reason?: unknown) {
          terminationCalls += 1;
          reporter.rejectResult(reason);
        },
      };
    },
  });
  const execution = executeSkillScriptWithProvider(
    provider,
    { scriptPath: "/skills/demo/scripts/run.ts" },
    createSkillOperationBudget({ timeoutMs: 5 }),
    undefined,
    10,
  );

  const settlement = await settleWithin(execution, 50);
  assertEquals(settlement.kind, "rejected");
  assertEquals(
    settlement.kind === "rejected" && settlement.reason instanceof SkillOperationTimeoutError,
    true,
  );
  assertEquals(terminationCalls, 1);
  reporter.resolveTerminal();
  await Promise.resolve();
});

Deno.test("skill provider abort bounds uncooperative cleanup after its grace", async () => {
  const controller = new AbortController();
  const cancellation = new Error("cancel uncooperative execution");
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return {
        activate() {
          controller.abort(cancellation);
        },
        terminate(reason?: unknown) {
          terminationCalls += 1;
          reporter.rejectResult(reason);
        },
      };
    },
  });
  const execution = executeSkillScriptWithProvider(
    provider,
    {
      scriptPath: "/skills/demo/scripts/run.ts",
      abortSignal: controller.signal,
    },
    createSkillOperationBudget({
      abortSignal: controller.signal,
      timeoutMs: 1_000,
    }),
    undefined,
    10,
  );

  const settlement = await settleWithin(execution, 50);
  assertEquals(settlement.kind, "rejected");
  assertEquals(
    settlement.kind === "rejected" ? settlement.reason : undefined,
    cancellation,
  );
  assertEquals(terminationCalls, 1);
  reporter.resolveTerminal();
  await Promise.resolve();
});

Deno.test("skill provider execution aggregates independent result and cleanup failures", async () => {
  const resultFailure = new Error("script failed");
  const cleanupFailure = new Error("cleanup failed");
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      return {
        activate() {
          reporter.rejectResult(resultFailure);
          reporter.rejectTerminal(cleanupFailure);
        },
        terminate() {},
      };
    },
  });

  let failure: unknown;
  try {
    await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
  } catch (error) {
    failure = error;
  }

  assertEquals(failure instanceof AggregateError, true);
  assertEquals(
    failure instanceof AggregateError ? failure.errors : [],
    [resultFailure, cleanupFailure],
  );
});

Deno.test("skill provider execution retains reported and synchronous activation failures", async () => {
  const resultFailure = new Error("reported result failed");
  const cleanupFailure = new Error("reported cleanup failed");
  const activationFailure = new Error("activation threw");
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      return {
        activate() {
          reporter.rejectResult(resultFailure);
          reporter.rejectTerminal(cleanupFailure);
          throw activationFailure;
        },
        terminate() {},
      };
    },
  });

  let failure: unknown;
  try {
    await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
  } catch (error) {
    failure = error;
  }

  assertEquals(failure instanceof AggregateError, true);
  assertEquals(
    failure instanceof AggregateError ? failure.errors : [],
    [resultFailure, cleanupFailure, activationFailure],
  );
});

Deno.test("skill provider execution retains reentrant termination and activation failures", async () => {
  const controller = new AbortController();
  const cancellation = new Error("cancel reentrant execution");
  const terminationFailure = new Error("reentrant termination threw");
  const activationFailure = new Error("activation also threw");
  const provider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return {
        activate() {
          controller.abort(cancellation);
          throw activationFailure;
        },
        terminate() {
          throw terminationFailure;
        },
      };
    },
  });

  let failure: unknown;
  try {
    await executeSkillScriptWithProvider(
      provider,
      {
        scriptPath: "/skills/demo/scripts/run.ts",
        abortSignal: controller.signal,
      },
      createSkillOperationBudget({
        abortSignal: controller.signal,
        timeoutMs: 1_000,
      }),
    );
  } catch (error) {
    failure = error;
  }

  assertEquals(failure instanceof AggregateError, true);
  assertEquals(
    failure instanceof AggregateError ? failure.errors : [],
    [terminationFailure, activationFailure, cancellation],
  );
});

Deno.test("skill provider execution never treats throw undefined as success", async () => {
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      return {
        activate() {
          reporter.resolveResult({ stdout: "reported", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
          throw undefined;
        },
        terminate() {},
      };
    },
  });

  let rejected = false;
  let reason: unknown = "unset";
  try {
    await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
  } catch (error) {
    rejected = true;
    reason = error;
  }

  assertEquals(rejected, true);
  assertEquals(reason, undefined);
});

Deno.test("skill provider execution rejects synchronous success after the monotonic deadline", async () => {
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      return {
        activate() {
          const startedAt = performance.now();
          while (performance.now() - startedAt < 15) {
            // Deliberately keep the timer task from running past the deadline.
          }
          reporter.resolveResult({ stdout: "late", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate() {},
      };
    },
  });

  await assertRejects(
    () =>
      executeSkillScriptWithProvider(
        provider,
        { scriptPath: "/skills/demo/scripts/run.ts" },
        createSkillOperationBudget({ timeoutMs: 1 }),
      ),
    SkillOperationTimeoutError,
    "timed out after 1ms",
  );
});

Deno.test("skill provider execution gives total timeout precedence over late activation failure", async () => {
  const activationFailure = new Error("late activation failure");
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      return {
        activate() {
          const startedAt = performance.now();
          while (performance.now() - startedAt < 15) {
            // Deliberately keep the timer task from running past the deadline.
          }
          reporter.resolveResult({ stdout: "late", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
          throw activationFailure;
        },
        terminate() {},
      };
    },
  });

  await assertRejects(
    () =>
      executeSkillScriptWithProvider(
        provider,
        { scriptPath: "/skills/demo/scripts/run.ts" },
        createSkillOperationBudget({ timeoutMs: 1 }),
      ),
    SkillOperationTimeoutError,
    "timed out after 1ms",
  );
});

Deno.test("skill provider execution surfaces cleanup failure alongside timeout", async () => {
  const cleanupFailure = new Error("timeout cleanup failed");
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      return {
        activate() {},
        terminate(reason?: unknown) {
          reporter.rejectResult(reason);
          reporter.rejectTerminal(cleanupFailure);
        },
      };
    },
  });

  let failure: unknown;
  try {
    await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1 }),
    );
  } catch (error) {
    failure = error;
  }

  assertEquals(failure instanceof AggregateError, true);
  assertEquals(failure instanceof AggregateError ? failure.errors.length : 0, 2);
  assertEquals(failure instanceof AggregateError ? failure.errors[0] : undefined, cleanupFailure);
  assertEquals(
    failure instanceof AggregateError &&
      failure.errors[1] instanceof SkillOperationTimeoutError,
    true,
  );
});

Deno.test("skill provider timeout retains cleanup throw after a terminal success report", async () => {
  const activationFailure = new Error("late activation failed");
  const cleanupFailure = new Error("cleanup threw after success report");
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return {
        activate() {
          const startedAt = performance.now();
          while (performance.now() - startedAt < 15) {
            // Block past the deadline before failing activation.
          }
          throw activationFailure;
        },
        terminate() {
          reporter.resolveTerminal();
          throw cleanupFailure;
        },
      };
    },
  });

  let failure: unknown;
  try {
    await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1 }),
    );
  } catch (error) {
    failure = error;
  }

  assertEquals(failure instanceof AggregateError, true);
  assertEquals(failure instanceof AggregateError ? failure.errors.length : 0, 2);
  const lifecycleFailure = failure instanceof AggregateError ? failure.errors[0] : undefined;
  assertEquals(lifecycleFailure instanceof AggregateError, true);
  assertEquals(
    lifecycleFailure instanceof AggregateError ? lifecycleFailure.errors : [],
    [activationFailure, cleanupFailure],
  );
  assertEquals(
    failure instanceof AggregateError &&
      failure.errors[1] instanceof SkillOperationTimeoutError,
    true,
  );
});

Deno.test("skill provider execution observes settlements without post-prepare Promise hooks", async () => {
  const originalConstructor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    "constructor",
  );
  let constructorHookCalls = 0;
  let restored = false;
  const restorePromiseConstructor = (): void => {
    if (restored) return;
    restored = true;
    Reflect.deleteProperty(Promise.prototype, "constructor");
    if (originalConstructor) {
      Object.defineProperty(Promise.prototype, "constructor", originalConstructor);
    }
  };
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get() {
          constructorHookCalls += 1;
          throw new Error("post-prepare Promise constructor hook ran");
        },
      });
      return {
        activate() {
          restorePromiseConstructor();
          reporter.resolveResult({ stdout: "safe observation", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason?: unknown) {
          restorePromiseConstructor();
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  try {
    const result = await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
    assertEquals(result.stdout, "safe observation");
    assertEquals(constructorHookCalls, 0);
  } finally {
    restorePromiseConstructor();
  }
});

Deno.test("skill provider settlement observation ignores post-prepare Promise species", async () => {
  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  const originalSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
  let hookCalls = 0;
  let activationCalls = 0;
  let restored = false;
  const restoreGlobals = (): void => {
    if (restored) return;
    restored = true;
    Reflect.deleteProperty(Object.prototype, "value");
    if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
    Reflect.deleteProperty(Promise, Symbol.species);
    if (originalSpecies) Object.defineProperty(Promise, Symbol.species, originalSpecies);
  };
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      const speciesDescriptor = Object.create(null) as PropertyDescriptor;
      speciesDescriptor.configurable = true;
      speciesDescriptor.get = () => ({} as { readonly value: typeof Promise }).value;
      Object.defineProperty(Promise, Symbol.species, speciesDescriptor);

      const valueDescriptor = Object.create(null) as PropertyDescriptor;
      valueDescriptor.configurable = true;
      valueDescriptor.get = () => {
        hookCalls += 1;
        throw new Error("post-prepare Promise species hook ran");
      };
      Object.defineProperty(Object.prototype, "value", valueDescriptor);

      return {
        activate() {
          activationCalls += 1;
          restoreGlobals();
          reporter.resolveResult({ stdout: "safe species", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason?: unknown) {
          restoreGlobals();
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  try {
    const result = await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
    assertEquals(result.stdout, "safe species");
    assertEquals(activationCalls, 1);
    assertEquals(hookCalls, 0);
  } finally {
    restoreGlobals();
  }
});

Deno.test("skill provider execution never assimilates an inherited result or settlement then", async () => {
  const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
  let thenHookCalls = 0;
  let restored = false;
  const restoreThen = (): void => {
    if (restored) return;
    restored = true;
    Reflect.deleteProperty(Object.prototype, "then");
    if (originalThen) Object.defineProperty(Object.prototype, "then", originalThen);
  };
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      Object.defineProperty(Object.prototype, "then", {
        configurable: true,
        enumerable: false,
        value: function (
          this: object,
          resolve: (value: unknown) => void,
        ): void {
          thenHookCalls += 1;
          resolve(
            Object.freeze(
              Object.create(
                null,
                Object.getOwnPropertyDescriptors(this),
              ),
            ),
          );
        },
        writable: true,
      });
      return {
        activate() {
          reporter.resolveResult({
            stdout: "genuine result",
            stderr: "",
            exitCode: 0,
          });
          reporter.resolveTerminal();
        },
        terminate(reason?: unknown) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  try {
    const result = await executeSkillScriptWithProvider(
      provider,
      { scriptPath: "/skills/demo/scripts/run.ts" },
      createSkillOperationBudget({ timeoutMs: 1_000 }),
    );
    assertEquals(result.stdout, "genuine result");
    assertEquals(Object.getPrototypeOf(result), null);
    assertEquals(thenHookCalls, 0);
  } finally {
    restoreThen();
  }
});

Deno.test("skill provider execution returns a constructor-pinned public Promise", async () => {
  const originalConstructor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    "constructor",
  );
  let constructorHookCalls = 0;
  let restored = false;
  const restorePromiseConstructor = (): void => {
    if (restored) return;
    restored = true;
    Reflect.deleteProperty(Promise.prototype, "constructor");
    if (originalConstructor) {
      Object.defineProperty(Promise.prototype, "constructor", originalConstructor);
    }
  };
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get() {
          constructorHookCalls += 1;
          throw new Error("hostile inherited constructor ran");
        },
      });
      return {
        activate() {
          reporter.resolveResult({
            stdout: "pinned outer promise",
            stderr: "",
            exitCode: 0,
          });
          reporter.resolveTerminal();
        },
        terminate(reason?: unknown) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  const execution = executeSkillScriptWithProvider(
    provider,
    { scriptPath: "/skills/demo/scripts/run.ts" },
    createSkillOperationBudget({ timeoutMs: 1_000 }),
  );
  let assimilationFailure: unknown;
  let assimilated: Promise<unknown> | undefined;
  try {
    // Await applies the same PromiseResolve constructor lookup before
    // suspending. Exercise it synchronously so the poisoned realm cannot leak
    // into the test runner's own Promise observation.
    assimilated = Promise.resolve(execution);
  } catch (error) {
    assimilationFailure = error;
  } finally {
    restorePromiseConstructor();
  }
  const result = await execution;

  assertEquals(assimilationFailure, undefined);
  assertEquals(assimilated === execution, true);
  assertEquals(
    Object.getOwnPropertyDescriptor(execution, "constructor")?.value,
    Promise,
  );
  assertEquals(result?.stdout, "pinned outer promise");
  assertEquals(constructorHookCalls, 0);
});

Deno.test("skill provider rejected execution remains observed through constructor poisoning", async () => {
  const originalConstructor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    "constructor",
  );
  const providerFailure = new Error("provider result failed");
  let constructorHookCalls = 0;
  let restored = false;
  const restorePromiseConstructor = (): void => {
    if (restored) return;
    restored = true;
    Reflect.deleteProperty(Promise.prototype, "constructor");
    if (originalConstructor) {
      Object.defineProperty(Promise.prototype, "constructor", originalConstructor);
    }
  };
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get() {
          constructorHookCalls += 1;
          throw new Error("hostile inherited constructor ran");
        },
      });
      return {
        activate() {
          reporter.rejectResult(providerFailure);
          reporter.resolveTerminal();
        },
        terminate(reason?: unknown) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  const execution = executeSkillScriptWithProvider(
    provider,
    { scriptPath: "/skills/demo/scripts/run.ts" },
    createSkillOperationBudget({ timeoutMs: 1_000 }),
  );
  type ObservedExecution =
    | { readonly fulfilled: true; readonly value: Awaited<typeof execution> }
    | { readonly fulfilled: false; readonly reason: unknown };
  const observed = createIntrinsicPromiseContinuation<
    Awaited<typeof execution>,
    ObservedExecution
  >(
    execution,
    (value) => ({ fulfilled: true as const, value }),
    (reason) => ({ fulfilled: false as const, reason }),
  );
  let assimilationFailure: unknown;
  try {
    Promise.resolve(execution);
  } catch (error) {
    assimilationFailure = error;
  } finally {
    restorePromiseConstructor();
  }
  const actualSettlement = await observed;

  assertEquals(assimilationFailure, undefined);
  assertEquals(actualSettlement.fulfilled, false);
  if (!actualSettlement.fulfilled) {
    assertEquals(actualSettlement.reason === providerFailure, true);
  }
  assertEquals(constructorHookCalls, 0);
});

Deno.test("skill provider setup uses captured clock operations and removes abort listeners", async () => {
  const originalNow = Object.getOwnPropertyDescriptor(Performance.prototype, "now");
  const controller = new AbortController();
  let clockHookCalls = 0;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      Object.defineProperty(Performance.prototype, "now", {
        configurable: true,
        value() {
          clockHookCalls += 1;
          throw new Error("mutated clock must not run");
        },
        writable: true,
      });
      return {
        activate() {
          reporter.resolveResult({ stdout: "safe clock", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason?: unknown) {
          terminationCalls += 1;
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  });

  let result;
  try {
    result = await executeSkillScriptWithProvider(
      provider,
      {
        scriptPath: "/skills/demo/scripts/run.ts",
        abortSignal: controller.signal,
      },
      createSkillOperationBudget({
        abortSignal: controller.signal,
        timeoutMs: 1_000,
      }),
    );
  } finally {
    if (originalNow) Object.defineProperty(Performance.prototype, "now", originalNow);
  }

  controller.abort(new Error("after completion"));
  assertEquals(result?.stdout, "safe clock");
  assertEquals(clockHookCalls, 0);
  assertEquals(terminationCalls, 0);
});
