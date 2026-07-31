import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  SKILL_SCRIPT_DEFAULT_TIMEOUT_MS,
  SKILL_SCRIPT_MAX_OUTPUT_BYTES,
} from "#veryfront/skill/limits.ts";
import type { SkillScriptResult } from "#veryfront/skill/types.ts";
import {
  type SkillScriptExecutionReporter,
  SkillScriptExecutorProviderName,
  snapshotSkillScriptExecutorProvider,
  snapshotSkillScriptPreparedExecution,
} from "./script-executor-provider.ts";
import { runInNewContext } from "node:vm";

const SCRIPT_RESULT: SkillScriptResult = Object.freeze({
  stdout: "ok\n",
  stderr: "",
  exitCode: 0,
});

function createPreparedExecution(
  activate: () => void = () => undefined,
  terminate: (reason?: unknown) => void = () => undefined,
) {
  return { activate, terminate };
}

Deno.test("skill script provider returns frozen core-owned lifecycle promises before activation", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  let receivedInput: unknown;
  let activationCount = 0;
  const terminationReasons: unknown[] = [];
  const sourceResult = { stdout: "ok\n", stderr: "", exitCode: 0, durationMs: 12 };
  const rawControls = createPreparedExecution(
    () => {
      activationCount += 1;
      reporter.resolveResult(sourceResult);
      reporter.resolveTerminal();
    },
    (reason) => terminationReasons.push(reason),
  );
  const source = {
    prepare(input: unknown, executionReporter: Readonly<SkillScriptExecutionReporter>) {
      receivedInput = input;
      reporter = executionReporter;
      return rawControls;
    },
  };

  const provider = snapshotSkillScriptExecutorProvider(source);
  source.prepare = () => {
    throw new Error("mutated provider callback must not run");
  };
  const input = {
    scriptPath: "/skills/report/scripts/run.ts",
    args: ["safe"],
    env: { MODE: "safe" },
  };
  const handle = provider.prepare(input);
  input.scriptPath = "/changed.ts";
  input.args[0] = "changed";
  input.env.MODE = "changed";
  rawControls.activate = () => {
    throw new Error("mutated activation callback must not run");
  };
  rawControls.terminate = () => {
    throw new Error("mutated termination callback must not run");
  };

  assertEquals(SkillScriptExecutorProviderName, "SkillScriptExecutorProvider");
  assertEquals(receivedInput, {
    scriptPath: "/skills/report/scripts/run.ts",
    args: ["safe"],
    env: { MODE: "safe" },
    timeoutMs: SKILL_SCRIPT_DEFAULT_TIMEOUT_MS,
  });
  assertEquals(receivedInput === input, false);
  assertEquals(Object.isFrozen(receivedInput), true);
  assertEquals(Object.isFrozen((receivedInput as { args: string[] }).args), true);
  assertEquals(Object.isFrozen((receivedInput as { env: object }).env), true);
  assertEquals(activationCount, 0);
  assertEquals(Object.isFrozen(reporter), true);
  assertEquals(Object.isFrozen(reporter.resolveResult), true);
  assertEquals(Object.isFrozen(provider), true);
  assertEquals(Object.isFrozen(provider.prepare), true);
  assertEquals(Object.isFrozen(handle), true);
  assertEquals(Object.isFrozen(handle.activate), true);
  assertEquals(Object.isFrozen(handle.terminate), true);

  handle.activate();
  sourceResult.stdout = "mutated";
  sourceResult.exitCode = 99;
  assertEquals(activationCount, 1);
  assertEquals(await handle.result, SCRIPT_RESULT);
  await handle.terminal;

  const reason = new Error("stop");
  handle.terminate(reason);
  handle.terminate(new Error("ignored"));
  assertEquals(terminationReasons, []);
});

Deno.test("skill script provider rejects settlement before activation and never starts work", async () => {
  let activationCount = 0;
  let terminationCount = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      reporter.resolveResult(SCRIPT_RESULT);
      reporter.resolveTerminal();
      return createPreparedExecution(
        () => activationCount++,
        () => terminationCount++,
      );
    },
  });

  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  handle.terminate();

  await assertRejects(() => handle.result, TypeError, "before activation");
  await assertRejects(() => handle.terminal, TypeError, "before activation");
  assertEquals({ activationCount, terminationCount }, { activationCount: 0, terminationCount: 0 });
});

