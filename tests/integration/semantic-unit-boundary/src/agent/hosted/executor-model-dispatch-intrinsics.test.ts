import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type {
  AgentRunEvent,
  AgentRunModelCallContextEvent,
} from "#veryfront/runtime/model-call-context.ts";
import { isPrivateConversationRunEvent } from "#veryfront/agent/conversation/private-run-event.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import { createExecutorModelRuntimeResolver } from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { createHostedExecutorModelBroker as createHostedBroker } from "#veryfront/agent/hosted/executor-model-dispatch.ts";

function assertModelCallContextEvent(
  event: AgentRunEvent | undefined,
): asserts event is AgentRunModelCallContextEvent {
  assert(event?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
}

function receiptFor(modelCallId: string | undefined) {
  if (!modelCallId) throw new TypeError("Expected broker-owned logical call identity");
  return {
    eventId: "9007199254740993",
    projectId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    modelCallId,
  };
}

function createHostedExecutorModelBroker(
  input: Omit<Parameters<typeof createHostedBroker>[0], "projectId">,
) {
  const sink = input.runEventSink;
  if (!sink) {
    return createHostedBroker({ ...input, projectId: "11111111-1111-4111-8111-111111111111" });
  }
  return createHostedBroker({
    ...input,
    modelCallCaptureReceipts: true,
    projectId: "11111111-1111-4111-8111-111111111111",
    runEventSink: async (event) => {
      assertModelCallContextEvent(event);
      const receipt = receiptFor(event.modelCallId);
      const acknowledgement = await sink(event);
      return acknowledgement ?? receipt;
    },
  });
}

const modelId = "veryfront-cloud/openai/synthetic-model";
const allowedModelIds = new Set([modelId]);
const grant = () => ({
  maxCalls: 256,
  maxConcurrentCalls: 32,
  models: new Map([[modelId, { maxOutputTokens: 4096, providerTools: [] }]]),
});
const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };
const prompt = [{ role: "user", content: [{ type: "text", text: "Synthetic prompt" }] }] as const;
const expectedPrompt: AgentRunModelCallContextEvent["messages"] = [{
  role: "user",
  content: [{ type: "text", text: "Synthetic prompt" }],
}];

function model(
  onCall: (options: ModelRuntimeCallOptions, mode: string) => void,
): ModelRuntime<ModelRuntimeCallOptions> {
  return {
    provider: "veryfront-cloud",
    modelProvider: "openai",
    modelId: "synthetic-model",
    doGenerate(options) {
      onCall(options, "generate");
      return Promise.resolve({ content: [{ type: "text", text: "Synthetic answer" }] });
    },
    doStream(options) {
      onCall(options, "stream");
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", delta: "Synthetic answer" });
            controller.close();
          },
        }),
      });
    },
  };
}

function pair(
  operations: ReadonlyMap<string, ExecutorOperation>,
  actualBinding: ExecutorBinding = binding,
) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const caller = createExecutorChannel({
    binding: actualBinding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding: actualBinding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  return {
    caller,
    broker,
    async close() {
      caller.close();
      await broker.closed;
    },
  };
}

function scope(signal = new AbortController().signal, scopeBinding = binding) {
  return {
    binding: scopeBinding,
    signal,
    assertActive() {
      signal.throwIfAborted();
    },
  };
}

async function proxy(channels: ReturnType<typeof pair>) {
  const resolver = await createExecutorModelRuntimeResolver({
    channel: channels.caller,
    allowedModelIds,
  });
  return resolver(modelId)!;
}

async function verifyStructuredCloneDefaultTransferListIsolation(): Promise<void> {
  const events: AgentRunModelCallContextEvent[] = [];
  let dispatched = false;
  const channels = pair(createHostedExecutorModelBroker({
    grant: grant(),
    allowedModelIds,
    scope: scope(),
    resolveModelRuntime: () =>
      model(() => {
        dispatched = true;
      }),
    runEventSink(event) {
      assertModelCallContextEvent(event);
      events.push(event);
    },
  }));
  const originalIterator = Array.prototype[Symbol.iterator];
  const apply = Reflect.apply;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    value: function (this: unknown[]) {
      const stack = new Error().stack ?? "";
      if (
        this.length === 0 &&
        stack.includes("cloneStructured")
      ) {
        throw new Error("managed Array iterator");
      }
      return apply(originalIterator, this, []) as Iterator<unknown>;
    },
  });
  try {
    if (typeof Deno !== "undefined") {
      const cloneStructuredControl = (value: unknown): unknown => structuredClone(value);
      assertThrows(
        () => cloneStructuredControl({ messages: [] }),
        Error,
        "managed Array iterator",
      );
    }
    const runtime = await proxy(channels);
    await runtime.doGenerate({ prompt });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: originalIterator,
    });
    await channels.close();
  }

  assertEquals(events.length, 1);
  assert(isPrivateConversationRunEvent(events[0]));
  assertEquals(events[0]?.messages, expectedPrompt);
  assertEquals(dispatched, true);
}

async function verifyHostedProjectionArrayTraversalIsolation(): Promise<void> {
  const events: AgentRunModelCallContextEvent[] = [];
  const options: ModelRuntimeCallOptions = {
    prompt: [{
      role: "user",
      content: [{ type: "text", text: "Synthetic prompt" }],
    }],
    tools: [{
      type: "function",
      name: "lookup",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    }],
  };
  let dispatched: ModelRuntimeCallOptions | undefined;
  const channels = pair(createHostedExecutorModelBroker({
    grant: grant(),
    allowedModelIds,
    scope: scope(),
    resolveModelRuntime: () =>
      model((actual) => {
        dispatched = actual;
      }),
    runEventSink(event) {
      assertModelCallContextEvent(event);
      events.push(event);
    },
  }));
  const originalMap = Array.prototype.map;
  const originalIterator = Array.prototype[Symbol.iterator];
  const apply = Reflect.apply;
  const ownDataValue = (value: unknown, key: string): unknown => {
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    value: function (this: unknown[]) {
      if (ownDataValue(this[0], "name") === "lookup") {
        return { next: () => ({ done: true, value: undefined }) };
      }
      return apply(originalIterator, this, []) as Iterator<unknown>;
    },
  });
  Object.defineProperty(Array.prototype, "map", {
    configurable: true,
    value: function (this: unknown[], callback: unknown, thisArg?: unknown): unknown[] {
      if (ownDataValue(this[0], "role") === "user" || ownDataValue(this[0], "type") === "text") {
        return [];
      }
      return apply(originalMap, this, [callback, thisArg]) as unknown[];
    },
  });
  try {
    const runtime = await proxy(channels);
    await runtime.doGenerate(options);
  } finally {
    Array.prototype.map = originalMap;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: originalIterator,
    });
    await channels.close();
  }

  assertEquals(events.length, 1);
  assert(isPrivateConversationRunEvent(events[0]));
  assertEquals(events[0]?.messages, expectedPrompt);
  assertEquals(events[0]?.tools, options.tools);
  assert(dispatched);
  assertEquals(dispatched.prompt, options.prompt);
  assertEquals(dispatched.tools, options.tools);
}

describe("hosted executor model dispatch intrinsics", () => {
  it("keeps hosted model context complete when managed array intrinsics are replaced", async () => {
    await verifyStructuredCloneDefaultTransferListIsolation();
    await verifyHostedProjectionArrayTraversalIsolation();
  });
});
