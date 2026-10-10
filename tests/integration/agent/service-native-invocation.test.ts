import { types as utilTypes } from "node:util";
import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";
import type { HostedServiceAuthenticatedRequest } from "#veryfront/agent/service/auth.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

const runtimeSource = { type: "release", releaseId: "release-42" } as const;

function createRuntimeInvocationBody(canary: string, padding = 0): string {
  const credentials = JSON.stringify({
    authToken: "control-plane-auth-token",
    inferenceAuthToken: canary,
  });
  // JSON whitespace after the credentials places them in a full leading body block.
  return `{"credentials":${credentials},${" ".repeat(padding)}${
    JSON.stringify({
      run: {
        agentServiceId: "test-agent-service",
        agentId: "builder",
        conversationId: "00000000-0000-4000-8000-000000000001",
        runId: "run-1",
        messageId: "00000000-0000-4000-8000-000000000002",
        inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
        requestedByUserId: "00000000-0000-4000-8000-000000000004",
        project: {
          projectId: "00000000-0000-4000-8000-000000000005",
          projectSlug: "demo",
        },
      },
      messages: [],
      tools: [],
      context: [],
      agentSource: runtimeSource,
    }).slice(1)
  }`;
}

function createRuntimeInvocationRequest(canary: string, padding?: number): Request {
  if (padding !== undefined) {
    return new Request("https://agent.example.test/api/control-plane/runs/run-1/stream", {
      method: "POST",
      headers: {
        authorization: "Bearer authenticated-user-token",
        "content-type": "application/json",
        "X-Veryfront-Run-Event-Token": "verified-event-token",
      },
      body: createRuntimeInvocationBody(canary, padding),
    });
  }
  return new Request("https://agent.example.test/api/control-plane/runs/run-1/stream", {
    method: "POST",
    headers: {
      authorization: "Bearer authenticated-user-token",
      "content-type": "application/json",
      "X-Veryfront-Inference-Token": canary,
      "X-Veryfront-Run-Event-Token": "verified-event-token",
    },
    body: JSON.stringify({
      run: {
        agentServiceId: "test-agent-service",
        agentId: "builder",
        conversationId: "00000000-0000-4000-8000-000000000001",
        runId: "run-1",
        messageId: "00000000-0000-4000-8000-000000000002",
        inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
        requestedByUserId: "00000000-0000-4000-8000-000000000004",
        project: {
          projectId: "00000000-0000-4000-8000-000000000005",
          projectSlug: "demo",
        },
      },
      messages: [],
      tools: [],
      context: [],
      agentSource: runtimeSource,
      credentials: {
        authToken: "control-plane-auth-token",
        inferenceAuthToken: canary,
      },
    }),
  });
}