Deno.test("skill script provider internally observes either unconsumed lifecycle rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent): void => {
    event.preventDefault();
    unhandled.push(event.reason);
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    let resultReporter!: Readonly<SkillScriptExecutionReporter>;
    const resultProvider = snapshotSkillScriptExecutorProvider({
      prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
        resultReporter = reporter;
        return createPreparedExecution();
      },
    });
    const resultHandle = resultProvider.prepare({
      scriptPath: "/skills/report/scripts/run.ts",
    });
    resultHandle.activate();
    resultReporter.rejectResult(new Error("result failure"));
    resultReporter.resolveTerminal();
    await resultHandle.terminal;

    let terminalReporter!: Readonly<SkillScriptExecutionReporter>;
    const terminalProvider = snapshotSkillScriptExecutorProvider({
      prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
        terminalReporter = reporter;
        return createPreparedExecution();
      },
    });
    const terminalHandle = terminalProvider.prepare({
      scriptPath: "/skills/report/scripts/run.ts",
    });
    terminalHandle.activate();
    terminalReporter.resolveResult(SCRIPT_RESULT);
    terminalReporter.rejectTerminal(new Error("terminal failure"));
    await terminalHandle.result;

    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(unhandled, []);
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("skill script reporter observes rejected Promise values in every settlement state", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent): void => {
    event.preventDefault();
    unhandled.push(event.reason);
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    let acceptedReporter!: Readonly<SkillScriptExecutionReporter>;
    const acceptedProvider = snapshotSkillScriptExecutorProvider({
      prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
        acceptedReporter = reporter;
        return createPreparedExecution();
      },
    });
    const acceptedHandle = acceptedProvider.prepare({
      scriptPath: "/skills/report/scripts/run.ts",
    });
    acceptedHandle.activate();
    acceptedReporter.resolveResult(
      Promise.reject(new Error("invalid accepted result")) as never,
    );
    acceptedReporter.resolveTerminal();
    await assertRejects(() => acceptedHandle.result, TypeError);
    await acceptedHandle.terminal;

    let earlyReporter!: Readonly<SkillScriptExecutionReporter>;
    const earlyProvider = snapshotSkillScriptExecutorProvider({
      prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
        earlyReporter = reporter;
        return createPreparedExecution();
      },
    });
    const earlyHandle = earlyProvider.prepare({
      scriptPath: "/skills/report/scripts/run.ts",
    });
    earlyReporter.resolveResult(
      Promise.reject(new Error("invalid preactivation result")) as never,
    );
    await assertRejects(() => earlyHandle.result, TypeError, "before activation");
    await assertRejects(() => earlyHandle.terminal, TypeError, "before activation");

    let lateReporter!: Readonly<SkillScriptExecutionReporter>;
    const lateProvider = snapshotSkillScriptExecutorProvider({
      prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
        lateReporter = reporter;
        return createPreparedExecution();
      },
    });
    const lateHandle = lateProvider.prepare({
      scriptPath: "/skills/report/scripts/run.ts",
    });
    lateHandle.activate();
    lateReporter.resolveResult(SCRIPT_RESULT);
    lateReporter.resolveTerminal();
    await lateHandle.result;
    await lateHandle.terminal;
    lateReporter.resolveResult(
      Promise.reject(new Error("invalid late result")) as never,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(unhandled, []);
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("skill script provider settles and cleans up synchronous control failures", async () => {
  const activationFailure = new Error("activation failed");
  const activationTerminationReasons: unknown[] = [];
  let activationReporter!: Readonly<SkillScriptExecutionReporter>;
  let cleanupDone = false;
  const activationProvider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      activationReporter = reporter;
      return createPreparedExecution(
        () => {
          throw activationFailure;
        },
        (reason) => {
          activationTerminationReasons.push(reason);
          setTimeout(() => {
            cleanupDone = true;
            activationReporter.resolveTerminal();
          }, 5);
        },
      );
    },
  });
  const activationHandle = activationProvider.prepare({
    scriptPath: "/skills/report/scripts/run.ts",
  });

  assertThrows(() => activationHandle.activate(), Error, "activation failed");
  await assertRejects(() => activationHandle.result, Error, "activation failed");
  let terminalSettled = false;
  activationHandle.terminal.then(
    () => terminalSettled = true,
    () => terminalSettled = true,
  );
  await Promise.resolve();
  assertEquals({ cleanupDone, terminalSettled }, { cleanupDone: false, terminalSettled: false });
  await activationHandle.terminal;
  assertEquals(cleanupDone, true);
  assertEquals(activationTerminationReasons, [activationFailure]);

  const terminationFailure = new Error("termination failed");
  const terminationProvider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return createPreparedExecution(
        () => undefined,
        () => {
          throw terminationFailure;
        },
      );
    },
  });
  const terminationHandle = terminationProvider.prepare({
    scriptPath: "/skills/report/scripts/run.ts",
  });
  terminationHandle.activate();

  assertThrows(() => terminationHandle.terminate(), Error, "termination failed");
  await assertRejects(() => terminationHandle.result, Error, "termination failed");
  await assertRejects(() => terminationHandle.terminal, Error, "termination failed");
});

