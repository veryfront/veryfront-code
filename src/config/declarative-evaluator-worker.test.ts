import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  DeclarativeConfigEvaluationError,
  type DeclarativeConfigFileName,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import {
  createDeclarativeConfigWorkerErrorResponse,
  createDeclarativeConfigWorkerSuccessResponse,
  DECLARATIVE_CONFIG_WORKER_PROTOCOL_VERSION,
  decodeDeclarativeConfigWorkerRequest,
  decodeDeclarativeConfigWorkerResponse,
} from "./declarative-evaluator-worker-protocol.ts";
import {
  declarativeConfigWorkerRunnerInternals,
  evaluatePreparedDeclarativeConfigInWorker,
} from "./declarative-evaluator-worker-runner.ts";
import { MAX_HOSTED_RENDER_CACHE_ENTRIES } from "./defaults.ts";

const TestObjectCreate = Object.create;
const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const TestReflectApply = Reflect.apply;
const TestReflectDeleteProperty = Reflect.deleteProperty;
const TestPromise = Promise;
const TestSetTimeout = globalThis.setTimeout.bind(globalThis);
const TestClearTimeout = globalThis.clearTimeout.bind(globalThis);
const TEST_STATE_WAIT_TIMEOUT_MS = 1_000;

function testHasOwn(value: object, key: PropertyKey): boolean {
  return TestReflectApply(TestObjectPrototypeHasOwnProperty, value, [
    key,
  ]) as boolean;
}

function copyPropertyDescriptorForTest(
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  const copied = TestObjectCreate(null) as PropertyDescriptor;
  if (testHasOwn(descriptor, "configurable")) {
    copied.configurable = descriptor.configurable;
  }
  if (testHasOwn(descriptor, "enumerable")) {
    copied.enumerable = descriptor.enumerable;
  }
  if (testHasOwn(descriptor, "value")) copied.value = descriptor.value;
  if (testHasOwn(descriptor, "writable")) {
    copied.writable = descriptor.writable;
  }
  if (testHasOwn(descriptor, "get")) copied.get = descriptor.get;
  if (testHasOwn(descriptor, "set")) copied.set = descriptor.set;
  return copied;
}

function replacePropertyForTest(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): () => void {
  const previous = TestObjectGetOwnPropertyDescriptor(target, key);
  const replacement = copyPropertyDescriptorForTest(descriptor);
  replacement.configurable = true;
  TestObjectDefineProperty(target, key, replacement);
  return () => {
    if (previous) {
      TestObjectDefineProperty(
        target,
        key,
        copyPropertyDescriptorForTest(previous),
      );
    } else {
      TestReflectDeleteProperty(target, key);
    }
  };
}

async function createPayload(
  source: string,
  fileName: DeclarativeConfigFileName = "veryfront.config.ts",
) {
  const context = await prepareDeclarativeConfigContext({
    environmentName: "production",
    environment: { TENANT: "isolated" },
  });
  return createPreparedDeclarativeConfigWorkerPayload(source, context, fileName);
}

