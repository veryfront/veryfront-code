import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type {
  AgentRunEventSink,
  AgentRunModelCallContextEvent,
} from "#veryfront/runtime/model-call-context.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import {
  getCurrentVeryfrontCloudModelCallCapture,
  runWithVeryfrontCloudModelCallCapture,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { isPrivateConversationRunEvent } from "../conversation/private-run-event.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import type { ExecutorBinding } from "../executor/protocol.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
  type ExecutorModelDispatch,
} from "./executor-model-bridge.ts";
import { createHostedExecutorModelBroker as createHostedBroker } from "./executor-model-dispatch.ts";

function receiptFor(modelCallId: string | undefined) {
  if (!modelCallId) throw new TypeError("Expected broker-owned logical call identity");
  return {
    eventId: "9007199254740993",
    projectId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    modelCallId,
  };
}

/** Existing capture scenarios use a fixture writer that acknowledges the exact submitted call. */
function createHostedExecutorModelBroker(
  input: Omit<Parameters<typeof createHostedBroker>[0], "projectId">,
) {
  const sink = input.runEventSink;
  if (!sink) {
    return createHostedBroker({ ...input, projectId: "11111111-1111-4111-8111-111111111111" });
  }
  return createHostedBroker({
    ...input,
    projectId: "11111111-1111-4111-8111-111111111111",
    runEventSink: async (event) => {
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
  options: { maxConcurrentCalls?: number; brokerCancellationTimeoutMs?: number } = {},
) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const caller = createExecutorChannel({
    binding: actualBinding,
    maxConcurrentCalls: options.maxConcurrentCalls,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding: actualBinding,
    maxConcurrentCalls: options.maxConcurrentCalls,
    cancellationTimeoutMs: options.brokerCancellationTimeoutMs,
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

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("hosted executor model dispatch", () => {
  it("refuses missing, mismatched, and malformed capture receipts before provider dispatch", async () => {
    for (
      const sink of [
        () => undefined,
        (event: AgentRunModelCallContextEvent) => ({
          ...receiptFor(event.modelCallId),
          modelCallId: "44444444-4444-4444-8444-444444444444",
        }),
        (event: AgentRunModelCallContextEvent) => ({
          ...receiptFor(event.modelCallId),
          eventId: "",
        }),
        (event: AgentRunModelCallContextEvent) => ({
          ...receiptFor(event.modelCallId),
          projectId: "55555555-5555-4555-8555-555555555555",
        }),
      ]
    ) {
      let dispatches = 0;
      const channels = pair(createHostedBroker({
        projectId: "11111111-1111-4111-8111-111111111111",
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        resolveModelRuntime: () => model(() => dispatches++),
        runEventSink: sink,
      }));
      try {
        const runtime = await proxy(channels);
        await assertRejects(async () => await runtime.doGenerate({ prompt }));
        await assertRejects(async () => await runtime.doStream({ prompt }));
        assertEquals(dispatches, 0);
      } finally {
        await channels.close();
      }
    }
  });

  it("preserves projectless legacy capture without inheriting a project receipt", async () => {
    let captures = 0;
    let dispatches = 0;
    const channels = pair(createHostedBroker({
      projectId: null,
      grant: grant(),
      allowedModelIds,
      scope: scope(),
      resolveModelRuntime: () =>
        model(() => {
          dispatches++;
          assertEquals(getCurrentVeryfrontCloudModelCallCapture(), undefined);
        }),
      runEventSink: (event) => {
        captures++;
        assertEquals(event.modelCallId, undefined);
      },
    }));
    try {
      const runtime = await proxy(channels);
      await runWithVeryfrontCloudModelCallCapture({
        receipt: receiptFor("33333333-3333-4333-8333-333333333333"),
        assertActive() {},
      }, async () => {
        await runtime.doGenerate({ prompt });
        const reader = (await runtime.doStream({ prompt })).stream.getReader();
        while (!(await reader.read()).done) { /* Consume the bounded legacy stream. */ }
      });
      assertEquals(captures, 2);
      assertEquals(dispatches, 2);
    } finally {
      await channels.close();
    }
  });

  it("accepts case-equivalent capture and project UUIDs while preserving opaque occurrence spelling", async () => {
    const projectId = "abcdef12-abcd-4abc-8def-abcdef123456";
    const capturedIds: string[] = [];
    let dispatches = 0;
    const channels = pair(createHostedBroker({
      projectId,
      grant: grant(),
      allowedModelIds,
      scope: scope(),
      runEventSink(event) {
        const receipt = receiptFor(event.modelCallId);
        capturedIds.push(receipt.modelCallId);
        return {
          ...receipt,
          eventId: "Opaque-Capture-9007199254740993",
          projectId: projectId.toUpperCase(),
          modelCallId: receipt.modelCallId.toUpperCase(),
        };
      },
      resolveModelRuntime: () =>
        model(() => {
          const capture = getCurrentVeryfrontCloudModelCallCapture();
          assert(capture);
          assertEquals(capture.eventId, "Opaque-Capture-9007199254740993");
          assertEquals(capture.projectId, projectId.toUpperCase());
          assertEquals(capture.modelCallId, capturedIds.at(-1)?.toUpperCase());
          dispatches++;
        }),
    }));
    try {
      const runtime = await proxy(channels);
      await runtime.doGenerate({ prompt });
      const reader = (await runtime.doStream({ prompt })).stream.getReader();
      while (!(await reader.read()).done) { /* Consume the acknowledged stream. */ }
      assertEquals(dispatches, 2);
    } finally {
      await channels.close();
    }
  });

  it("persists the validated request projection before dispatch and isolates sink mutation", async () => {
    const entered = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    const events: AgentRunModelCallContextEvent[] = [];
    const order: string[] = [];
    const options: ModelRuntimeCallOptions = {
      prompt: [{
        role: "system",
        content: "Synthetic system",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" }, extra: "excluded" },
        },
      }, ...prompt],
      tools: [{
        type: "function",
        name: "lookup",
        inputSchema: { type: "object", properties: { url: { type: "string" } } },
      }],
      maxOutputTokens: 17,
      temperature: 0.4,
      topP: 0.9,
      topK: 2,
      stopSequences: ["STOP"],
      seed: 2,
      presencePenalty: 0.3,
      frequencyPenalty: 0.1,
      reasoning: { enabled: false },
      providerOptions: { openai: { service_tier: "auto" } },
      responseFormat: { type: "json" },
    };
    let dispatched: ModelRuntimeCallOptions | undefined;
    const channels = pair(createHostedExecutorModelBroker({
      grant: grant(),
      allowedModelIds,
      scope: scope(),
      resolveModelRuntime: () =>
        model((actual) => {
          order.push("dispatch");
          dispatched = actual;
        }),
      runEventSink: async (event) => {
        order.push("persist");
        events.push(structuredClone(event));
        entered.resolve();
        await persisted.promise;
        event.messages.length = 0;
        order.push("ack");
      },
    }));
    try {
      const runtime = await proxy(channels);
      await runtime.prepare?.();
      assertEquals(events.length, 0);
      const pending = runtime.doGenerate(options);
      await entered.promise;
      assertEquals(dispatched, undefined);
      assertEquals(order, ["persist"]);
      assert(isPrivateConversationRunEvent(events[0]));
      assertEquals<unknown>(events[0], {
        type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
        modelCallId: events[0]?.modelCallId,
        model: { id: "synthetic-model", modelProvider: "openai" },
        messages: [{
          role: "system",
          content: "Synthetic system",
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } } },
        }, ...prompt],
        tools: options.tools,
        request: {
          maxOutputTokens: 17,
          temperature: 0.4,
          topP: 0.9,
          stopSequences: ["STOP"],
          seed: 2,
          presencePenalty: 0.3,
          frequencyPenalty: 0.1,
          reasoning: { enabled: false },
        },
      });
      persisted.resolve();
      await pending;
      assertEquals(order, ["persist", "ack", "dispatch"]);
      assert(dispatched);
      const { abortSignal: _signal, ...actual } = dispatched;
      assertEquals(actual, options);
    } finally {
      persisted.resolve();
      await channels.close();
    }
  });

  it("persists effective Anthropic reasoning precedence without raw provider options", async () => {
    const cases = [
      {
        reasoning: { enabled: false },
        providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        expected: { enabled: true, budgetTokens: 2048 },
        expectedMaxOutputTokens: 2048,
      },
      {
        reasoning: { enabled: false },
        providerOptions: {
          anthropic: { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
        },
        expected: { enabled: true, effort: "high" },
        expectedMaxOutputTokens: 4096,
      },
      {
        reasoning: { enabled: true, budgetTokens: 1024 },
        providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        expected: { enabled: true, budgetTokens: 1024 },
        expectedMaxOutputTokens: 3072,
      },
    ] as const;
    for (const mode of ["generate", "stream"] as const) {
      for (const testCase of cases) {
        let event: AgentRunModelCallContextEvent | undefined;
        const options = {
          prompt,
          reasoning: testCase.reasoning,
          providerOptions: testCase.providerOptions,
        };
        const channels = pair(createHostedExecutorModelBroker({
          grant: grant(),
          allowedModelIds,
          scope: scope(),
          runEventSink: (value) => {
            event = value;
          },
          resolveModelRuntime: () => ({
            ...model((actual) => {
              assertEquals(actual.reasoning, testCase.reasoning);
              assertEquals(actual.providerOptions, testCase.providerOptions);
              assertEquals(event?.request?.reasoning, testCase.expected);
            }),
            modelProvider: "anthropic",
            modelId: "claude-synthetic",
          }),
        }));
        try {
          const runtime = await proxy(channels);
          if (mode === "generate") await runtime.doGenerate(options);
          else {
            const { stream } = await runtime.doStream(options);
            const reader = stream.getReader();
            while (!(await reader.read()).done) { /* Consume the provider stream. */ }
          }
          assertEquals(event?.model, { id: "claude-synthetic", modelProvider: "anthropic" });
          assertEquals(event?.request, {
            maxOutputTokens: testCase.expectedMaxOutputTokens,
            reasoning: testCase.expected,
          });
          assert(event && !("providerOptions" in event));
        } finally {
          await channels.close();
        }
      }
    }
  });

  it("rejects gateway thinking overrides before capture or dispatch", async () => {
    let events = 0;
    let dispatches = 0;
    const channels = pair(createHostedExecutorModelBroker({
      // Leave budget available so this case reaches the provider-override gate.
      grant: {
        ...grant(),
        models: new Map([[modelId, { maxOutputTokens: 8192, providerTools: [] }]]),
      },
      allowedModelIds,
      scope: scope(),
      runEventSink: () => {
        events++;
      },
      resolveModelRuntime: () => ({ ...model(() => dispatches++), modelProvider: "anthropic" }),
    }));
    try {
      const runtime = await proxy(channels);
      await assertRejects(
        async () =>
          await runtime.doGenerate({
            prompt,
            reasoning: { enabled: false },
            providerOptions: {
              anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } },
              "veryfront-cloud": { thinking: { type: "enabled", budget_tokens: 4096 } },
            },
          }),
        Error,
        "operation-failed",
      );
      assertEquals(events, 0);
      assertEquals(dispatches, 0);
    } finally {
      await channels.close();
    }
  });

  it("persists OpenAI default and normalized explicit reasoning from resolved metadata", async () => {
    for (
      const [reasoning, expected] of [
        [undefined, { enabled: true, effort: "medium" }],
        [{ enabled: true, effort: "max" }, { enabled: true, effort: "high" }],
      ] as const
    ) {
      let event: AgentRunModelCallContextEvent | undefined;
      const channels = pair(createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        runEventSink: (value) => {
          event = value;
        },
        resolveModelRuntime: () => ({
          ...model((actual) => {
            assertEquals(actual.reasoning, reasoning);
            assertEquals(event?.request?.reasoning, expected);
          }),
          modelId: "o3",
        }),
      }));
      try {
        const runtime = await proxy(channels);
        await runtime.doGenerate({ prompt, ...(reasoning ? { reasoning } : {}) });
        assertEquals(event?.model, { id: "o3", modelProvider: "openai" });
        assertEquals(event?.request, { maxOutputTokens: 4096, reasoning: expected });
      } finally {
        await channels.close();
      }
    }
  });

  it("rejects provider bucket overrides of persisted request fields before capture", async () => {
    let events = 0;
    let dispatches = 0;
    const channels = pair(
      createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        runEventSink: () => {
          events++;
        },
        resolveModelRuntime: () => model(() => dispatches++),
      }),
    );
    try {
      const runtime = await proxy(channels);
      for (
        const bucket of ["anthropic", "google", "openai", "openai-compatible", "veryfront-cloud"]
      ) {
        for (
          const [field, value] of Object.entries({
            messages: [],
            system: "Other system",
            contents: [],
            systemInstruction: { parts: [] },
            input: [],
            instructions: "Other instructions",
            tools: [],
            functions: [],
            max_tokens: 99,
            max_completion_tokens: 99,
            max_output_tokens: 99,
            temperature: 1,
            top_p: 1,
            top_k: 9,
            stop: ["OTHER"],
            stop_sequences: ["OTHER"],
            seed: 9,
            presence_penalty: 1,
            frequency_penalty: 1,
            reasoning_effort: "high",
            reasoning: { effort: "high" },
            cachedContent: "other-context",
            previous_response_id: "other-response",
            conversation: "other-conversation",
            stream: true,
          })
        ) {
          await assertRejects(
            async () =>
              await runtime.doGenerate({
                prompt,
                providerOptions: { [bucket]: { [field]: value } },
              }),
            Error,
            "operation-failed",
          );
        }
      }
      assertEquals(events, 0);
      assertEquals(dispatches, 0);
    } finally {
      await channels.close();
    }
  });

  it("permits schema properties but rejects generationConfig changes to captured controls", async () => {
    const responseSchema = {
      type: "OBJECT",
      properties: {
        messages: { type: "STRING" },
        auth: { type: "STRING" },
        temperature: { type: "NUMBER" },
      },
    };
    let events = 0;
    let dispatches = 0;
    const channels = pair(
      createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        runEventSink: () => {
          events++;
        },
        resolveModelRuntime: () => ({ ...model(() => dispatches++), modelProvider: "google" }),
      }),
    );
    try {
      const runtime = await proxy(channels);
      for (const bucket of ["google", "veryfront-cloud"]) {
        await runtime.doGenerate({
          prompt,
          providerOptions: {
            [bucket]: { generationConfig: { maxOutputTokens: 4096, responseSchema } },
          },
        });
        await runtime.doGenerate({
          prompt,
          maxOutputTokens: 12,
          temperature: 0.4,
          providerOptions: {
            [bucket]: {
              generationConfig: { maxOutputTokens: 12, temperature: 0.4, responseSchema },
            },
          },
        });
        for (
          const generationConfig of [{ responseSchema }, { maxOutputTokens: 13 }, {
            maxOutputTokens: 12,
            temperature: 1,
          }, { maxOutputTokens: 12, thinkingConfig: { thinkingBudget: 4096 } }]
        ) {
          await assertRejects(
            async () =>
              await runtime.doGenerate({
                prompt,
                maxOutputTokens: 12,
                temperature: 0.4,
                providerOptions: { [bucket]: { generationConfig } },
              }),
            Error,
            "operation-failed",
          );
        }
      }
      assertEquals(events, 4);
      assertEquals(dispatches, 4);
    } finally {
      await channels.close();
    }
  });

  it("requires an explicit sink and rejects failed persistence before generate or stream", async () => {
    assertThrows(() =>
      createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        resolveModelRuntime: () => model(() => {}),
        runEventSink: undefined,
      })
    );
    let dispatches = 0;
    const channels = pair(
      createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        resolveModelRuntime: () => model(() => dispatches++),
        runEventSink: () => {
          throw new Error("Synthetic persistence failure");
        },
      }),
    );
    try {
      const runtime = await proxy(channels);
      await assertRejects(
        async () => await runtime.doGenerate({ prompt }),
        Error,
        "operation-failed",
      );
      await assertRejects(
        async () => await runtime.doStream({ prompt }),
        Error,
        "operation-failed",
      );
      assertEquals(dispatches, 0);
    } finally {
      await channels.close();
    }
  });

  it("rechecks call abort and owner lifetime after persistence acknowledges", async () => {
    for (const cancelBy of ["call", "scope", "active"] as const) {
      const entered = Promise.withResolvers<void>();
      const persisted = Promise.withResolvers<void>();
      const lifetime = new AbortController();
      const call = new AbortController();
      let active = true;
      let dispatches = 0;
      const channels = pair(createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: {
          binding,
          signal: lifetime.signal,
          assertActive() {
            if (!active) throw new Error("Synthetic expired lifetime");
          },
        },
        resolveModelRuntime: () => model(() => dispatches++),
        runEventSink: async () => {
          entered.resolve();
          await persisted.promise;
        },
      }));
      try {
        const runtime = await proxy(channels);
        const pending = Promise.resolve(runtime.doGenerate({ prompt, abortSignal: call.signal }));
        const rejected = assertRejects(() => pending);
        await entered.promise;
        if (cancelBy === "call") call.abort();
        else if (cancelBy === "scope") lifetime.abort();
        else active = false;
        persisted.resolve();
        await rejected;
        assertEquals(dispatches, 0);
      } finally {
        persisted.resolve();
        await channels.close();
      }
    }
  });

  it("retains admission for a cancelled call until its original persistence settles", async () => {
    const entered = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    let dispatches = 0;
    const channels = pair(
      createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        resolveModelRuntime: () => model(() => dispatches++),
        runEventSink: async () => {
          entered.resolve();
          await persisted.promise;
        },
      }),
      binding,
      { maxConcurrentCalls: 1 },
    );
    let returning: Promise<unknown> | undefined;
    try {
      const abort = new AbortController();
      const iterator = channels.caller.stream(
        "model.stream",
        { modelId, options: { prompt: [] } },
        { signal: abort.signal },
      );
      const read = iterator.next();
      const cancelled = assertRejects(() => read, Error, "cancelled");
      await entered.promise;
      abort.abort();
      await cancelled;
      let released = false;
      returning = iterator.return!().then(() => {
        released = true;
      });
      await tick();
      assertEquals(released, false);
      await assertRejects(
        () => channels.caller.request("model.metadata", {}),
        Error,
        "concurrent call limit",
      );
      persisted.resolve();
      await returning;
      await channels.caller.request("model.metadata", {});
      assertEquals(dispatches, 0);
    } finally {
      persisted.resolve();
      await returning?.catch(() => {});
      await channels.close();
    }
  });

  it("fences a cancelled handler while its sink remains pending past the cleanup deadline", async () => {
    const entered = Promise.withResolvers<void>();
    const cancellationReceived = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    let cancellationReceiptWatchdog: ReturnType<typeof setTimeout> | undefined;
    let cancellationDeadlineWatchdog: ReturnType<typeof setTimeout> | undefined;
    let callerCloseWatchdog: ReturnType<typeof setTimeout> | undefined;
    let dispatches = 0;
    const operations = createHostedExecutorModelBroker({
      grant: grant(),
      allowedModelIds,
      scope: scope(),
      resolveModelRuntime: () => model(() => dispatches++),
      runEventSink: async () => {
        entered.resolve();
        await persisted.promise;
      },
    });
    const streamOperation = operations.get("model.stream");
    assert(streamOperation?.mode === "stream");
    const observedOperations = new Map(operations);
    observedOperations.set("model.stream", {
      mode: "stream",
      handle(value, context) {
        context.signal.addEventListener("abort", () => cancellationReceived.resolve(), {
          once: true,
        });
        return streamOperation.handle(value, context);
      },
    });
    const channels = pair(
      observedOperations,
      binding,
      { maxConcurrentCalls: 1, brokerCancellationTimeoutMs: 20 },
    );
    let returning: Promise<unknown> | undefined;
    try {
      const abort = new AbortController();
      const iterator = channels.caller.stream(
        "model.stream",
        { modelId, options: { prompt: [] } },
        { signal: abort.signal },
      );
      const read = iterator.next();
      const cancelled = assertRejects(() => read, Error, "cancelled");
      await entered.promise;
      abort.abort();
      await cancelled;
      returning = iterator.return!();
      void returning.catch(() => {});
      await Promise.race([
        cancellationReceived.promise,
        new Promise<never>((_, reject) => {
          cancellationReceiptWatchdog = setTimeout(
            () => reject(new Error("broker cancellation was not received within the test bound")),
            5_000,
          );
        }),
      ]);
      clearTimeout(cancellationReceiptWatchdog);
      const closeError = await Promise.race([
        channels.broker.closed,
        new Promise<never>((_, reject) => {
          cancellationDeadlineWatchdog = setTimeout(
            () => reject(new Error("broker cancellation deadline exceeded the test bound")),
            250,
          );
        }),
      ]);
      assertEquals(channels.broker.signal.aborted, true);
      assertEquals(
        closeError.message,
        "Executor handler cancellation deadline exceeded",
      );
      await Promise.race([
        channels.caller.closed,
        new Promise<never>((_, reject) => {
          callerCloseWatchdog = setTimeout(
            () => reject(new Error("caller did not observe broker closure within the test bound")),
            5_000,
          );
        }),
      ]);
      clearTimeout(callerCloseWatchdog);
      await assertRejects(
        () => channels.caller.request("model.metadata", {}),
        Error,
        "Executor channel closed",
      );
      await assertRejects(async () => await returning);
      assertEquals(dispatches, 0);
    } finally {
      clearTimeout(cancellationReceiptWatchdog);
      clearTimeout(cancellationDeadlineWatchdog);
      clearTimeout(callerCloseWatchdog);
      persisted.resolve();
      await returning?.catch(() => {});
      await channels.close();
    }
  });

  it("waits for persistence before opening a provider stream", async () => {
    const entered = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    const order: string[] = [];
    const channels = pair(createHostedExecutorModelBroker({
      grant: grant(),
      allowedModelIds,
      scope: scope(),
      resolveModelRuntime: () => model((_options, mode) => order.push(mode)),
      runEventSink: async () => {
        order.push("persist");
        entered.resolve();
        await persisted.promise;
        order.push("ack");
      },
    }));
    try {
      const runtime = await proxy(channels);
      const pending = runtime.doStream({ prompt });
      await entered.promise;
      assertEquals(order, ["persist"]);
      persisted.resolve();
      const { stream } = await pending;
      const reader = stream.getReader();
      assertEquals((await reader.read()).value, { type: "text-delta", delta: "Synthetic answer" });
      assertEquals((await reader.read()).done, true);
      assertEquals(order, ["persist", "ack", "stream"]);
    } finally {
      persisted.resolve();
      await channels.close();
    }
  });

  it("rejects executor event substitution and assistant content outside the durable contract", async () => {
    let events = 0;
    let dispatches = 0;
    const channels = pair(
      createHostedExecutorModelBroker({
        grant: grant(),
        allowedModelIds,
        scope: scope(),
        resolveModelRuntime: () => model(() => dispatches++),
        runEventSink: () => {
          events++;
        },
      }),
    );
    try {
      const runtime = await proxy(channels);
      for (
        const content of [
          [{ type: "reasoning" as const, text: "Synthetic reasoning" }],
          [{
            type: "tool-result" as const,
            toolCallId: "synthetic-call",
            toolName: "lookup",
            result: {},
            providerExecuted: true as const,
          }],
        ]
      ) {
        await assertRejects(async () =>
          await runtime.doGenerate({ prompt: [{ role: "assistant", content }] })
        );
      }
      await assertRejects(() =>
        channels.caller.request("model.generate", {
          modelId,
          options: { prompt: [] },
          event: { type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED", messages: [] },
          runId: "other-run",
        })
      );
      assertEquals(events, 0);
      assertEquals(dispatches, 0);
    } finally {
      await channels.close();
    }
  });

  it("checks binding and owner lifetime before metadata and preparation", async () => {
    let resolutions = 0;
    let preparations = 0;
    let active = true;
    const operations = createHostedExecutorModelBroker({
      grant: grant(),
      allowedModelIds,
      scope: {
        ...scope(),
        assertActive() {
          if (!active) throw new Error("Synthetic revoked lifetime");
        },
      },
      resolveModelRuntime: () => {
        resolutions++;
        return {
          ...model(() => {}),
          prepare: () => {
            preparations++;
            return Promise.resolve();
          },
        };
      },
      runEventSink: () => {},
    });
    const wrong = pair(operations, { ...binding, invocationId: "other-invocation" });
    try {
      await assertRejects(() => proxy(wrong));
      assertEquals(resolutions, 0);
    } finally {
      await wrong.close();
    }
    const channels = pair(operations);
    try {
      const runtime = await proxy(channels);
      active = false;
      await assertRejects(async () => await runtime.prepare?.());
      await assertRejects(() => channels.caller.request("model.metadata", {}));
      assertEquals(resolutions, 1);
      assertEquals(preparations, 0);
    } finally {
      await channels.close();
    }
  });

  it("keeps concurrent invocation sinks isolated from ambient event scope", async () => {
    const seen: string[] = [];
    let ambient = 0;
    const channels = ["one", "two"].map((name) => {
      const invocation = { ...binding, invocationId: name };
      const sink: AgentRunEventSink = async (event) => {
        await tick();
        seen.push(`${name}:${event.messages[0]?.content}`);
      };
      return pair(
        createHostedExecutorModelBroker({
          grant: grant(),
          allowedModelIds,
          scope: scope(undefined, invocation),
          runEventSink: sink,
          resolveModelRuntime: () => model(() => seen.push(`${name}:dispatch`)),
        }),
        invocation,
      );
    });
    try {
      const runtimes = await Promise.all(channels.map(proxy));
      await runWithMandatoryRunEventSink(() => {
        ambient++;
      }, async () => {
        await Promise.all(
          runtimes.map((runtime, index) =>
            runtime.doGenerate({ prompt: [{ role: "system", content: `input-${index}` }] })
          ),
        );
      });
      assertEquals(ambient, 0);
      assertEquals(seen.filter((item) => item.startsWith("one:")), ["one:input-0", "one:dispatch"]);
      assertEquals(seen.filter((item) => item.startsWith("two:")), ["two:input-1", "two:dispatch"]);
    } finally {
      await Promise.all(channels.map((channel) => channel.close()));
    }
  });

  it("enters the acknowledged permit scope only around provider invocation", async () => {
    const modes: string[] = [];
    let entered = false;
    const channels = pair(createExecutorModelBroker({
      allowedModelIds,
      resolveModelRuntime: () =>
        model((_options, mode) => {
          assert(entered);
          modes.push(mode);
        }),
      beforeModelDispatch: () => ({
        assertActive() {
          assertEquals(entered, false);
        },
        run(operation) {
          entered = true;
          try {
            return operation();
          } finally {
            entered = false;
          }
        },
      }),
    }));
    try {
      const runtime = await proxy(channels);
      await runtime.doGenerate({ prompt });
      const reader = (await runtime.doStream({ prompt })).stream.getReader();
      while (!(await reader.read()).done) { /* Consume the bounded stream. */ }
      assertEquals(modes, ["generate", "stream"]);
      assertEquals(entered, false);
    } finally {
      await channels.close();
    }
  });

  it("owns distinct logical identities while concurrent dispatch gates remain pending", async () => {
    const ready = Promise.withResolvers<void>();
    const acknowledgement = Promise.withResolvers<void>();
    const ids: string[] = [];
    let dispatches = 0;
    const channels = pair(createExecutorModelBroker({
      allowedModelIds,
      resolveModelRuntime: () => model(() => dispatches++),
      beforeModelDispatch: async (request) => {
        ids.push(request.identity.modelCallId);
        if (ids.length === 2) ready.resolve();
        await acknowledgement.promise;
      },
    }));
    try {
      const runtime = await proxy(channels);
      const pending = Promise.all([
        runtime.doGenerate({ prompt }),
        runtime.doGenerate({ prompt }),
      ]);
      await ready.promise;
      assertEquals(new Set(ids).size, 2);
      assertEquals(dispatches, 0);
      acknowledgement.resolve();
      await pending;
      assertEquals(dispatches, 2);
    } finally {
      acknowledgement.resolve();
      await channels.close();
    }
  });

  it("gives the generic gate a canonical host sequence and an independent request snapshot", async () => {
    const calls: ExecutorModelDispatch[] = [];
    let dispatches = 0;
    const channels = pair(createExecutorModelBroker({
      allowedModelIds,
      resolveModelRuntime: () =>
        model((options) => {
          dispatches++;
          assertEquals(options.prompt, prompt);
        }),
      beforeModelDispatch: (request) => {
        calls.push(request);
        (request.options.prompt as unknown[]).length = 0;
      },
    }));
    try {
      const runtime = await proxy(channels);
      await runtime.doGenerate({ prompt });
      const { stream } = await runtime.doStream({ prompt });
      const reader = stream.getReader();
      while (!(await reader.read()).done) { /* Consume the bounded stream. */ }
      assertEquals(
        calls.map((call) => [call.identity.binding, call.identity.sequence, call.mode]),
        [[binding, 1, "generate"], [binding, 2, "stream"]],
      );
      const logicalIds = calls.map((call) => call.identity.modelCallId);
      assertEquals(new Set(logicalIds).size, 2);
      for (const id of logicalIds) {
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));
      }
      assertEquals(dispatches, 2);
    } finally {
      await channels.close();
    }
  });
});