for (const mutation of ["iterator", "dispatcher", "serialization", "isProxy"] as const) {
  it(`keeps infrastructure credentials out of native ${mutation} hooks`, async () => {
    if (!isNode) return;

    const canary = "synthetic-runtime-invocation-canary";
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Headers.prototype,
      Symbol.iterator,
    )!;
    const nativeIterator = iteratorDescriptor.value as (this: Headers) => Iterator<
      [string, string]
    >;
    const apply = Reflect.apply;
    const getHeader = Headers.prototype.get;
    const dispatcherDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "dispatcher");
    const originalIsProxy = utilTypes.isProxy;
    let detachedRequest: Request | undefined;
    const toJSONDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    let serializationCalls = 0;
    let observations = 0;
    const replaceDispatcher = () => {
      Object.defineProperty(Object.prototype, "dispatcher", {
        configurable: true,
        get(this: RequestInit) {
          if (
            this.headers instanceof Headers &&
            apply(getHeader, this.headers, ["X-Veryfront-Inference-Token"]) === canary
          ) observations++;
          return undefined;
        },
      });
    };
    let verificationCompleted = false;
    let detachedDispatches = 0;
    let response: Response | undefined;
    let failure: unknown;
    const routeSet = createHostedAgentServiceRouteSet({
      runtimeSource,
      tracker: createDetachedRunTracker<AgUiResumeValue>(),
      authenticateRequest: async (): Promise<HostedServiceAuthenticatedRequest> => ({
        authToken: "authenticated-user-token",
        userId: "user-1",
      }),
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunEventAppendToken: async () => {
        verificationCompleted = true;
        if (mutation === "isProxy") {
          utilTypes.isProxy = new Proxy(originalIsProxy, {
            apply(target, receiver, args) {
              if (
                args[0] instanceof Headers &&
                apply(getHeader, args[0], ["X-Veryfront-Inference-Token"]) === canary
              ) observations++;
              return apply(target, receiver, args);
            },
          });
        } else if (mutation === "dispatcher") {
          replaceDispatcher();
        } else if (mutation === "serialization") {
          Object.defineProperty(Object.prototype, "toJSON", {
            configurable: true,
            value: function (this: unknown) {
              serializationCalls++;
              replaceDispatcher();
              return this;
            },
          });
        } else {
          Object.defineProperty(Headers.prototype, Symbol.iterator, {
            ...iteratorDescriptor,
            value: function (this: Headers) {
              const iterator = apply(nativeIterator, this, []) as Iterator<[string, string]>;
              return {
                next() {
                  const result = iterator.next();
                  if (result.value?.[1] === canary) observations++;
                  return result;
                },
                [Symbol.iterator]() {
                  return this;
                },
              };
            },
          });
        }
        return true;
      },
      prepareExecution: async () => ({ executionId: "exec-1" }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async ({ rawRequest }) => {
        detachedRequest = rawRequest;
        detachedDispatches++;
      },
    });

    try {
      response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
        request: createRuntimeInvocationRequest(canary),
        runId: "run-1",
      });
    } catch (error) {
      failure = error;
    } finally {
      utilTypes.isProxy = originalIsProxy;
      Object.defineProperty(Headers.prototype, Symbol.iterator, iteratorDescriptor);
      if (toJSONDescriptor) Object.defineProperty(Object.prototype, "toJSON", toJSONDescriptor);
      else Reflect.deleteProperty(Object.prototype, "toJSON");
      if (dispatcherDescriptor) {
        Object.defineProperty(Object.prototype, "dispatcher", dispatcherDescriptor);
      } else Reflect.deleteProperty(Object.prototype, "dispatcher");
    }

    assertEquals(verificationCompleted, true, "the mutation occurs after verification");
    if (mutation === "serialization") assertEquals(serializationCalls > 0, true);
    assertEquals(observations, 0, "the modified native operation never observes the credential");
    if (mutation === "isProxy") {
      assertEquals(failure, undefined);
      assertEquals(response?.status, 202);
      assertEquals(detachedDispatches, 1);
      assertEquals(detachedRequest?.headers.get("X-Veryfront-Inference-Token"), null);
      assertEquals((await detachedRequest?.text())?.includes(canary), false);
      return;
    }
    assertEquals(failure instanceof TypeError, true, "the compromised operation fails explicitly");
    assertEquals(response, undefined, "the route never substitutes a success response");
    assertEquals(detachedDispatches, 0, "the route never starts detached execution");
  });
}

const BodyApply = Reflect.apply;
const BodyDecode = TextDecoder.prototype.decode;
const BodyDecoder = new TextDecoder();
const BodyIncludes = String.prototype.includes;
const BodyObjectValues = Object.values;
const BodyPromiseThen = Promise.prototype.then;
const BodyGetReader = ReadableStream.prototype.getReader;
const BodyRead = ReadableStreamDefaultReader.prototype.read;

/** Detect the synthetic canary without calling the replaced operations under test. */
function containsBodyCanary(value: unknown, canary: string, depth = 0): boolean {
  if (typeof value === "string") return BodyApply(BodyIncludes, value, [canary]) as boolean;
  if (value instanceof Uint8Array) {
    const text = BodyApply(BodyDecode, BodyDecoder, [value]) as string;
    return BodyApply(BodyIncludes, text, [canary]) as boolean;
  }
  if (depth > 6 || typeof value !== "object" || value === null) return false;
  const values = BodyObjectValues(value);
  for (let index = 0; index < values.length; index++) {
    if (containsBodyCanary(values[index], canary, depth + 1)) return true;
  }
  return false;
}

async function readBranch(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = BodyApply(BodyGetReader, stream, []) as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  while (true) {
    const step = await (BodyApply(BodyRead, reader, []) as Promise<
      ReadableStreamReadResult<Uint8Array>
    >);
    if (step.done) return chunks;
    chunks[chunks.length] = step.value;
  }
}

type BodyMutation = {
  readonly name: string;
  readonly nodeOnly: boolean;
  readonly phase: "before" | "authentication" | "verification";
  /** Whether the route must reject: always, only where Node's native body checks apply, or never. */
  readonly rejects: "always" | "node" | "never";
  /** Body whitespace that fills at least one complete body block. */
  readonly padding?: number;
  install(observe: (value: unknown) => void, pending: Promise<unknown>[]): () => void;
};