Deno.test("skill script provider rejects terminal when termination throws after reporting success", async () => {
  const activationFailure = new Error("activation failed before cleanup");
  const cleanupFailure = new Error("cleanup threw after terminal report");
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution(
        () => {
          throw activationFailure;
        },
        () => {
          reporter.resolveTerminal();
          throw cleanupFailure;
        },
      );
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });

  assertThrows(
    () => handle.activate(),
    AggregateError,
    "activation and cleanup failed",
  );
  await assertRejects(() => handle.result, Error, "activation failed before cleanup");
  let terminalFailure: unknown;
  try {
    await handle.terminal;
  } catch (error) {
    terminalFailure = error;
  }
  assertEquals(terminalFailure instanceof AggregateError, true);
  assertEquals(
    terminalFailure instanceof AggregateError ? terminalFailure.errors : [],
    [activationFailure, cleanupFailure],
  );
});

Deno.test("skill script provider forwards reentrant termination at most once", async () => {
  const terminationFailure = new Error("reentrant termination failed");
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return createPreparedExecution(
        () => handle.terminate(),
        () => {
          terminationCalls += 1;
          throw terminationFailure;
        },
      );
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });

  assertThrows(() => handle.activate(), Error, "reentrant termination failed");
  await assertRejects(() => handle.result, Error, "reentrant termination failed");
  await assertRejects(() => handle.terminal, Error, "reentrant termination failed");
  assertEquals(terminationCalls, 1);
});

Deno.test("skill script provider aggregates double failures without live array iteration", async () => {
  const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  let iteratorHooks = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return createPreparedExecution(
        () => {
          Object.defineProperty(Array.prototype, Symbol.iterator, {
            configurable: true,
            value() {
              iteratorHooks += 1;
              throw new Error("mutated iterator ran");
            },
            writable: true,
          });
          throw new Error("activation failed");
        },
        () => {
          throw new Error("cleanup failed");
        },
      );
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });

  try {
    assertThrows(() => handle.activate(), AggregateError, "activation and cleanup failed");
  } finally {
    if (originalIterator) {
      Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
    }
  }

  await assertRejects(() => handle.result, Error, "activation failed");
  await assertRejects(() => handle.terminal, AggregateError, "activation and cleanup failed");
  assertEquals(iteratorHooks, 0);
});

