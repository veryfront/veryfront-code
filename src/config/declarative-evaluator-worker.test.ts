import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  DeclarativeConfigEvaluationError,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import {
  DECLARATIVE_CONFIG_WORKER_PROTOCOL_VERSION,
  decodeDeclarativeConfigWorkerRequest,
  decodeDeclarativeConfigWorkerResponse,
} from "./declarative-evaluator-worker-protocol.ts";
import {
  declarativeConfigWorkerRunnerInternals,
  evaluatePreparedDeclarativeConfigInWorker,
} from "./declarative-evaluator-worker-runner.ts";

async function createPayload(source: string) {
  const context = await prepareDeclarativeConfigContext({
    environmentName: "production",
    environment: { TENANT: "isolated" },
  });
  return createPreparedDeclarativeConfigWorkerPayload(source, context);
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

  messageListeners[1]?.({ ok: true, snapshot: { sequence: 2 } });
  assertEquals(await second, { sequence: 2 });
  assertEquals(admission.snapshot(), { active: 0, queued: 0 });
  assertEquals(terminationCount, 2);
});

Deno.test("declarative config worker retains admission until late startup drains", async () => {
  const payload = await createPayload("export default { ready: true };");
  const admission = declarativeConfigWorkerRunnerInternals
    .createAdmissionController(1, 1);
  let resolveFirstFactory:
    | ((endpoint: {
      postMessage(): void;
      subscribe(): () => void;
      terminate(): void;
    }) => void)
    | undefined;
  const firstFactory = new Promise<{
    postMessage(): void;
    subscribe(): () => void;
    terminate(): void;
  }>((resolve) => {
    resolveFirstFactory = resolve;
  });
  let factoryCalls = 0;
  let firstPostCount = 0;
  let terminationCount = 0;

  const endpointFactory = () => {
    factoryCalls += 1;
    if (factoryCalls === 1) return firstFactory;
    return Promise.resolve({
      postMessage() {
        secondMessage?.({ ok: true, snapshot: { sequence: 2 } });
      },
      subscribe(listeners: { onMessage(value: unknown): void }) {
        secondMessage = listeners.onMessage;
        return () => {};
      },
      terminate() {
        terminationCount += 1;
      },
    });
  };
  let secondMessage: ((value: unknown) => void) | undefined;

  const first = declarativeConfigWorkerRunnerInternals
    .evaluateWithAdmissionController(
      payload,
      { timeoutMs: 1 },
      endpointFactory,
      admission,
    );
  const timeoutError = await assertRejects(
    () => first,
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(timeoutError.reason, "worker-timeout");
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

  resolveFirstFactory?.({
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

  assertEquals(await second, { sequence: 2 });
  assertEquals(firstPostCount, 0);
  assertEquals(factoryCalls, 2);
  assertEquals(terminationCount, 2);
  assertEquals(admission.snapshot(), { active: 0, queued: 0 });
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
  assertEquals(admission.snapshot(), { active: 0, queued: 0 });
});

Deno.test("declarative config worker protocol rejects malformed responses", () => {
  assertEquals(DECLARATIVE_CONFIG_WORKER_PROTOCOL_VERSION, 1);

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
        policyVersion: payload.policyVersion,
        evaluationOptions: {
          source: payload.evaluationOptions.source,
          environmentName: payload.evaluationOptions.environmentName,
          environment: hostileEnvironment,
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