function replaceMethod(
  target: object,
  key: PropertyKey,
  wrap: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
  Object.defineProperty(target, key, {
    ...descriptor,
    value: wrap(descriptor.value as (...args: unknown[]) => unknown),
  });
  return () => Object.defineProperty(target, key, descriptor);
}

function inheritedThen(observe: (value: unknown) => void): () => void {
  let active = false;
  Object.defineProperty(Object.prototype, "then", {
    configurable: true,
    get(this: unknown) {
      if (!active) {
        active = true;
        try {
          observe(this);
        } finally {
          active = false;
        }
      }
      return undefined;
    },
  });
  return () => Reflect.deleteProperty(Object.prototype, "then");
}

const bodyMutations: readonly BodyMutation[] = [
  {
    name: "stream tee",
    nodeOnly: true,
    phase: "before",
    rejects: "always",
    install: (observe, pending) =>
      replaceMethod(
        ReadableStream.prototype,
        "tee",
        (original) =>
          function (this: ReadableStream<Uint8Array>) {
            const branches = BodyApply(original, this, []) as ReadableStream<Uint8Array>[];
            const observed = BodyApply(original, branches[0], []) as ReadableStream<Uint8Array>[];
            pending[pending.length] = BodyApply(BodyPromiseThen, readBranch(observed[0]!), [
              (chunks: Uint8Array[]) => {
                for (let index = 0; index < chunks.length; index++) observe(chunks[index]);
              },
            ]);
            return [observed[1], branches[1]];
          },
      ),
  },
  {
    name: "stream reader",
    nodeOnly: true,
    phase: "verification",
    rejects: "always",
    install: (observe) =>
      replaceMethod(
        ReadableStreamDefaultReader.prototype,
        "read",
        (original) =>
          function (this: ReadableStreamDefaultReader<Uint8Array>, ...args: unknown[]) {
            const result = BodyApply(original, this, args) as Promise<unknown>;
            return BodyApply(BodyPromiseThen, result, [(step: unknown) => {
              observe(step);
              return step;
            }]);
          },
      ),
  },
  {
    name: "text decoder",
    nodeOnly: true,
    phase: "verification",
    rejects: "always",
    install: (observe) =>
      replaceMethod(
        TextDecoder.prototype,
        "decode",
        (original) =>
          function (this: TextDecoder, ...args: unknown[]) {
            observe(args[0]);
            return BodyApply(original, this, args);
          },
      ),
  },
  {
    name: "array push",
    nodeOnly: true,
    phase: "verification",
    rejects: "always",
    install: (observe) =>
      replaceMethod(
        Array.prototype,
        "push",
        (original) =>
          function (this: unknown[], ...args: unknown[]) {
            observe(args);
            return BodyApply(original, this, args);
          },
      ),
  },
  {
    name: "JSON parse",
    nodeOnly: true,
    phase: "verification",
    rejects: "always",
    install: (observe) =>
      replaceMethod(JSON, "parse", (original) =>
        function (this: JSON, ...args: unknown[]) {
          observe(args[0]);
          return BodyApply(original, this, args);
        }),
  },
  {
    name: "inherited then before the body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "always",
    install: (observe) => inheritedThen(observe),
  },
  {
    name: "inherited then after verification",
    nodeOnly: false,
    phase: "verification",
    rejects: "always",
    install: (observe) => inheritedThen(observe),
  },
  {
    name: "typed array subarray during the body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "never",
    install: (observe) =>
      replaceMethod(
        Object.getPrototypeOf(Uint8Array.prototype),
        "subarray",
        (original) =>
          function (this: Uint8Array, ...args: unknown[]) {
            observe(this);
            return BodyApply(original, this, args);
          },
      ),
  },
  {
    name: "typed array byteLength getter during the body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "node",
    install: (observe) => {
      const prototype = Object.getPrototypeOf(Uint8Array.prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "byteLength")!;
      Object.defineProperty(prototype, "byteLength", {
        ...descriptor,
        get(this: Uint8Array) {
          observe(this);
          return BodyApply(descriptor.get!, this, []);
        },
      });
      return () => Object.defineProperty(prototype, "byteLength", descriptor);
    },
  },
  {
    name: "text decoder during the body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "node",
    install: (observe) =>
      replaceMethod(
        TextDecoder.prototype,
        "decode",
        (original) =>
          function (this: TextDecoder, ...args: unknown[]) {
            observe(args[0]);
            return BodyApply(original, this, args);
          },
      ),
  },
  {
    name: "typed array then during the body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "never",
    install: (observe) => {
      // Restores itself on first use, so only a read that never resolves a
      // typed array through a promise leaves the observation count at zero.
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        Reflect.deleteProperty(Uint8Array.prototype, "then");
      };
      Object.defineProperty(Uint8Array.prototype, "then", {
        configurable: true,
        get(this: Uint8Array) {
          observe(this);
          restore();
          return undefined;
        },
      });
      return restore;
    },
  },
  {
    name: "typed array constructor during the body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "node",
    install: (observe) => {
      const descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "constructor")!;
      Object.defineProperty(Uint8Array.prototype, "constructor", {
        configurable: true,
        get(this: Uint8Array) {
          observe(this);
          return descriptor.value;
        },
      });
      return () => Object.defineProperty(Uint8Array.prototype, "constructor", descriptor);
    },
  },
  {
    name: "array index setter during a multi-block body read",
    nodeOnly: false,
    phase: "authentication",
    rejects: "never",
    padding: 70 * 1024,
    install: (observe) => {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set(this: unknown[], value: unknown) {
          observe(value);
          Object.defineProperty(this, "0", {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      return () => Reflect.deleteProperty(Array.prototype, "0");
    },
  },
  {
    name: "Buffer concat after verification",
    nodeOnly: true,
    phase: "verification",
    rejects: "never",
    install: (observe) => {
      const NodeBuffer = (globalThis as unknown as { Buffer: { concat: unknown } }).Buffer;
      return replaceMethod(
        NodeBuffer,
        "concat",
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            observe(args[0]);
            return BodyApply(original, this, args);
          },
      );
    },
  },
  {
    name: "array iterator during credential removal",
    nodeOnly: false,
    phase: "verification",
    rejects: "never",
    install: (observe) =>
      replaceMethod(Array.prototype, Symbol.iterator, (original) =>
        function (this: unknown[]) {
          observe(this);
          return BodyApply(original, this, []);
        }),
  },
  {
    name: "array constructor during credential removal",
    nodeOnly: false,
    phase: "verification",
    rejects: "never",
    install: (observe) => {
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "constructor")!;
      Object.defineProperty(Array.prototype, "constructor", {
        configurable: true,
        get(this: unknown[]) {
          observe(this);
          return descriptor.value;
        },
      });
      return () => Object.defineProperty(Array.prototype, "constructor", descriptor);
    },
  },
];