Deno.test("skill script provider ignores inherited property-descriptor hooks", async () => {
  const originalGet = Object.getOwnPropertyDescriptor(Object.prototype, "get");
  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let descriptorHooks = 0;
  const installThrowingGetter = (key: "get" | "value"): void => {
    const descriptor = Object.create(null) as PropertyDescriptor;
    descriptor.configurable = true;
    descriptor.get = () => {
      descriptorHooks += 1;
      throw new Error(`inherited descriptor ${key} hook ran`);
    };
    Object.defineProperty(Object.prototype, key, descriptor);
  };
  const provider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return createPreparedExecution(
        () => {
          throw new Error("activation failed");
        },
        () => {
          throw new Error("cleanup failed");
        },
      );
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });

  try {
    installThrowingGetter("get");
    installThrowingGetter("value");
    assertThrows(() => handle.activate(), AggregateError, "activation and cleanup failed");
  } finally {
    Reflect.deleteProperty(Object.prototype, "get");
    Reflect.deleteProperty(Object.prototype, "value");
    if (originalGet) Object.defineProperty(Object.prototype, "get", originalGet);
    if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
  }

  await assertRejects(() => handle.result, Error, "activation failed");
  await assertRejects(() => handle.terminal, AggregateError, "activation and cleanup failed");
  assertEquals(descriptorHooks, 0);
});

Deno.test("skill script provider rejects hostile provider shapes without invoking hooks", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "prepare", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => createPreparedExecution();
    },
  });
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(accessor),
    TypeError,
    "function data property",
  );
  assertThrows(
    () =>
      snapshotSkillScriptExecutorProvider({
        prepare: () => createPreparedExecution(),
        fallback: () => createPreparedExecution(),
      }),
    TypeError,
    "contain only",
  );

  let trapCalls = 0;
  const proxy = new Proxy(
    { prepare: () => createPreparedExecution() },
    {
      ownKeys(target) {
        trapCalls += 1;
        return Reflect.ownKeys(target);
      },
    },
  );
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(proxy),
    TypeError,
    "must not be a proxy",
  );

  let applyCalls = 0;
  const proxiedPrepare = new Proxy(
    () => createPreparedExecution(),
    {
      apply(target, thisArg, argumentsList) {
        applyCalls += 1;
        return Reflect.apply(target, thisArg, argumentsList);
      },
    },
  );
  assertThrows(
    () => snapshotSkillScriptExecutorProvider({ prepare: proxiedPrepare }),
    TypeError,
    "non-proxy function",
  );
  assertEquals(getterCalls, 0);
  assertEquals(trapCalls, 0);
  assertEquals(applyCalls, 0);
});

Deno.test("skill script provider rejects hostile inputs without invoking hooks", () => {
  let prepareCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare() {
      prepareCalls += 1;
      return createPreparedExecution();
    },
  });
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "scriptPath", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "/secret.ts";
    },
  });
  assertThrows(
    () => provider.prepare(accessor as never),
    TypeError,
    "data property",
  );

  let trapCalls = 0;
  const proxy = new Proxy(
    { scriptPath: "/skills/report/scripts/run.ts" },
    {
      get(target, property, receiver) {
        trapCalls += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  assertThrows(
    () => provider.prepare(proxy),
    TypeError,
    "must not be a proxy",
  );

  const signalProxy = new Proxy(new AbortController().signal, {
    getPrototypeOf(target) {
      trapCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
  });
  assertThrows(
    () =>
      provider.prepare({
        scriptPath: "/skills/report/scripts/run.ts",
        abortSignal: signalProxy,
      }),
    TypeError,
    "AbortSignal",
  );
  assertEquals({ prepareCalls, getterCalls, trapCalls }, {
    prepareCalls: 0,
    getterCalls: 0,
    trapCalls: 0,
  });
});

Deno.test("skill script provider validates AbortSignal by captured native brand", async () => {
  const NativeAbortSignal = AbortSignal;
  const originalHasInstance = Object.getOwnPropertyDescriptor(
    NativeAbortSignal,
    Symbol.hasInstance,
  );
  let hasInstanceHooks = 0;
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution();
    },
  });

  try {
    Object.defineProperty(NativeAbortSignal, Symbol.hasInstance, {
      configurable: true,
      value() {
        hasInstanceHooks += 1;
        return false;
      },
      writable: true,
    });
    const handle = provider.prepare({
      scriptPath: "/skills/report/scripts/run.ts",
      abortSignal: new AbortController().signal,
    });
    handle.activate();
    reporter.resolveResult(SCRIPT_RESULT);
    reporter.resolveTerminal();
    await handle.result;
    await handle.terminal;
  } finally {
    if (originalHasInstance) {
      Object.defineProperty(NativeAbortSignal, Symbol.hasInstance, originalHasInstance);
    } else {
      Reflect.deleteProperty(NativeAbortSignal, Symbol.hasInstance);
    }
  }

  assertEquals(hasInstanceHooks, 0);
});

