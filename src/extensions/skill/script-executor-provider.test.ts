import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { SKILL_SCRIPT_MAX_OUTPUT_BYTES } from "#veryfront/skill/limits.ts";
import type { SkillScriptResult } from "#veryfront/skill/types.ts";
import {
  SkillScriptExecutorProviderName,
  snapshotSkillScriptExecutionHandle,
  snapshotSkillScriptExecutorProvider,
} from "./script-executor-provider.ts";

const SCRIPT_RESULT: SkillScriptResult = Object.freeze({
  stdout: "ok\n",
  stderr: "",
  exitCode: 0,
});

function createHandle(terminate: (reason?: unknown) => void = () => undefined) {
  return {
    result: Promise.resolve(SCRIPT_RESULT),
    terminate,
    terminal: Promise.resolve(),
  };
}

Deno.test("skill script provider snapshots immutable lifecycle methods and promises", async () => {
  const reasons: unknown[] = [];
  const originalTerminate = (reason?: unknown) => reasons.push(reason);
  const rawHandle = createHandle(originalTerminate);
  const input = { scriptPath: "/skills/report/scripts/run.ts" };
  let receivedInput: unknown;
  const source = {
    start(candidate: unknown) {
      receivedInput = candidate;
      return rawHandle;
    },
  };

  const provider = snapshotSkillScriptExecutorProvider(source);
  source.start = () => {
    throw new Error("mutated provider method must not run");
  };
  const handle = provider.start(input);
  rawHandle.terminate = () => {
    throw new Error("mutated handle method must not run");
  };

  const reason = new Error("stop");
  handle.terminate(reason);

  assertEquals(SkillScriptExecutorProviderName, "SkillScriptExecutorProvider");
  assertStrictEquals(receivedInput, input);
  assertEquals(await handle.result, SCRIPT_RESULT);
  await handle.terminal;
  assertEquals(reasons, [reason]);
  assertEquals(Object.isFrozen(provider), true);
  assertEquals(Object.isFrozen(provider.start), true);
  assertEquals(Object.isFrozen(handle), true);
  assertEquals(Object.isFrozen(handle.terminate), true);
  assertEquals(handle.result === rawHandle.result, false);
  assertEquals(handle.terminal === rawHandle.terminal, false);
});

Deno.test("skill script provider rejects accessors and inherited or extraneous shapes without invoking getters", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "start", {
    enumerable: true,
    get() {
      getterCalls++;
      return () => createHandle();
    },
  });
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(accessor),
    TypeError,
    "function data property",
  );

  const inheritedPrototype = Object.defineProperty({}, "start", {
    get() {
      getterCalls++;
      return () => createHandle();
    },
  });
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(Object.create(inheritedPrototype)),
    TypeError,
    "plain object",
  );

  assertThrows(
    () =>
      snapshotSkillScriptExecutorProvider({
        start: () => createHandle(),
        fallback: () => createHandle(),
      }),
    TypeError,
    "contain only",
  );
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(null),
    TypeError,
    "must be an object",
  );
  assertThrows(
    () => snapshotSkillScriptExecutorProvider([() => createHandle()]),
    TypeError,
    "must be an object",
  );
  assertEquals(getterCalls, 0);
});