function isNativeProcessingError(error: unknown): boolean {
  return error instanceof TypeError &&
    /^Cannot (process|construct) (a request body|headers|a request) with /.test(error.message);
}

for (const mutation of bodyMutations) {
  it(`keeps the invocation body credential out of a replaced ${mutation.name}`, async () => {
    if (mutation.nodeOnly && !isNode) return;

    const canary = "synthetic-runtime-body-canary";
    let observations = 0;
    const pending: Promise<unknown>[] = [];
    const observe = (value: unknown) => {
      if (containsBodyCanary(value, canary)) observations++;
    };
    let restore: (() => void) | undefined;
    const installOnce = () => {
      restore ??= mutation.install(observe, pending);
    };
    let detachedDispatches = 0;
    let detachedRequest: Request | undefined;
    let response: Response | undefined;
    let failure: unknown;
    const routeSet = createHostedAgentServiceRouteSet({
      runtimeSource,
      tracker: createDetachedRunTracker<AgUiResumeValue>(),
      authenticateRequest: async (): Promise<HostedServiceAuthenticatedRequest> => {
        if (mutation.phase === "authentication") installOnce();
        return { authToken: "authenticated-user-token", userId: "user-1" };
      },
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunEventAppendToken: async () => {
        if (mutation.phase === "verification") installOnce();
        return true;
      },
      prepareExecution: async () => ({ executionId: "exec-1" }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async ({ rawRequest }) => {
        detachedRequest = rawRequest;
        detachedDispatches++;
      },
    });

    const request = createRuntimeInvocationRequest(canary, mutation.padding);
    if (mutation.phase === "before") installOnce();
    try {
      response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
        request,
        runId: "run-1",
      });
    } catch (error) {
      failure = error;
    } finally {
      restore?.();
    }
    await Promise.allSettled(pending);

    assertEquals(restore !== undefined, true, "the mutation was installed");
    assertEquals(observations, 0, "the replaced operation never observes the body credential");
    if (mutation.rejects === "always" || (mutation.rejects === "node" && isNode)) {
      assertEquals(
        isNativeProcessingError(failure),
        true,
        "the native processing check fails explicitly",
      );
      assertEquals(response, undefined, "the route never substitutes a success response");
      assertEquals(detachedDispatches, 0, "the route never starts detached execution");
      return;
    }
    assertEquals(failure, undefined);
    assertEquals(response?.status, 202);
    assertEquals(detachedDispatches, 1);
    assertEquals((await detachedRequest!.text()).includes(canary), false);
  });
}