Deno.test("skill script provider rejects async prepare before it can create orphaned work", () => {
  let prepareCalls = 0;
  assertThrows(
    () =>
      snapshotSkillScriptExecutorProvider({
        async prepare() {
          prepareCalls += 1;
          throw new Error("must never become an unhandled rejection");
        },
      }),
    TypeError,
    "must be synchronous",
  );
  assertEquals(prepareCalls, 0);
});

Deno.test("skill script provider rejects cross-realm async prepare before invocation", () => {
  let prepareCalls = 0;
  const crossRealmPrepare = runInNewContext(
    "(async function () { mark(); return {}; }).bind(undefined)",
    { mark: () => prepareCalls++ },
  ) as (...args: unknown[]) => unknown;

  assertThrows(
    () => snapshotSkillScriptExecutorProvider({ prepare: crossRealmPrepare }),
    TypeError,
    "synchronous",
  );
  assertEquals(prepareCalls, 0);
});

Deno.test("skill script provider observes an ordinary rejected Promise contract violation", async () => {
  const provider = snapshotSkillScriptExecutorProvider({
    prepare: () => Promise.reject(new Error("invalid async prepare")),
  });
  assertThrows(
    () => provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" }),
    TypeError,
    "synchronously",
  );
  await Promise.resolve();
});

Deno.test("skill script reporter observes rejected Promise failure reasons", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution();
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  const resultReason = Promise.reject(new Error("result reason rejected"));
  const terminalReason = Promise.reject(new Error("terminal reason rejected"));

  reporter.rejectResult(resultReason);
  reporter.rejectTerminal(terminalReason);

  let observedResultReason: unknown;
  let observedTerminalReason: unknown;
  try {
    await handle.result;
  } catch (reason) {
    observedResultReason = reason;
  }
  try {
    await handle.terminal;
  } catch (reason) {
    observedTerminalReason = reason;
  }
  assertStrictEquals(observedResultReason, resultReason);
  assertStrictEquals(observedTerminalReason, terminalReason);
  await Promise.resolve();
});

Deno.test("skill script provider observes rejected Promises thrown by lifecycle controls", async () => {
  const prepareReason = Promise.reject(new Error("prepare reason rejected"));
  const prepareProvider = snapshotSkillScriptExecutorProvider({
    prepare() {
      throw prepareReason;
    },
  });
  let observedPrepareReason: unknown;
  try {
    prepareProvider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  } catch (reason) {
    observedPrepareReason = reason;
  }
  assertStrictEquals(observedPrepareReason, prepareReason);

  const activateReason = Promise.reject(new Error("activate reason rejected"));
  let activateReporter!: Readonly<SkillScriptExecutionReporter>;
  const activateProvider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      activateReporter = reporter;
      return createPreparedExecution(
        () => {
          throw activateReason;
        },
        () => activateReporter.resolveTerminal(),
      );
    },
  });
  const activateHandle = activateProvider.prepare({
    scriptPath: "/skills/report/scripts/run.ts",
  });
  let observedActivateReason: unknown;
  try {
    activateHandle.activate();
  } catch (reason) {
    observedActivateReason = reason;
  }
  assertStrictEquals(observedActivateReason, activateReason);
  let observedActivateResultReason: unknown;
  try {
    await activateHandle.result;
  } catch (reason) {
    observedActivateResultReason = reason;
  }
  assertStrictEquals(observedActivateResultReason, activateReason);
  await activateHandle.terminal;

  const terminateReason = Promise.reject(new Error("terminate reason rejected"));
  const terminateProvider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return createPreparedExecution(undefined, () => {
        throw terminateReason;
      });
    },
  });
  const terminateHandle = terminateProvider.prepare({
    scriptPath: "/skills/report/scripts/run.ts",
  });
  let observedTerminateReason: unknown;
  try {
    terminateHandle.terminate();
  } catch (reason) {
    observedTerminateReason = reason;
  }
  assertStrictEquals(observedTerminateReason, terminateReason);
  let observedTerminateResultReason: unknown;
  let observedTerminateTerminalReason: unknown;
  try {
    await terminateHandle.result;
  } catch (reason) {
    observedTerminateResultReason = reason;
  }
  try {
    await terminateHandle.terminal;
  } catch (reason) {
    observedTerminateTerminalReason = reason;
  }
  assertStrictEquals(observedTerminateResultReason, terminateReason);
  assertStrictEquals(observedTerminateTerminalReason, terminateReason);
  await Promise.resolve();
});