function waitForCondition<T>(
  description: string,
  snapshot: () => T,
  matches: (current: T) => boolean,
  timeoutMs = TEST_STATE_WAIT_TIMEOUT_MS,
): Promise<T> {
  return new TestPromise<T>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let lastObserved: T | undefined;

    const cleanup = (): void => {
      if (pollTimer !== undefined) {
        TestClearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (deadlineTimer !== undefined) {
        TestClearTimeout(deadlineTimer);
        deadlineTimer = undefined;
      }
    };
    const resolveOnce = (current: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(current);
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const poll = (): void => {
      try {
        const current = snapshot();
        lastObserved = current;
        if (matches(current)) {
          resolveOnce(current);
          return;
        }
        pollTimer = TestSetTimeout(poll, 0);
      } catch (error) {
        rejectOnce(error);
      }
    };

    deadlineTimer = TestSetTimeout(() => {
      let observed = lastObserved;
      try {
        observed = snapshot();
      } catch {
        // Preserve the last successful sample in the timeout diagnostic.
      }
      rejectOnce(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for ${description}; observed ${
            JSON.stringify(observed)
          }`,
        ),
      );
    }, timeoutMs);
    poll();
  });
}

async function waitForAdmissionState(
  admission: {
    snapshot(): Readonly<{ active: number; queued: number }>;
  },
  expected: Readonly<{ active: number; queued: number }>,
): Promise<void> {
  await waitForCondition(
    `admission state ${JSON.stringify(expected)}`,
    () => admission.snapshot(),
    (current) =>
      current.active === expected.active &&
      current.queued === expected.queued,
  );
}

async function waitForStartupState(
  startup: {
    snapshot(): Readonly<{ pending: number; maxPending: number }>;
  },
  expected: Readonly<{ pending: number; maxPending: number }>,
): Promise<void> {
  await waitForCondition(
    `startup state ${JSON.stringify(expected)}`,
    () => startup.snapshot(),
    (current) =>
      current.pending === expected.pending &&
      current.maxPending === expected.maxPending,
  );
}

Deno.test("declarative config worker returns a recanonicalized frozen snapshot", async () => {
  const payload = await createPayload(`
    import { getEnv } from "veryfront";
    export default {
      title: getEnv("TENANT"),
      nested: { enabled: true },
      list: ["a", "b"],
    };
  `);

  const snapshot = await evaluatePreparedDeclarativeConfigInWorker(payload);

  assertEquals(snapshot, {
    list: ["a", "b"],
    nested: { enabled: true },
    title: "isolated",
  });
  assertEquals(Object.getPrototypeOf(snapshot), null);
  assertEquals(Object.getPrototypeOf(snapshot.nested), null);
  assertEquals(Object.isFrozen(snapshot), true);
  assertEquals(Object.isFrozen(snapshot.nested), true);
  assertEquals(Object.isFrozen(snapshot.list), true);
  assertThrows(
    () => Object.defineProperty(snapshot, "title", { value: "mutated" }),
    TypeError,
  );
});

Deno.test("declarative config worker rehydrates typed evaluation failures", async () => {
  const payload = await createPayload(
    "export default { secret: process.env.SECRET };",
  );

  const error = await assertRejects(
    () => evaluatePreparedDeclarativeConfigInWorker(payload),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;

  assertEquals(error.name, "DeclarativeConfigEvaluationError");
  assertEquals(error.code, "forbidden-capability");
  assertEquals(error.phase, "validate");
  assertEquals(error.reason, "unsupported-call");
  assertEquals(error.retryable, false);
  assertEquals(error.location?.fileName, "veryfront.config.ts");
});

Deno.test("declarative config worker preserves hosted cache policy failures", async () => {
  for (
    const [source, reason] of [
      [
        `export default { cache: { dir: ".tenant-cache" } };`,
        "hosted-cache-directory",
      ],
      [
        `export default {
          cache: {
            render: {
              type: "distributed",
            },
          },
        };`,
        "hosted-render-cache-backend",
      ],
      [
        `export default {
          cache: {
            render: { maxEntries: ${MAX_HOSTED_RENDER_CACHE_ENTRIES + 1} },
          },
        };`,
        "hosted-render-cache-capacity",
      ],
      [
        `export default {
          cache: { bundleManifest: { type: "distributed" } },
        };`,
        "hosted-bundle-manifest-backend",
      ],
      [
        `export default {
          cache: { futurePersistentCache: { path: ".tenant-cache" } },
        };`,
        "hosted-cache-option",
      ],
    ] as const
  ) {
    const payload = await createPayload(source);
    const error = await assertRejects(
      () => evaluatePreparedDeclarativeConfigInWorker(payload),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;

    assertEquals(error.name, "DeclarativeConfigEvaluationError");
    assertEquals(error.code, "unsupported-hosted-feature");
    assertEquals(error.phase, "result");
    assertEquals(error.reason, reason);
    assertEquals(error.retryable, false);
    assertEquals(error.location?.fileName, "veryfront.config.ts");
  }
});

Deno.test("declarative config worker preserves validated JS and MJS diagnostic names", async () => {
  for (
    const fileName of [
      "veryfront.config.js",
      "veryfront.config.mjs",
    ] as const
  ) {
    const payload = await createPayload(
      "export default { secret: process.env.SECRET };",
      fileName,
    );
    const error = await assertRejects(
      () => evaluatePreparedDeclarativeConfigInWorker(payload),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(error.location?.fileName, fileName);
  }
});

Deno.test("declarative config worker rejects a pre-aborted request without starting", async () => {
  const payload = await createPayload("export default { ready: true };");
  const controller = new AbortController();
  controller.abort();
  let factoryCalls = 0;

  const error = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
        payload,
        { signal: controller.signal },
        async () => {
          factoryCalls += 1;
          throw new Error("endpoint must not start");
        },
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;

  assertEquals(factoryCalls, 0);
  assertEquals(error.code, "evaluator-unavailable");
  assertEquals(error.phase, "worker");
  assertEquals(error.reason, "worker-aborted");
  assertEquals(error.retryable, false);
});

Deno.test("declarative config worker terminates a stalled endpoint at its deadline", async () => {
  const payload = await createPayload("export default { ready: true };");
  let terminationCount = 0;

  const error = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
        payload,
        { timeoutMs: 1 },
        async () => ({
          postMessage() {},
          subscribe() {
            return () => {};
          },
          terminate() {
            terminationCount += 1;
          },
        }),
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;

  assertEquals(error.code, "evaluator-unavailable");
  assertEquals(error.phase, "worker");
  assertEquals(error.reason, "worker-timeout");
  assertEquals(error.retryable, true);
  assertEquals(terminationCount, 1);
});

Deno.test("declarative config worker caller deadline does not await a stuck termination", async () => {
  const payload = await createPayload("export default { ready: true };");
  let terminationCount = 0;
  const result = declarativeConfigWorkerRunnerInternals
    .evaluateWithEndpointFactory(
      payload,
      { timeoutMs: 1 },
      async () => ({
        postMessage() {},
        subscribe() {
          return () => {};
        },
        terminate() {
          terminationCount += 1;
          return new Promise<never>(() => {});
        },
      }),
      5,
    );

  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const callerStalled = new Promise<{ kind: "caller-stalled" }>((resolve) => {
    watchdog = setTimeout(() => resolve({ kind: "caller-stalled" }), 50);
  });
  const outcome = await Promise.race([
    result.then(
      (value) => ({ kind: "resolved" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    ),
    callerStalled,
  ]);
  if (watchdog !== undefined) clearTimeout(watchdog);

  assert(outcome.kind === "rejected", "caller result must reject independently");
  assert(outcome.error instanceof DeclarativeConfigEvaluationError);
  assertEquals(outcome.error.reason, "worker-timeout");
  assertEquals(terminationCount, 1);
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
});

Deno.test("declarative config worker contains a termination rejection after its drain bound", async () => {
  const payload = await createPayload("export default { ready: true };");
  let onMessage: ((value: unknown) => void) | undefined;

  const snapshot = await declarativeConfigWorkerRunnerInternals
    .evaluateWithEndpointFactory(
      payload,
      { timeoutMs: 100 },
      async () => ({
        postMessage() {
          onMessage?.({ ok: true, snapshot: { ready: true } });
        },
        subscribe(listeners) {
          onMessage = listeners.onMessage;
          return () => {};
        },
        terminate() {
          return new Promise<void>((_resolve, reject) => {
            setTimeout(() => reject(new Error("late termination failure")), 20);
          });
        },
      }),
      5,
    );

  assertEquals(snapshot, { ready: true });
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
});

Deno.test("declarative config worker aborts in flight and removes endpoint listeners", async () => {
  const payload = await createPayload("export default { ready: true };");
  const controller = new AbortController();
  let terminationCount = 0;
  let unsubscribeCount = 0;

  const pending = declarativeConfigWorkerRunnerInternals
    .evaluateWithEndpointFactory(
      payload,
      { signal: controller.signal },
      async () => ({
        postMessage() {
          controller.abort();
        },
        subscribe() {
          return () => {
            unsubscribeCount += 1;
          };
        },
        terminate() {
          terminationCount += 1;
        },
      }),
    );

  const error = await assertRejects(
    () => pending,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;

  assertEquals(error.reason, "worker-aborted");
  assertEquals(terminationCount, 1);
  assertEquals(unsubscribeCount, 1);
});

Deno.test("declarative config worker deadline includes asynchronous startup", async () => {
  const payload = await createPayload("export default { ready: true };");
  let resolveFactory:
    | ((endpoint: {
      postMessage(): void;
      subscribe(): () => void;
      terminate(): void;
    }) => void)
    | undefined;
  let terminationCount = 0;
  const factoryPromise = new Promise<{
    postMessage(): void;
    subscribe(): () => void;
    terminate(): void;
  }>((resolve) => {
    resolveFactory = resolve;
  });

  const error = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
        payload,
        { timeoutMs: 1 },
        () => factoryPromise,
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;

  assertEquals(error.reason, "worker-timeout");
  resolveFactory?.({
    postMessage() {},
    subscribe() {
      return () => {};
    },
    terminate() {
      terminationCount += 1;
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(terminationCount, 1);
});

Deno.test("declarative config worker settles once when a response wins the deadline", async () => {
  const payload = await createPayload("export default { ready: true };");
  let terminationCount = 0;
  let onMessage: ((value: unknown) => void) | undefined;

  const snapshot = await declarativeConfigWorkerRunnerInternals
    .evaluateWithEndpointFactory(
      payload,
      { timeoutMs: 10 },
      async () => ({
        postMessage() {
          onMessage?.({ ok: true, snapshot: { ready: true } });
        },
        subscribe(listeners) {
          onMessage = listeners.onMessage;
          return () => {};
        },
        terminate() {
          terminationCount += 1;
        },
      }),
    );

  await new Promise((resolve) => setTimeout(resolve, 15));
  assertEquals(snapshot, { ready: true });
  assertEquals(terminationCount, 1);
});

Deno.test("declarative config worker cleans up a synchronous subscription failure", async () => {
  const payload = await createPayload("export default { ready: true };");
  let postCount = 0;
  let terminationCount = 0;
  let unsubscribeCount = 0;

  const error = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
        payload,
        {},
        async () => ({
          postMessage() {
            postCount += 1;
          },
          subscribe(listeners) {
            listeners.onError();
            return () => {
              unsubscribeCount += 1;
            };
          },
          terminate() {
            terminationCount += 1;
          },
        }),
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;

  assertEquals(error.reason, "worker-unavailable");
  assertEquals(postCount, 0);
  assertEquals(terminationCount, 1);
  assertEquals(unsubscribeCount, 1);
});

describe("declarative config worker terminal endpoint events", () => {
  it("fails fast when the worker exits first", async () => {
    const payload = await createPayload("export default { ready: true };");
    let postCount = 0;
    let terminationCount = 0;
    let unsubscribeCount = 0;

    const error = await assertRejects(
      () =>
        declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
          payload,
          {},
          async () => ({
            postMessage() {
              postCount += 1;
            },
            subscribe(listeners) {
              listeners.onExit?.(1);
              return () => {
                unsubscribeCount += 1;
              };
            },
            terminate() {
              terminationCount += 1;
            },
          }),
        ),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;

    assertEquals(
      error.reason,
      "worker-unavailable",
      "a worker that exits before responding must fail fast, not time out",
    );
    assertEquals(postCount, 0, "no payload is posted to an exited worker");
    assertEquals(terminationCount, 1, "the exited endpoint is terminated once");
    assertEquals(unsubscribeCount, 1, "the terminal event releases the subscription");
  });

  it("surfaces an undeserializable message as a protocol failure", async () => {
    const payload = await createPayload("export default { ready: true };");
    let postCount = 0;
    let terminationCount = 0;
    let unsubscribeCount = 0;

    const error = await assertRejects(
      () =>
        declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
          payload,
          {},
          async () => ({
            postMessage() {
              postCount += 1;
            },
            subscribe(listeners) {
              listeners.onMessageError();
              return () => {
                unsubscribeCount += 1;
              };
            },
            terminate() {
              terminationCount += 1;
            },
          }),
        ),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;

    assertEquals(
      error.reason,
      "worker-protocol",
      "an undeserializable worker message must surface as a protocol failure",
    );
    assertEquals(postCount, 0, "no payload is posted after a protocol failure");
    assertEquals(terminationCount, 1, "the failed endpoint is terminated once");
    assertEquals(unsubscribeCount, 1, "the terminal event releases the subscription");
  });
});

Deno.test("declarative config worker bounds active and queued evaluations", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 1);
  const messageListeners: Array<(value: unknown) => void> = [];
  let factoryCalls = 0;
  let terminationCount = 0;

  const endpointFactory = async () => {
    factoryCalls += 1;
    return {
      postMessage() {},
      subscribe(listeners: { onMessage(value: unknown): void }) {
        messageListeners.push(listeners.onMessage);
        return () => {};
      },
      terminate() {
        terminationCount += 1;
      },
    };
  };

  const first = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1_000 },
      endpointFactory,
      admission,
    );
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(factoryCalls, 1);
  assertEquals(admission.snapshot(), { active: 1, queued: 0 });

  const second = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1_000 },
      endpointFactory,
      admission,
    );
  await Promise.resolve();
  assertEquals(factoryCalls, 1);
  assertEquals(admission.snapshot(), { active: 1, queued: 1 });

  const overload = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithAdmissionController(
        payload,
        { timeoutMs: 1_000 },
        endpointFactory,
        admission,
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(overload.reason, "worker-overloaded");
  assertEquals(overload.retryable, true);
  assertEquals(factoryCalls, 1);

  messageListeners[0]?.({ ok: true, snapshot: { sequence: 1 } });
  assertEquals(await first, { sequence: 1 });
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(factoryCalls, 2);
  assertEquals(admission.snapshot(), { active: 1, queued: 0 });
  await waitForCondition(
    "the queued evaluation to install its message listener",
    () => messageListeners.length,
    (listenerCount) => listenerCount >= 2,
  );
  assertEquals(messageListeners.length, 2);

  messageListeners[1]?.({ ok: true, snapshot: { sequence: 2 } });
  assertEquals(await second, { sequence: 2 });
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  assertEquals(terminationCount, 2);
});

/**
 * A monotonic clock that never advances.
 *
 * The runner charges time spent inside `admissionController.acquire` against
 * the caller deadline, so a short `timeoutMs` can be exhausted before the
 * startup permit is taken. That path reports `worker-timeout` without ever
 * counting the orphan, which is indistinguishable by reason from the timeout
 * these tests do want. Freezing the clock keeps the deadline unspent until the
 * evaluation itself owns it.
 */
function frozenClock(): () => number {
  return () => 0;
}

Deno.test("declarative config worker bounds factories that never settle without retaining ordinary admission", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 0);
  const startup = declarativeConfigWorkerRunnerInternals
    .createStartupController(1);
  let factoryCalls = 0;
  const endpointFactory = () => {
    factoryCalls += 1;
    return new Promise<never>(() => {});
  };

  const first = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1 },
      endpointFactory,
      admission,
      5,
      startup,
      frozenClock(),
    );
  const timeoutError = await assertRejects(
    () => first,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(timeoutError.reason, "worker-timeout");
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  assertEquals(startup.snapshot(), { pending: 1, maxPending: 1 });
  assertEquals(factoryCalls, 1);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const overload = await assertRejects(
      () =>
        declarativeConfigWorkerRunnerInternals.evaluateWithAdmissionController(
          payload,
          { timeoutMs: 100 },
          endpointFactory,
          admission,
          5,
          startup,
        ),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(overload.reason, "worker-overloaded");
  }
  assertEquals(factoryCalls, 1);
  assertEquals(admission.snapshot(), { active: 0, queued: 0 });
  assertEquals(startup.snapshot(), { pending: 1, maxPending: 1 });
});

Deno.test("declarative config worker releases ordinary admission when an orphan factory is aborted", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 0);
  const startup = declarativeConfigWorkerRunnerInternals
    .createStartupController(1);
  const controller = new AbortController();
  let factoryCalls = 0;

  const evaluation = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { signal: controller.signal, timeoutMs: 1_000 },
      () => {
        factoryCalls += 1;
        return new Promise<never>(() => {});
      },
      admission,
      5,
      startup,
    );
  await Promise.resolve();
  controller.abort();

  const error = await assertRejects(
    () => evaluation,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(error.reason, "worker-aborted");
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  assertEquals(factoryCalls, 1);
  assertEquals(startup.snapshot(), { pending: 1, maxPending: 1 });
});

Deno.test("declarative config worker terminates a late factory result and recovers startup capacity", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 0);
  const startup = declarativeConfigWorkerRunnerInternals
    .createStartupController(1);
  const firstFactory = Promise.withResolvers<{
    postMessage(): void;
    subscribe(): () => void;
    terminate(): void;
  }>();
  let factoryCalls = 0;
  let firstPostCount = 0;
  let terminationCount = 0;
  let nextMessage: ((value: unknown) => void) | undefined;

  const endpointFactory = () => {
    factoryCalls += 1;
    if (factoryCalls === 1) return firstFactory.promise;
    return Promise.resolve({
      postMessage() {
        nextMessage?.({ ok: true, snapshot: { recovered: true } });
      },
      subscribe(listeners: { onMessage(value: unknown): void }) {
        nextMessage = listeners.onMessage;
        return () => {};
      },
      terminate() {
        terminationCount += 1;
      },
    });
  };

  const first = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1 },
      endpointFactory,
      admission,
      5,
      startup,
      frozenClock(),
    );
  const timeoutError = await assertRejects(
    () => first,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(timeoutError.reason, "worker-timeout");
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  assertEquals(startup.snapshot(), { pending: 1, maxPending: 1 });

  const overload = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithAdmissionController(
        payload,
        { timeoutMs: 100 },
        endpointFactory,
        admission,
        5,
        startup,
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(overload.reason, "worker-overloaded");
  assertEquals(factoryCalls, 1);

  firstFactory.resolve({
    postMessage() {
      firstPostCount += 1;
    },
    subscribe() {
      return () => {};
    },
    terminate() {
      terminationCount += 1;
    },
  });
  await waitForStartupState(startup, { pending: 0, maxPending: 1 });
  assertEquals(firstPostCount, 0);
  assertEquals(terminationCount, 1);

  const recovered = await declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 100 },
      endpointFactory,
      admission,
      5,
      startup,
    );
  assertEquals(recovered, { recovered: true });
  assertEquals(factoryCalls, 2);
  assertEquals(terminationCount, 2);
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  assertEquals(startup.snapshot(), { pending: 0, maxPending: 1 });
});

Deno.test("declarative config worker releases both capacity classes when a factory throws", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 0);
  const startup = declarativeConfigWorkerRunnerInternals
    .createStartupController(1);
  let factoryCalls = 0;
  let onMessage: ((value: unknown) => void) | undefined;

  const endpointFactory = () => {
    factoryCalls += 1;
    if (factoryCalls === 1) throw new Error("startup failed");
    return Promise.resolve({
      postMessage() {
        onMessage?.({ ok: true, snapshot: { recovered: true } });
      },
      subscribe(listeners: { onMessage(value: unknown): void }) {
        onMessage = listeners.onMessage;
        return () => {};
      },
      terminate() {},
    });
  };

  const error = await assertRejects(
    () =>
      declarativeConfigWorkerRunnerInternals.evaluateWithAdmissionController(
        payload,
        { timeoutMs: 100 },
        endpointFactory,
        admission,
        5,
        startup,
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(error.reason, "worker-unavailable");
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  await waitForStartupState(startup, { pending: 0, maxPending: 1 });

  const recovered = await declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 100 },
      endpointFactory,
      admission,
      5,
      startup,
    );
  assertEquals(recovered, { recovered: true });
  assertEquals(factoryCalls, 2);
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
  assertEquals(startup.snapshot(), { pending: 0, maxPending: 1 });
});

Deno.test("declarative config worker lifecycle uses captured primordials after shared-realm poisoning", async () => {
  const payload = await createPayload("export default { ready: true };");
  const preAbortedSignal = AbortSignal.abort();
  const liveSignal = new AbortController().signal;
  const restores: Array<() => void> = [];
  let poisonCalls = 0;
  const poison = () => {
    poisonCalls += 1;
    throw new Error("ambient lifecycle primordial must not run");
  };
  const replace = (
    target: object,
    key: PropertyKey,
    descriptor: PropertyDescriptor,
  ) => {
    restores[restores.length] = replacePropertyForTest(target, key, descriptor);
  };

  let preAbortedError: unknown;
  let expiredError: unknown;
  let evaluationResult: unknown;
  let admissionState: unknown;
  let startupState: unknown;
  try {
    for (
      const key of ["push", "shift", "indexOf", "splice"] as const
    ) {
      replace(Array.prototype, key, { value: poison, writable: true });
    }
    replace(Promise, "resolve", { value: poison, writable: true });
    replace(Promise, "reject", { value: poison, writable: true });
    replace(Promise.prototype, "then", { value: poison, writable: true });
    replace(Object, "freeze", { value: poison, writable: true });
    replace(Number, "isSafeInteger", { value: poison, writable: true });
    replace(Math, "ceil", { value: poison, writable: true });
    replace(AbortSignal.prototype, "aborted", { get: poison });
    replace(EventTarget.prototype, "addEventListener", {
      value: poison,
      writable: true,
    });
    replace(EventTarget.prototype, "removeEventListener", {
      value: poison,
      writable: true,
    });
    replace(globalThis, "setTimeout", { value: poison, writable: true });
    replace(globalThis, "clearTimeout", { value: poison, writable: true });
    replace(Reflect, "apply", { value: poison, writable: true });

    const admission = declarativeConfigWorkerRunnerInternals
      .createAdmissionController(1, 2);
    const startup = declarativeConfigWorkerRunnerInternals
      .createStartupController(1);

    try {
      await admission.acquire(1_000, preAbortedSignal);
    } catch (error) {
      preAbortedError = error;
    }
    const releaseActive = await admission.acquire(1_000);
    const expired = admission.acquire(1, liveSignal);
    try {
      await expired;
    } catch (error) {
      expiredError = error;
    }
    const dispatched = admission.acquire(1_000, liveSignal);
    releaseActive();
    const releaseDispatched = await dispatched;
    releaseDispatched();

    let onMessage: ((value: unknown) => void) | undefined;
    evaluationResult = await declarativeConfigWorkerRunnerInternals
      .evaluateWithAdmissionController(
        payload,
        { timeoutMs: 100 },
        async () => ({
          postMessage() {
            onMessage?.({ ok: true, snapshot: { captured: true } });
          },
          subscribe(listeners) {
            onMessage = listeners.onMessage;
            return () => {};
          },
          terminate() {},
        }),
        admission,
        5,
        startup,
      );
    await waitForCondition(
      "captured-primordial worker lifecycle cleanup",
      () => ({
        admission: admission.snapshot(),
        startup: startup.snapshot(),
      }),
      (current) =>
        current.admission.active === 0 &&
        current.startup.pending === 0,
    );
    admissionState = admission.snapshot();
    startupState = startup.snapshot();
  } finally {
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      restores[index]?.();
    }
  }

  assert(preAbortedError instanceof DeclarativeConfigEvaluationError);
  assertEquals(preAbortedError.reason, "worker-aborted");
  assert(expiredError instanceof DeclarativeConfigEvaluationError);
  assertEquals(expiredError.reason, "worker-timeout");
  assertEquals(evaluationResult, { captured: true });
  assertEquals(admissionState, { active: 0, queued: 0 });
  assertEquals(startupState, { pending: 0, maxPending: 1 });
  assertEquals(poisonCalls, 0);
});

Deno.test("declarative config worker releases admission after a stuck termination drain bound", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 0);
  const abort = new AbortController();
  let terminationCount = 0;

  const first = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { signal: abort.signal, timeoutMs: 100 },
      async () => ({
        postMessage() {
          abort.abort();
        },
        subscribe() {
          return () => {};
        },
        terminate() {
          terminationCount += 1;
          return new Promise<never>(() => {});
        },
      }),
      admission,
      5,
    );

  const abortError = await assertRejects(
    () => first,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(abortError.reason, "worker-aborted");
  assertEquals(terminationCount, 1);
  await waitForAdmissionState(admission, { active: 0, queued: 0 });

  let onMessage: ((value: unknown) => void) | undefined;
  const second = await declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 100 },
      async () => ({
        postMessage() {
          onMessage?.({ ok: true, snapshot: { recovered: true } });
        },
        subscribe(listeners) {
          onMessage = listeners.onMessage;
          return () => {};
        },
        terminate() {},
      }),
      admission,
      5,
    );

  assertEquals(second, { recovered: true });
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
});

Deno.test("declarative config worker preserves a successful result when terminate throws", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 0);
  let onMessage: ((value: unknown) => void) | undefined;

  const snapshot = await declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 100 },
      async () => ({
        postMessage() {
          onMessage?.({ ok: true, snapshot: { ready: true } });
        },
        subscribe(listeners) {
          onMessage = listeners.onMessage;
          return () => {};
        },
        terminate() {
          throw new Error("termination failed");
        },
      }),
      admission,
      5,
    );

  assertEquals(snapshot, { ready: true });
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
});

Deno.test("declarative config worker removes aborted and expired queue entries", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 2);
  let activeListener: ((value: unknown) => void) | undefined;
  let factoryCalls = 0;

  const endpointFactory = async () => {
    factoryCalls += 1;
    return {
      postMessage() {},
      subscribe(listeners: { onMessage(value: unknown): void }) {
        activeListener = listeners.onMessage;
        return () => {};
      },
      terminate() {},
    };
  };

  const active = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1_000 },
      endpointFactory,
      admission,
    );
  await Promise.resolve();
  await Promise.resolve();

  const controller = new AbortController();
  const aborted = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { signal: controller.signal, timeoutMs: 1_000 },
      endpointFactory,
      admission,
    );
  await Promise.resolve();
  controller.abort();
  const abortError = await assertRejects(
    () => aborted,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(abortError.reason, "worker-aborted");

  const expired = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1 },
      endpointFactory,
      admission,
    );
  const timeoutError = await assertRejects(
    () => expired,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(timeoutError.reason, "worker-timeout");
  assertEquals(admission.snapshot(), { active: 1, queued: 0 });
  assertEquals(factoryCalls, 1);

  activeListener?.({ ok: true, snapshot: { ready: true } });
  await active;
  await waitForAdmissionState(admission, { active: 0, queued: 0 });
});

Deno.test("declarative config worker protocol rejects malformed responses", () => {
  assertEquals(DECLARATIVE_CONFIG_WORKER_PROTOCOL_VERSION, 2);

  for (
    const response of [
      null,
      {},
      { ok: true },
      { ok: true, snapshot: {}, extra: true },
      { ok: false, error: {} },
      {
        ok: false,
        error: {
          code: "made-up",
          phase: "worker",
          reason: "worker-protocol",
          location: null,
          retryable: false,
        },
      },
    ]
  ) {
    const error = assertThrows(
      () => decodeDeclarativeConfigWorkerResponse(response, 100),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(error.code, "evaluator-unavailable");
    assertEquals(error.phase, "worker");
    assertEquals(error.reason, "worker-protocol");
  }
});

Deno.test("declarative config worker protocol rejects hostile descriptors and tuples", () => {
  let getterCalls = 0;
  const accessorResponse = {};
  Object.defineProperty(accessorResponse, "ok", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  const customPrototypeResponse = Object.create({ inherited: true });
  Object.assign(customPrototypeResponse, { ok: true, snapshot: {} });

  for (
    const response of [
      accessorResponse,
      customPrototypeResponse,
      { ok: true, snapshot: {}, [Symbol("extra")]: true },
      {
        ok: false,
        error: {
          code: "source-too-large",
          phase: "result",
          reason: "syntax-error",
          location: null,
          retryable: true,
        },
      },
      {
        ok: false,
        error: {
          code: "syntax-error",
          phase: "parse",
          reason: "syntax-error",
          location: {
            line: 1,
            column: 5,
            offset: 5,
            fileName: "veryfront.config.ts",
          },
          retryable: false,
        },
      },
      {
        ok: true,
        snapshot: { oversized: new Array(2_049).fill(true) },
      },
    ]
  ) {
    const error = assertThrows(
      () => decodeDeclarativeConfigWorkerResponse(response, 4),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(error.reason, "worker-protocol");
  }
  assertEquals(getterCalls, 0);
});

Deno.test("declarative config worker protocol binds response locations to the request filename", () => {
  const error = assertThrows(
    () =>
      decodeDeclarativeConfigWorkerResponse(
        {
          ok: false,
          error: {
            code: "syntax-error",
            phase: "parse",
            reason: "syntax-error",
            location: {
              line: 1,
              column: 0,
              offset: 0,
              fileName: "veryfront.config.ts",
            },
            retryable: false,
          },
        },
        10,
        "veryfront.config.js",
      ),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(error.reason, "worker-protocol");
});

Deno.test("declarative config worker protocol rejects hostile requests without getters", async () => {
  const payload = await createPayload("export default { ready: true };");
  const decoded = decodeDeclarativeConfigWorkerRequest(payload);
  assertEquals(Object.getPrototypeOf(decoded), null);
  assertEquals(Object.isFrozen(decoded), true);

  let getterCalls = 0;
  const hostileEnvironment = {};
  Object.defineProperty(hostileEnvironment, "SECRET", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "host";
    },
  });

  for (
    const request of [
      {
        cacheFingerprint: "ctx1:not-a-digest",
        policyVersion: payload.policyVersion,
        evaluationOptions: payload.evaluationOptions,
      },
      {
        cacheFingerprint: payload.cacheFingerprint,
        policyVersion: "hosted-declarative-config-v1",
        evaluationOptions: payload.evaluationOptions,
      },
      {
        cacheFingerprint: payload.cacheFingerprint,
        policyVersion: payload.policyVersion,
        evaluationOptions: {
          source: payload.evaluationOptions.source,
          fileName: payload.evaluationOptions.fileName,
          environmentName: payload.evaluationOptions.environmentName,
          environment: hostileEnvironment,
        },
      },
      {
        cacheFingerprint: payload.cacheFingerprint,
        policyVersion: payload.policyVersion,
        evaluationOptions: {
          ...payload.evaluationOptions,
          fileName: "../../tenant/veryfront.config.ts",
        },
      },
      {
        cacheFingerprint: payload.cacheFingerprint,
        policyVersion: payload.policyVersion,
        evaluationOptions: payload.evaluationOptions,
        [Symbol("extra")]: true,
      },
    ]
  ) {
    const error = assertThrows(
      () => decodeDeclarativeConfigWorkerRequest(request),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(error.reason, "worker-protocol");
  }
  assertEquals(getterCalls, 0);
});

Deno.test("declarative config worker protocol rebuilds cloned success data", () => {
  const decoded = decodeDeclarativeConfigWorkerResponse({
    ok: true,
    snapshot: {
      z: { value: 2 },
      a: [1, 2],
    },
  }, 100);

  assert(decoded.ok);
  assertEquals(decoded.snapshot, {
    a: [1, 2],
    z: { value: 2 },
  });
  assertEquals(Object.getPrototypeOf(decoded.snapshot), null);
  assertEquals(Object.getPrototypeOf(decoded.snapshot.z), null);
  assertEquals(Object.isFrozen(decoded.snapshot), true);
  assertEquals(Object.isFrozen(decoded.snapshot.a), true);
});

Deno.test("declarative config worker protocol ignores inherited descriptor fields during response round trips", () => {
  const restores: Array<() => void> = [];
  let inheritedDescriptorGetterCalls = 0;
  const inheritedDescriptorGetter = () => {
    inheritedDescriptorGetterCalls += 1;
    throw new Error("inherited descriptor field must not be read");
  };
  let decodedSuccess:
    | ReturnType<typeof decodeDeclarativeConfigWorkerResponse>
    | undefined;
  let decodedError: unknown;

  try {
    for (
      const key of [
        "configurable",
        "enumerable",
        "value",
        "writable",
        "get",
        "set",
      ] as const
    ) {
      restores[restores.length] = replacePropertyForTest(
        Object.prototype,
        key,
        { get: inheritedDescriptorGetter },
      );
    }

    const successResponse = createDeclarativeConfigWorkerSuccessResponse({
      nested: { enabled: true },
      title: "production",
    });
    decodedSuccess = decodeDeclarativeConfigWorkerResponse(
      successResponse,
      100,
    );

    const errorResponse = createDeclarativeConfigWorkerErrorResponse(
      new DeclarativeConfigEvaluationError({
        code: "syntax-error",
        phase: "parse",
        reason: "syntax-error",
        location: {
          line: 2,
          column: 3,
          offset: 12,
          fileName: "veryfront.config.ts",
        },
        retryable: false,
      }),
    );
    try {
      decodeDeclarativeConfigWorkerResponse(errorResponse, 100);
    } catch (error) {
      decodedError = error;
    }
  } finally {
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      restores[index]!();
    }
  }

  assertEquals(inheritedDescriptorGetterCalls, 0);
  assertEquals(decodedSuccess, {
    ok: true,
    snapshot: {
      nested: { enabled: true },
      title: "production",
    },
  });
  assert(decodedError instanceof DeclarativeConfigEvaluationError);
  assertEquals(
    {
      code: decodedError.code,
      phase: decodedError.phase,
      reason: decodedError.reason,
      location: decodedError.location,
      retryable: decodedError.retryable,
    },
    {
      code: "syntax-error",
      phase: "parse",
      reason: "syntax-error",
      location: {
        line: 2,
        column: 3,
        offset: 12,
        fileName: "veryfront.config.ts",
      },
      retryable: false,
    },
  );
});