it("preserves clean invocation semantics and withholds the body credential", async () => {
  const canary = "synthetic-clean-body-canary";
  let detachedRequest: Request | undefined;
  const routeSet = createHostedAgentServiceRouteSet({
    runtimeSource,
    tracker: createDetachedRunTracker<AgUiResumeValue>(),
    authenticateRequest: async (): Promise<HostedServiceAuthenticatedRequest> => ({
      authToken: "authenticated-user-token",
      userId: "user-1",
    }),
    verifyProjectAccess: async () => ({ success: true }),
    verifyRunEventAppendToken: async () => true,
    prepareExecution: async () => ({ executionId: "exec-1" }),
    streamExecutionToAgUiResponse: () => new Response("streamed"),
    startDetachedExecution: async ({ rawRequest }) => {
      detachedRequest = rawRequest;
    },
  });

  const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
    request: createRuntimeInvocationRequest(canary),
    runId: "run-1",
  });

  assertEquals(response.status, 202);
  assertEquals(detachedRequest?.method, "POST");
  assertEquals(detachedRequest?.headers.get("content-type"), "application/json");
  assertEquals(detachedRequest?.headers.get("X-Veryfront-Inference-Token"), null);
  assertEquals(detachedRequest?.body instanceof ReadableStream, true);
  const payload = await detachedRequest!.json() as {
    run: { runId: string };
    credentials: Record<string, unknown>;
  };
  assertEquals(payload.run.runId, "run-1");
  assertEquals(payload.credentials, { authToken: "control-plane-auth-token" });
  assertEquals(detachedRequest?.bodyUsed, true);
});

it("propagates host authentication error identity on the invocation route", async () => {
  const hostFailure = new Error("synthetic host authentication failure");
  let detachedDispatches = 0;
  const routeSet = createHostedAgentServiceRouteSet({
    runtimeSource,
    tracker: createDetachedRunTracker<AgUiResumeValue>(),
    authenticateRequest: () => Promise.reject(hostFailure),
    verifyProjectAccess: async () => ({ success: true }),
    verifyRunEventAppendToken: async () => true,
    prepareExecution: async () => ({ executionId: "exec-1" }),
    streamExecutionToAgUiResponse: () => new Response("streamed"),
    startDetachedExecution: async () => {
      detachedDispatches++;
    },
  });
  let failure: unknown;
  try {
    await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
      request: createRuntimeInvocationRequest("synthetic-error-canary"),
      runId: "run-1",
    });
  } catch (error) {
    failure = error;
  }
  assertStrictEquals(failure, hostFailure);
  assertEquals(detachedDispatches, 0);
});

it("releases the retained invocation body when authentication rejects", async () => {
  let sourceCancelled = false;
  const encoded = new TextEncoder().encode(createRuntimeInvocationBody("synthetic-cancel-value"));
  // The source stays open, so it is cancelled only after both branches are.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
    },
    cancel() {
      sourceCancelled = true;
    },
  });
  const request = new Request(
    "https://agent.example.test/api/control-plane/runs/run-1/stream",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: source,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  let detachedDispatches = 0;
  const routeSet = createHostedAgentServiceRouteSet({
    runtimeSource,
    tracker: createDetachedRunTracker<AgUiResumeValue>(),
    authenticateRequest: async (authenticationRequest) => {
      // A tee branch's cancel settles only after both branches are cancelled.
      void authenticationRequest.body?.cancel();
      return Response.json({ errorCode: "UNAUTHORIZED" }, { status: 401 });
    },
    verifyProjectAccess: async () => ({ success: true }),
    verifyRunEventAppendToken: async () => true,
    prepareExecution: async () => ({ executionId: "exec-1" }),
    streamExecutionToAgUiResponse: () => new Response("streamed"),
    startDetachedExecution: async () => {
      detachedDispatches++;
    },
  });

  const response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
    request,
    runId: "run-1",
  });
  for (let turn = 0; turn < 10 && !sourceCancelled; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assertEquals(response.status, 401);
  assertEquals(detachedDispatches, 0);
  assertEquals(sourceCancelled, true, "both request body branches are released");
});