Deno.test("skill script provider validates inert controls before work can activate", async () => {
  let activationCount = 0;
  const failure = new Error("reported before malformed controls");
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, reporter: Readonly<SkillScriptExecutionReporter>) {
      reporter.rejectResult(failure);
      reporter.rejectTerminal(failure);
      return {
        ...createPreparedExecution(() => activationCount++),
        unexpected: true,
      };
    },
  });

  assertThrows(
    () => provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" }),
    TypeError,
    "contain only",
  );
  await Promise.resolve();
  assertEquals(activationCount, 0);
});

Deno.test("skill script provider rejects asynchronous controls before invocation", () => {
  let activationCalls = 0;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare() {
      return {
        async activate() {
          activationCalls += 1;
          throw new Error("async activation");
        },
        async terminate() {
          terminationCalls += 1;
          throw new Error("async termination");
        },
      };
    },
  });

  assertThrows(
    () => provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" }),
    TypeError,
    "synchronous",
  );
  assertEquals({ activationCalls, terminationCalls }, { activationCalls: 0, terminationCalls: 0 });
});

Deno.test("skill script provider observes Promise-returning control violations", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution(
        () => Promise.reject(new Error("hidden activation failure")) as never,
        () => reporter.resolveTerminal(),
      );
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });

  assertThrows(() => handle.activate(), TypeError, "synchronously");
  await assertRejects(() => handle.result, TypeError, "synchronously");
  await handle.terminal;
  await Promise.resolve();
});

Deno.test("prepared skill script controls reject hostile shapes without invoking hooks", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    activate: {
      enumerable: true,
      get() {
        getterCalls += 1;
        return () => undefined;
      },
    },
    terminate: { enumerable: true, value: () => undefined },
  });
  assertThrows(
    () => snapshotSkillScriptPreparedExecution(accessor),
    TypeError,
    "function data property",
  );
  assertThrows(
    () =>
      snapshotSkillScriptPreparedExecution({
        ...createPreparedExecution(),
        processId: 42,
      }),
    TypeError,
    "contain only",
  );
  assertThrows(
    () =>
      snapshotSkillScriptPreparedExecution(
        Object.assign(Object.create({ inherited: true }), createPreparedExecution()),
      ),
    TypeError,
    "plain object",
  );

  let trapCalls = 0;
  const proxy = new Proxy(createPreparedExecution(), {
    ownKeys(target) {
      trapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  assertThrows(
    () => snapshotSkillScriptPreparedExecution(proxy),
    TypeError,
    "must not be a proxy",
  );
  assertEquals(getterCalls, 0);
  assertEquals(trapCalls, 0);
});

Deno.test("prepared controls use one lifecycle state machine", () => {
  let activations = 0;
  let terminations = 0;
  const active = snapshotSkillScriptPreparedExecution(
    createPreparedExecution(
      () => activations++,
      () => terminations++,
    ),
  );
  active.activate();
  active.activate();
  active.terminate();
  active.terminate();
  assertEquals({ activations, terminations }, { activations: 1, terminations: 1 });

  activations = 0;
  terminations = 0;
  const cancelled = snapshotSkillScriptPreparedExecution(
    createPreparedExecution(
      () => activations++,
      () => terminations++,
    ),
  );
  cancelled.terminate();
  cancelled.activate();
  assertEquals({ activations, terminations }, { activations: 0, terminations: 1 });
});

Deno.test("standalone prepared controls observe Promise-returning violations", async () => {
  const activation = snapshotSkillScriptPreparedExecution(
    createPreparedExecution(
      () => Promise.reject(new Error("hidden activation")) as never,
      () => undefined,
    ),
  );
  assertThrows(() => activation.activate(), TypeError, "synchronously");

  const termination = snapshotSkillScriptPreparedExecution(
    createPreparedExecution(
      () => undefined,
      () => Promise.reject(new Error("hidden termination")) as never,
    ),
  );
  assertThrows(() => termination.terminate(), TypeError, "synchronously");
  await Promise.resolve();
});

Deno.test("skill script terminal waits for the first reported result", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution();
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  let terminalSettled = false;
  handle.terminal.then(
    () => terminalSettled = true,
    () => terminalSettled = true,
  );

  reporter.resolveTerminal();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(terminalSettled, false);

  reporter.resolveResult(SCRIPT_RESULT);
  assertEquals(await handle.result, SCRIPT_RESULT);
  await handle.terminal;
  assertEquals(terminalSettled, true);
});