Deno.test("skill script provider rejects proxies before invoking traps or proxied methods", () => {
  let trapCalls = 0;
  const proxiedProvider = new Proxy(
    { start: () => createHandle() },
    {
      ownKeys(target) {
        trapCalls++;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(proxiedProvider),
    TypeError,
    "must not be a proxy",
  );

  let applyCalls = 0;
  const proxiedStart = new Proxy(
    () => createHandle(),
    {
      apply(target, thisArg, argumentsList) {
        applyCalls++;
        return Reflect.apply(target, thisArg, argumentsList);
      },
    },
  );
  assertThrows(
    () => snapshotSkillScriptExecutorProvider({ start: proxiedStart }),
    TypeError,
    "non-proxy function",
  );

  const revocable = Proxy.revocable({ start: () => createHandle() }, {});
  revocable.revoke();
  assertThrows(
    () => snapshotSkillScriptExecutorProvider(revocable.proxy),
    TypeError,
    "must not be a proxy",
  );
  assertEquals(trapCalls, 0);
  assertEquals(applyCalls, 0);
});

Deno.test("skill script provider rejects asynchronous start ownership", () => {
  const provider = snapshotSkillScriptExecutorProvider({
    async start() {
      return createHandle();
    },
  });

  assertThrows(
    () => provider.start({ scriptPath: "/skills/report/scripts/run.ts" }),
    TypeError,
    "must return an execution handle synchronously",
  );
  assertThrows(
    () => snapshotSkillScriptExecutionHandle(Promise.resolve(createHandle())),
    TypeError,
    "must return an execution handle synchronously",
  );
});

Deno.test("skill script provider capture is independent of later built-in mutation", async () => {
  const targets = [
    [Array, "isArray"],
    [Object, "getOwnPropertyDescriptors"],
    [Object, "getPrototypeOf"],
    [Object.prototype, "hasOwnProperty"],
    [Reflect, "ownKeys"],
    [Array.prototype, "map"],
    [Array.prototype, "some"],
    [Array.prototype, "join"],
    [Set.prototype, "has"],
  ] as const;
  const originals = targets.map(([target, property]) =>
    Object.getOwnPropertyDescriptor(target, property)
  );
  let hookCalls = 0;
  let handle: ReturnType<ReturnType<typeof snapshotSkillScriptExecutorProvider>["start"]>;

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
      start: () => createHandle(),
    });
    handle = provider.start({ scriptPath: "/skills/report/scripts/run.ts" });
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

Deno.test("skill script handle terminal cannot settle before its validated result", async () => {
  let resolveResult!: (value: SkillScriptResult) => void;
  let resolveTerminal!: () => void;
  const result = new Promise<SkillScriptResult>((resolve) => {
    resolveResult = resolve;
  });
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  const handle = snapshotSkillScriptExecutionHandle({
    result,
    terminate: () => undefined,
    terminal,
  });
  let terminalSettled = false;
  const observedTerminal = handle.terminal.then(
    () => {
      terminalSettled = true;
    },
    () => {
      terminalSettled = true;
    },
  );

  resolveTerminal();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(terminalSettled, false);

  resolveResult(SCRIPT_RESULT);
  assertEquals(await handle.result, SCRIPT_RESULT);
  await observedTerminal;
  assertEquals(terminalSettled, true);
});

Deno.test("skill script handle forwards termination at most once", () => {
  const reasons: unknown[] = [];
  const handle = snapshotSkillScriptExecutionHandle(
    createHandle((reason) => reasons.push(reason)),
  );
  const first = new Error("first");
  handle.terminate(first);
  handle.terminate(new Error("second"));

  assertEquals(reasons, [first]);
});

Deno.test("skill script handle rejects accessors without invoking them", () => {
  let resultGetterCalls = 0;
  const resultAccessor = Object.defineProperties({}, {
    result: {
      enumerable: true,
      get() {
        resultGetterCalls++;
        return Promise.resolve(SCRIPT_RESULT);
      },
    },
    terminate: { enumerable: true, value: () => undefined },
    terminal: { enumerable: true, value: Promise.resolve() },
  });
  assertThrows(
    () => snapshotSkillScriptExecutionHandle(resultAccessor),
    TypeError,
    "genuine Promise data property",
  );

  let terminateGetterCalls = 0;
  const terminateAccessor = Object.defineProperties({}, {
    result: { enumerable: true, value: Promise.resolve(SCRIPT_RESULT) },
    terminate: {
      enumerable: true,
      get() {
        terminateGetterCalls++;
        return () => undefined;
      },
    },
    terminal: { enumerable: true, value: Promise.resolve() },
  });
  assertThrows(
    () => snapshotSkillScriptExecutionHandle(terminateAccessor),
    TypeError,
    "function data property",
  );

  assertEquals(resultGetterCalls, 0);
  assertEquals(terminateGetterCalls, 0);
});

Deno.test("skill script handle requires genuine Promise data properties", () => {
  assertThrows(
    () =>
      snapshotSkillScriptExecutionHandle({
        result: { then: () => undefined },
        terminate: () => undefined,
        terminal: Promise.resolve(),
      }),
    TypeError,
    "genuine Promise data property",
  );
  assertThrows(
    () =>
      snapshotSkillScriptExecutionHandle({
        result: Promise.resolve(SCRIPT_RESULT),
        terminate: () => undefined,
        terminal: { then: () => undefined },
      }),
    TypeError,
    "genuine Promise data property",
  );
  assertThrows(
    () =>
      snapshotSkillScriptExecutionHandle({
        result: new Proxy(Promise.resolve(SCRIPT_RESULT), {}),
        terminate: () => undefined,
        terminal: Promise.resolve(),
      }),
    TypeError,
    "genuine Promise data property",
  );
});

Deno.test("skill script handle validates, bounds, and detaches provider results", async () => {
  let getterCalls = 0;
  const accessorResult = Object.defineProperties({}, {
    stdout: {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "leak";
      },
    },
    stderr: { enumerable: true, value: "" },
    exitCode: { enumerable: true, value: 0 },
  });
  const accessorHandle = snapshotSkillScriptExecutionHandle({
    result: Promise.resolve(accessorResult as never),
    terminate: () => undefined,
    terminal: Promise.resolve(),
  });

  await assertRejects(
    () => accessorHandle.result,
    TypeError,
    "data properties",
  );
  assertEquals(getterCalls, 0);

  const oversizedHandle = snapshotSkillScriptExecutionHandle({
    result: Promise.resolve({
      stdout: "x".repeat(SKILL_SCRIPT_MAX_OUTPUT_BYTES),
      stderr: "y",
      exitCode: 0,
    }),
    terminate: () => undefined,
    terminal: Promise.resolve(),
  });
  await assertRejects(
    () => oversizedHandle.result,
    RangeError,
    "output",
  );

  const sourceResult = { stdout: "ok", stderr: "", exitCode: 0 };
  const detachedHandle = snapshotSkillScriptExecutionHandle({
    result: Promise.resolve(sourceResult),
    terminate: () => undefined,
    terminal: Promise.resolve(),
  });
  const result = await detachedHandle.result;
  sourceResult.stdout = "mutated";
  sourceResult.exitCode = 99;

  assertEquals(result, { stdout: "ok", stderr: "", exitCode: 0 });
  assertEquals(Object.isFrozen(result), true);
});

Deno.test("skill script handle rejects inherited, extraneous, proxy, and proxied-terminate shapes", () => {
  const inherited = Object.assign(Object.create({ inherited: true }), createHandle());
  assertThrows(
    () => snapshotSkillScriptExecutionHandle(inherited),
    TypeError,
    "plain object",
  );
  assertThrows(
    () => snapshotSkillScriptExecutionHandle({ ...createHandle(), processId: 42 }),
    TypeError,
    "contain only",
  );

  let trapCalls = 0;
  const proxiedHandle = new Proxy(createHandle(), {
    ownKeys(target) {
      trapCalls++;
      return Reflect.ownKeys(target);
    },
  });
  assertThrows(
    () => snapshotSkillScriptExecutionHandle(proxiedHandle),
    TypeError,
    "must not be a proxy",
  );

  let terminateCalls = 0;
  const proxiedTerminate = new Proxy(
    () => undefined,
    {
      apply(target, thisArg, argumentsList) {
        terminateCalls++;
        return Reflect.apply(target, thisArg, argumentsList);
      },
    },
  );
  assertThrows(
    () => snapshotSkillScriptExecutionHandle(createHandle(proxiedTerminate)),
    TypeError,
    "non-proxy function",
  );
  assertEquals(trapCalls, 0);
  assertEquals(terminateCalls, 0);
});