Deno.test("termination releases a terminal report that is waiting for a result", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution(
        undefined,
        () => terminationCalls += 1,
      );
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  reporter.resolveTerminal();

  const timeout = new Error("execution timed out");
  handle.terminate(timeout);

  await assertRejects(() => handle.result, Error, "execution timed out");
  await handle.terminal;
  assertEquals(terminationCalls, 0);
});

Deno.test("termination releases a terminal report made inside the terminate control", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  let terminationCalls = 0;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution(undefined, () => {
        terminationCalls += 1;
        reporter.resolveTerminal();
      });
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  const cancellation = new Error("cancel missing result");

  handle.terminate(cancellation);

  await assertRejects(() => handle.result, Error, "cancel missing result");
  await handle.terminal;
  assertEquals(terminationCalls, 1);
});

Deno.test("skill script reporter validates, bounds, detaches, and freezes results", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution();
    },
  });

  const detachedHandle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  detachedHandle.activate();
  const source = { stdout: "ok", stderr: "", exitCode: 0, durationMs: 8 };
  reporter.resolveResult(source);
  reporter.resolveTerminal();
  source.stdout = "mutated";
  source.exitCode = 99;
  const detached = await detachedHandle.result;
  assertEquals(detached, { stdout: "ok", stderr: "", exitCode: 0 });
  assertEquals(Object.isFrozen(detached), true);

  let oversizedReporter!: Readonly<SkillScriptExecutionReporter>;
  const oversizedProvider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      oversizedReporter = candidate;
      return createPreparedExecution();
    },
  });
  const oversizedHandle = oversizedProvider.prepare({
    scriptPath: "/skills/report/scripts/run.ts",
  });
  oversizedHandle.activate();
  oversizedReporter.resolveResult({
    stdout: "x".repeat(SKILL_SCRIPT_MAX_OUTPUT_BYTES),
    stderr: "y",
    exitCode: 0,
  });
  oversizedReporter.resolveTerminal();
  await assertRejects(() => oversizedHandle.result, RangeError, "output");
  await oversizedHandle.terminal;
});

Deno.test("skill script reporter uses the first result and terminal settlements", async () => {
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  const provider = snapshotSkillScriptExecutorProvider({
    prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
      reporter = candidate;
      return createPreparedExecution();
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  reporter.resolveResult(SCRIPT_RESULT);
  reporter.rejectResult(new Error("late result"));
  reporter.resolveTerminal();
  reporter.rejectTerminal(new Error("late terminal"));

  assertEquals(await handle.result, SCRIPT_RESULT);
  await handle.terminal;
});

Deno.test("skill provider function properties never receive extension objects as receivers", () => {
  let prepareReceiver: unknown = "unset";
  let activateReceiver: unknown = "unset";
  let terminateReceiver: unknown = "unset";
  const provider = snapshotSkillScriptExecutorProvider({
    prepare: function (
      this: unknown,
      _input: unknown,
      _reporter: Readonly<SkillScriptExecutionReporter>,
    ) {
      prepareReceiver = this;
      return {
        activate: function (this: unknown) {
          activateReceiver = this;
        },
        terminate: function (this: unknown) {
          terminateReceiver = this;
        },
      };
    },
  });
  const handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
  handle.activate();
  handle.terminate();
  assertStrictEquals(prepareReceiver, undefined);
  assertStrictEquals(activateReceiver, undefined);
  assertStrictEquals(terminateReceiver, undefined);
});

Deno.test("unexpected Promise constructor hooks are never assimilated", () => {
  let constructorGetterCalls = 0;
  const unexpected = Promise.resolve(createPreparedExecution());
  Object.defineProperty(unexpected, "constructor", {
    configurable: true,
    get() {
      constructorGetterCalls += 1;
      throw new Error("must not run");
    },
  });
  const provider = snapshotSkillScriptExecutorProvider({
    prepare: () => unexpected,
  });

  assertThrows(
    () => provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" }),
    TypeError,
    "synchronously",
  );
  assertEquals(constructorGetterCalls, 0);
});

Deno.test("frozen rejected Promise contract violations are internally observed", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent): void => {
    event.preventDefault();
    unhandled.push(event.reason);
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let descriptorHooks = 0;

  try {
    const unexpected = Object.freeze(Promise.reject(new Error("frozen invalid prepare")));
    const provider = snapshotSkillScriptExecutorProvider({ prepare: () => unexpected });
    const descriptor = Object.create(null) as PropertyDescriptor;
    descriptor.configurable = true;
    descriptor.get = () => {
      descriptorHooks += 1;
      throw new Error("inherited descriptor value hook ran");
    };
    Object.defineProperty(Object.prototype, "value", descriptor);
    try {
      assertThrows(
        () => provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" }),
        TypeError,
        "synchronously",
      );
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
      if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(unhandled, []);
    assertEquals(descriptorHooks, 0);
  } finally {
    Reflect.deleteProperty(Object.prototype, "value");
    if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("frozen rejected Promise observation ignores mutable Promise species", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent): void => {
    event.preventDefault();
    unhandled.push(event.reason);
  };
  const originalSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
  let speciesHooks = 0;
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    const unexpected = Object.freeze(Promise.reject(new Error("frozen species prepare")));
    Object.defineProperty(Promise, Symbol.species, {
      configurable: true,
      get() {
        speciesHooks += 1;
        throw new Error("mutated Promise species must not run");
      },
    });
    const provider = snapshotSkillScriptExecutorProvider({ prepare: () => unexpected });
    assertThrows(
      () => provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" }),
      TypeError,
      "synchronously",
    );
  } finally {
    Reflect.deleteProperty(Promise, Symbol.species);
    if (originalSpecies) Object.defineProperty(Promise, Symbol.species, originalSpecies);
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(unhandled, []);
  assertEquals(speciesHooks, 0);
  globalThis.removeEventListener("unhandledrejection", onUnhandled);
});

Deno.test("skill provider capture is independent of later built-in mutation", async () => {
  const targets = [
    [Array, "isArray"],
    [Object, "freeze"],
    [Object, "getOwnPropertyDescriptor"],
    [Object, "getOwnPropertyDescriptors"],
    [Object, "getPrototypeOf"],
    [Object.prototype, "hasOwnProperty"],
    [Reflect, "ownKeys"],
  ] as const;
  const originals = targets.map(([target, property]) =>
    Object.getOwnPropertyDescriptor(target, property)
  );
  let hookCalls = 0;
  let reporter!: Readonly<SkillScriptExecutionReporter>;
  let handle: ReturnType<ReturnType<typeof snapshotSkillScriptExecutorProvider>["prepare"]>;

  try {
    for (const [target, property] of targets) {
      Object.defineProperty(target, property, {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("mutated built-in must not run");
        },
        writable: true,
      });
    }
    const provider = snapshotSkillScriptExecutorProvider({
      prepare(_input: unknown, candidate: Readonly<SkillScriptExecutionReporter>) {
        reporter = candidate;
        return createPreparedExecution();
      },
    });
    handle = provider.prepare({ scriptPath: "/skills/report/scripts/run.ts" });
    handle.activate();
    reporter.resolveResult(SCRIPT_RESULT);
    reporter.resolveTerminal();
  } finally {
    targets.forEach(([target, property], index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(target, property, descriptor);
    });
  }

  assertEquals(hookCalls, 0);
  assertEquals(await handle!.result, SCRIPT_RESULT);
  await handle!.terminal;
});
