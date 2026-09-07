import "#veryfront/schemas/_test-setup.ts";
import { createAnthropicProviderModel } from "@veryfront/ext-llm-anthropic";
import { createGoogleProviderModel } from "@veryfront/ext-llm-google";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import { EXECUTOR_STREAM_WINDOW } from "../executor/protocol.ts";
import {
  createModelRuntimeResolverAbortScope,
  resolveAgentModelTransport,
  revokeModelRuntimeResolver,
} from "../runtime/model-transport.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "./executor-model-bridge.ts";

const modelId = "veryfront-cloud/openai/synthetic-model";
const allowedModelIds = new Set([modelId]);
const prompt: ModelRuntimeCallOptions["prompt"] = [{
  role: "user",
  content: [{ type: "text", text: "Synthetic prompt" }],
}];

function stubModel(
  overrides: Partial<ModelRuntime<ModelRuntimeCallOptions>> = {},
): ModelRuntime<ModelRuntimeCallOptions> {
  return {
    specificationVersion: "v2",
    provider: "veryfront-cloud",
    modelId: "synthetic-model",
    modelProvider: "openai",
    executionMode: "remote",
    _generateViaStream: true,
    runtimeCapabilities: { toolCalling: true, structuredOutput: ["json_schema"] },
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: "Synthetic answer" }],
        finishReason: "stop",
        usage: { inputTokens: 2, outputTokens: 3 },
      }),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", delta: "Synthetic answer" });
            controller.close();
          },
        }),
      }),
    ...overrides,
  };
}

function pair(
  operations: ReadonlyMap<string, ExecutorOperation>,
  options: { maxConcurrentCalls?: number; brokerCancellationTimeoutMs?: number } = {},
) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const binding = {
    allocationId: "allocation-test",
    generation: 1,
    invocationId: "invocation-test",
  };
  const caller = createExecutorChannel({
    binding,
    maxConcurrentCalls: options.maxConcurrentCalls,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
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

async function connected(model = stubModel(), options: Parameters<typeof pair>[1] = {}) {
  const channels = pair(
    createExecutorModelBroker({
      allowedModelIds,
      resolveModelRuntime: (id) => id === modelId ? model : undefined,
    }),
    options,
  );
  const resolver = await createExecutorModelRuntimeResolver({
    channel: channels.caller,
    allowedModelIds,
  });
  const proxy = resolver(modelId)!;
  return { ...channels, resolver, proxy };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("executor managed model bridge", () => {
  it("preserves metadata, readiness, neutral generation options, and data results", async () => {
    let received: ModelRuntimeCallOptions | undefined;
    let prepared = 0;
    const model = stubModel({
      prepare: (signal) => {
        assert(signal instanceof AbortSignal);
        prepared++;
        return Promise.resolve();
      },
      doGenerate: (options) => {
        received = options;
        return stubModel().doGenerate(options);
      },
    });
    const channels = await connected(model);
    try {
      const options: ModelRuntimeCallOptions = {
        prompt: [
          {
            role: "system",
            content: "Synthetic system",
            providerOptions: { openai: { cache: true } },
          },
          ...prompt,
          {
            role: "user",
            content: [{
              type: "image",
              mediaType: "image/png",
              url: "https://example.com/image.png",
            }, {
              type: "file",
              mediaType: "text/plain",
              url: "https://example.com/file.txt",
              filename: "file.txt",
            }],
          },
          {
            role: "assistant",
            content: [{
              type: "reasoning",
              text: "Synthetic reasoning",
              signature: "synthetic",
              redactedData: "synthetic",
            }, {
              type: "tool-call",
              toolCallId: "call-test",
              toolName: "lookup",
              input: {},
              providerExecuted: true,
              dynamic: true,
              supportsDeferredResults: true,
            }, {
              type: "tool-result",
              toolCallId: "call-test",
              toolName: "lookup",
              result: { ok: true },
              providerExecuted: true,
              isError: false,
            }],
            providerToolCalls: [{
              toolCallId: "call-test",
              toolName: "lookup",
              input: {},
              supportsDeferredResults: true,
            }],
            providerMetadata: { openai: { itemId: "synthetic" } },
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "call-test",
              toolName: "lookup",
              output: { type: "json", value: { ok: true } },
            }],
          },
        ],
        maxOutputTokens: 100,
        temperature: 0.5,
        topP: 0.9,
        topK: 5,
        stopSequences: ["STOP"],
        tools: [{
          type: "function",
          name: "lookup",
          description: "Synthetic tool",
          inputSchema: { type: "object" },
        }, {
          type: "provider",
          name: "search",
          id: "openai.web_search",
          args: { searchContextSize: "low" },
        }],
        toolChoice: { type: "tool", toolName: "lookup" },
        seed: 1,
        presencePenalty: 0.5,
        frequencyPenalty: 0.5,
        providerOptions: { openai: { serviceTier: "auto" } },
        reasoning: { enabled: true, effort: "high", budgetTokens: 20 },
        includeRawChunks: false,
        userId: "synthetic-user",
        responseFormat: {
          type: "json_schema",
          name: "answer",
          schema: { type: "object" },
          description: "Synthetic schema",
          strict: true,
        },
        abortSignal: new AbortController().signal,
      };
      for (
        const key of [
          "specificationVersion",
          "provider",
          "modelId",
          "modelProvider",
          "executionMode",
          "runtimeCapabilities",
          "_generateViaStream",
        ] as const
      ) assertEquals(channels.proxy[key], model[key]);
      await channels.proxy.prepare?.();
      assertEquals(prepared, 1);
      assertEquals(await channels.proxy.doGenerate(options), await stubModel().doGenerate(options));
      const { abortSignal: originalSignal, ...expected } = options;
      assert(received?.abortSignal instanceof AbortSignal);
      assert(received.abortSignal !== originalSignal);
      const { abortSignal: _signal, ...actual } = received;
      assertEquals(actual, expected);
    } finally {
      await channels.close();
    }
  });

  it("uses the synchronous runtime resolver and prevents unknown managed model fallback", async () => {
    const channels = await connected();
    let projectCalls = 0;
    try {
      const input = {
        agentId: "synthetic-agent",
        config: {
          system: "Synthetic system",
          model: modelId,
          resolveModelTransport: () => {
            projectCalls++;
            return Promise.resolve({ model: stubModel() });
          },
        },
        context: undefined,
        modelOverride: undefined,
        mode: "generate" as const,
        resolveModelRuntime: channels.resolver,
      };
      const resolved = await resolveAgentModelTransport(input);
      assertEquals(resolved.languageModel, channels.proxy);
      await assertRejects(
        () =>
          resolveAgentModelTransport({ ...input, modelOverride: "veryfront-cloud/openai/unknown" }),
        Error,
        "Managed model is not allowed",
      );
      assertEquals(projectCalls, 0);
      assertEquals(channels.resolver("project/custom"), undefined);
    } finally {
      await channels.close();
    }
  });

  it("revokes retained proxies before project abort listeners can make another call", async () => {
    let calls = 0;
    const channels = await connected(stubModel({
      prepare: () => {
        calls++;
        return Promise.resolve();
      },
      doGenerate: () => {
        calls++;
        return Promise.resolve({});
      },
      doStream: () => {
        calls++;
        return stubModel().doStream({ prompt });
      },
    }));
    try {
      const scope = createModelRuntimeResolverAbortScope(channels.resolver);
      let retainedCall: PromiseLike<unknown> | undefined;
      scope.signal.addEventListener("abort", () => {
        retainedCall = channels.proxy.doGenerate({ prompt });
      }, { once: true });
      scope.abort();
      await assertRejects(
        async () => await retainedCall,
        TypeError,
        "Managed model resolver is revoked",
      );
      await assertRejects(
        async () => await channels.proxy.prepare?.(),
        TypeError,
        "Managed model resolver is revoked",
      );
      await assertRejects(
        async () => await channels.proxy.doStream({ prompt }),
        TypeError,
        "Managed model resolver is revoked",
      );
      assertThrows(
        () => channels.resolver(modelId),
        TypeError,
        "Managed model resolver is revoked",
      );
      assertEquals(calls, 0);
      scope.dispose();
    } finally {
      await channels.close();
    }
  });

  it("resolver revocation cancels active generation and an idle stream", async () => {
    const started = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    const channels = await connected(stubModel({
      doGenerate: (options) => {
        signal = options.abortSignal;
        started.resolve();
        return new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(new Error("Synthetic private detail")), {
            once: true,
          })
        );
      },
    }));
    try {
      const pending = channels.proxy.doGenerate({ prompt });
      await started.promise;
      revokeModelRuntimeResolver(channels.resolver);
      await assertRejects(async () => await pending, Error, "cancelled");
      assertEquals(signal?.aborted, true);
    } finally {
      await channels.close();
    }
    let cancelled = false;
    const streaming = await connected(stubModel({
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }, { highWaterMark: 0 }),
        }),
    }));
    try {
      const { stream } = await streaming.proxy.doStream({ prompt });
      revokeModelRuntimeResolver(streaming.resolver);
      await assertRejects(() => stream.getReader().read(), Error, "cancelled");
      await tick();
      assertEquals(cancelled, true);
    } finally {
      await streaming.close();
    }
  });

  it("rejects unknown models and invalid options before broker resolution or generation", async () => {
    let resolutions = 0;
    let generations = 0;
    const channels = pair(createExecutorModelBroker({
      allowedModelIds,
      resolveModelRuntime: () => {
        resolutions++;
        return stubModel({
          doGenerate: () => {
            generations++;
            return Promise.resolve({});
          },
        });
      },
    }));
    try {
      for (
        const options of [
          { prompt, headers: { Authorization: "synthetic" } },
          { prompt, abortSignal: {} },
          { prompt, url: "https://example.com" },
          { prompt, reasoning: { effort: "invalid" } },
          { prompt: [{ role: "system", content: 1 }] },
          { prompt, tools: [{ type: "function", name: "bad", inputSchema: {}, execute: "code" }] },
          { prompt, providerOptions: { openai: { headers: { authorization: "synthetic" } } } },
          { prompt, providerOptions: { openai: { baseURL: "https://example.com" } } },
          { prompt, providerOptions: { anthropic: { model: "synthetic-other-model" } } },
          { prompt, providerOptions: { "veryfront-cloud": { model: "synthetic-other-model" } } },
          {
            prompt,
            providerOptions: { "openai-compatible": { model_id: "synthetic-other-model" } },
          },
          { prompt, providerOptions: { google: { deploymentName: "synthetic-other-model" } } },
          { prompt, responseFormat: { type: "json_schema", name: "missing-schema" } },
        ]
      ) {
        await assertRejects(
          () =>
            channels.caller.request("model.generate", { modelId, options } as unknown as JsonValue),
          Error,
          "operation-failed",
        );
      }
      await assertRejects(
        () =>
          channels.caller.request(
            "model.generate",
            {
              modelId: "veryfront-cloud/openai/unknown",
              options: { prompt },
            } as unknown as JsonValue,
          ),
        Error,
        "operation-failed",
      );
      assertEquals(resolutions, 0);
      assertEquals(generations, 0);
    } finally {
      await channels.close();
    }
  });

  it("keeps the allowed model pinned through the first-party Anthropic request builder", async () => {
    const allowedId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const allowedIds = new Set([allowedId]);
    const requestedModels: unknown[] = [];
    const mockFetch: typeof fetch = (_input, init) => {
      const { body } = observeFetchRequestInit(init);
      assert(typeof body === "string");
      requestedModels.push(JSON.parse(body).model);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Synthetic answer" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    await withMockFetch(mockFetch, async () => {
      const model = createAnthropicProviderModel("claude-haiku-4-5", {
        credential: "<TOKEN>",
        name: "veryfront-cloud",
        baseURL: "https://example.com/v1",
        fetch: mockFetch,
      });
      const channels = pair(
        createExecutorModelBroker({
          allowedModelIds: allowedIds,
          resolveModelRuntime: () => model,
        }),
      );
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: channels.caller,
          allowedModelIds: allowedIds,
        });
        const proxy = resolver(allowedId)!;
        const result = await proxy.doGenerate({
          prompt,
          maxOutputTokens: 10,
          providerOptions: { anthropic: { temperature: 0.2 } },
        });
        assertEquals(result.content, [{ type: "text", text: "Synthetic answer" }]);
        assertEquals(requestedModels, ["claude-haiku-4-5"]);
        for (const bucket of ["anthropic", "veryfront-cloud"]) {
          await assertRejects(
            () =>
              channels.caller.request("model.generate", {
                modelId: allowedId,
                options: { prompt, providerOptions: { [bucket]: { model: "claude-opus-4-6" } } },
              } as unknown as JsonValue),
            Error,
            "operation-failed",
          );
          await assertRejects(
            async () =>
              await proxy.doGenerate({
                prompt,
                providerOptions: { [bucket]: { model: "claude-opus-4-6" } },
              }),
            TypeError,
          );
        }
        assertEquals(requestedModels, ["claude-haiku-4-5"]);
      } finally {
        await channels.close();
      }
    });
  });

  it("preserves schema property names through the first-party Google request builder", async () => {
    const allowedId = "veryfront-cloud/google/gemini-synthetic";
    const allowedIds = new Set([allowedId]);
    const responseSchema = {
      type: "OBJECT",
      properties: {
        url: { type: "STRING" },
        auth: { type: "STRING" },
        model: { type: "STRING" },
        headers: { type: "STRING" },
      },
    };
    const schemas: unknown[] = [];
    const mockFetch: typeof fetch = (_input, init) => {
      const { body } = observeFetchRequestInit(init);
      assert(typeof body === "string");
      schemas.push(JSON.parse(body).generationConfig.responseSchema);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "Synthetic answer" }] },
              finishReason: "STOP",
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    await withMockFetch(mockFetch, async () => {
      const model = createGoogleProviderModel("gemini-synthetic", {
        credential: "<TOKEN>",
        name: "veryfront-cloud",
        baseURL: "https://example.com/v1",
        fetch: mockFetch,
      });
      const channels = pair(
        createExecutorModelBroker({
          allowedModelIds: allowedIds,
          resolveModelRuntime: () => model,
        }),
      );
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: channels.caller,
          allowedModelIds: allowedIds,
        });
        const proxy = resolver(allowedId)!;
        await proxy.doGenerate({
          prompt,
          providerOptions: {
            google: { generationConfig: { responseMimeType: "application/json", responseSchema } },
          },
        });
        assertEquals(schemas, [responseSchema]);
        for (const field of ["url", "auth", "model", "headers"]) {
          await assertRejects(
            () =>
              channels.caller.request("model.generate", {
                modelId: allowedId,
                options: { prompt, providerOptions: { google: { [field]: "synthetic-override" } } },
              } as unknown as JsonValue),
            Error,
            "operation-failed",
          );
        }
        assertEquals(schemas, [responseSchema]);
      } finally {
        await channels.close();
      }
    });
  });

  it("forbids proxy header overrides and accepts omitted optional values", async () => {
    const channels = await connected();
    try {
      await assertRejects(
        async () => await channels.proxy.doGenerate({ prompt, headers: new Headers() }),
        TypeError,
      );
      await channels.proxy.doGenerate({
        prompt,
        maxOutputTokens: undefined,
        reasoning: { enabled: true, effort: undefined },
      });
    } finally {
      await channels.close();
    }
  });

  it("fails closed without a resolver or a complete exact metadata list", async () => {
    assertThrows(
      () => createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: undefined }),
      TypeError,
    );
    const channels = pair(
      createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: () => undefined }),
    );
    try {
      await assertRejects(
        () => createExecutorModelRuntimeResolver({ channel: channels.caller, allowedModelIds }),
        Error,
        "operation-failed",
      );
    } finally {
      await channels.close();
    }
    for (
      const descriptors of [[], [{ id: modelId }, { id: modelId }], [{
        id: "veryfront-cloud/openai/extra",
      }]]
    ) {
      const malformed = pair(
        new Map([["model.metadata", { mode: "unary", handle: () => descriptors }]]),
      );
      try {
        await assertRejects(
          () => createExecutorModelRuntimeResolver({ channel: malformed.caller, allowedModelIds }),
          TypeError,
        );
      } finally {
        await malformed.close();
      }
    }
  });

  it("preserves stream warnings and chunks without reading past bounded credit", async () => {
    let pulls = 0;
    let cancelled = false;
    let signal: AbortSignal | undefined;
    const channels = await connected(stubModel({
      doStream: (options) => {
        signal = options.abortSignal;
        return Promise.resolve({
          warnings: [{ type: "other", message: "Synthetic warning" }],
          stream: new ReadableStream({
            pull(controller) {
              pulls++;
              controller.enqueue({ type: "text-delta", delta: String(pulls) });
            },
            cancel() {
              cancelled = true;
            },
          }, { highWaterMark: 0 }),
        });
      },
    }));
    try {
      const result = await channels.proxy.doStream({ prompt });
      assertEquals(result.warnings, [{ type: "other", message: "Synthetic warning" }]);
      await tick();
      assert(pulls <= EXECUTOR_STREAM_WINDOW);
      const reader = result.stream.getReader();
      assertEquals((await reader.read()).value, { type: "text-delta", delta: "1" });
      await reader.cancel();
      assertEquals(cancelled, true);
      assertEquals(signal?.aborted, true);
    } finally {
      await channels.close();
    }
  });

  it("propagates cancellation during generation and an idle stream", async () => {
    const started = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    const channels = await connected(stubModel({
      doGenerate: (options) => {
        signal = options.abortSignal;
        started.resolve();
        return new Promise((_resolve, reject) =>
          signal!.addEventListener(
            "abort",
            () => reject(new Error("Synthetic private upstream failure")),
            { once: true },
          )
        );
      },
    }));
    try {
      const controller = new AbortController();
      const call = channels.proxy.doGenerate({ prompt, abortSignal: controller.signal });
      await started.promise;
      controller.abort();
      await assertRejects(async () => await call, Error, "cancelled");
      assertEquals(signal?.aborted, true);
    } finally {
      await channels.close();
    }
    let cancelled = false;
    const streaming = await connected(
      stubModel({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }, { highWaterMark: 0 }),
          }),
      }),
    );
    try {
      const controller = new AbortController();
      const { stream } = await streaming.proxy.doStream({ prompt, abortSignal: controller.signal });
      controller.abort();
      await assertRejects(() => stream.getReader().read(), Error, "cancelled");
      await tick();
      assertEquals(cancelled, true);
    } finally {
      await streaming.close();
    }
  });

  it("retains admission until asynchronous provider stream cleanup settles", async () => {
    const cleanup = Promise.withResolvers<void>();
    const cancelStarted = Promise.withResolvers<void>();
    let cancelCalls = 0;
    let cancellationSettled = false;
    let cancellation: Promise<void> | undefined;
    const channels = await connected(
      stubModel({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              cancel() {
                cancelCalls++;
                cancelStarted.resolve();
                return cleanup.promise;
              },
            }, { highWaterMark: 0 }),
          }),
      }),
      { maxConcurrentCalls: 1 },
    );
    try {
      const { stream } = await channels.proxy.doStream({ prompt });
      cancellation = stream.cancel();
      void cancellation.then(
        () => cancellationSettled = true,
        () => cancellationSettled = true,
      );
      await cancelStarted.promise;
      await tick();
      assertEquals(cancellationSettled, false);
      await assertRejects(
        async () => await channels.proxy.doGenerate({ prompt }),
        Error,
        "concurrent call limit",
      );
      cleanup.resolve();
      await cancellation;
      assertEquals(cancelCalls, 1);
      assertEquals(
        await channels.proxy.doGenerate({ prompt }),
        await stubModel().doGenerate({ prompt }),
      );
    } finally {
      cleanup.resolve();
      await cancellation?.catch(() => {});
      await channels.close();
    }
  });

  it("enforces the cancellation deadline while provider stream cleanup remains pending", async () => {
    const cleanup = Promise.withResolvers<void>();
    const cancelStarted = Promise.withResolvers<void>();
    let cancellation: Promise<void> | undefined;
    const channels = await connected(
      stubModel({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              cancel() {
                cancelStarted.resolve();
                return cleanup.promise;
              },
            }, { highWaterMark: 0 }),
          }),
      }),
      { maxConcurrentCalls: 1, brokerCancellationTimeoutMs: 20 },
    );
    try {
      const { stream } = await channels.proxy.doStream({ prompt });
      cancellation = stream.cancel();
      void cancellation.catch(() => {});
      await cancelStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assertEquals(channels.broker.signal.aborted, true);
      assertEquals(
        (await channels.broker.closed).message,
        "Executor handler cancellation deadline exceeded",
      );
      await assertRejects(async () => await cancellation, Error, "Executor");
      assertEquals(channels.caller.signal.aborted, true);
    } finally {
      // The provider does not finish during the deadline; release the fixture only during teardown.
      cleanup.resolve();
      await cancellation?.catch(() => {});
      await channels.close();
    }
  });

  it("finishes a stream and keeps transport response fields out of generation results", async () => {
    const channels = await connected(stubModel({
      doGenerate: () =>
        Promise.resolve({
          content: [{ type: "text", text: "Synthetic answer" }],
          response: { headers: { "x-internal": "Synthetic transport detail" } },
          rawResponse: { error: "Synthetic private detail" },
        }),
    }));
    try {
      assertEquals(await channels.proxy.doGenerate({ prompt }), {
        content: [{ type: "text", text: "Synthetic answer" }],
      });
      const { stream, warnings } = await channels.proxy.doStream({ prompt });
      assertEquals(warnings, undefined);
      const reader = stream.getReader();
      assertEquals(await reader.read(), {
        done: false,
        value: { type: "text-delta", delta: "Synthetic answer" },
      });
      assertEquals(await reader.read(), { done: true, value: undefined });
    } finally {
      await channels.close();
    }
  });

  it("cancels preparation and rejects an already cancelled generation before dispatch", async () => {
    const started = Promise.withResolvers<void>();
    let preparedSignal: AbortSignal | undefined;
    let generations = 0;
    const channels = await connected(stubModel({
      prepare: (signal) => {
        preparedSignal = signal;
        started.resolve();
        return new Promise((_resolve, reject) =>
          signal!.addEventListener(
            "abort",
            () => reject(new Error("Synthetic preparation detail")),
            { once: true },
          )
        );
      },
      doGenerate: () => {
        generations++;
        return Promise.resolve({});
      },
    }));
    try {
      const controller = new AbortController();
      const call = channels.proxy.prepare!(controller.signal);
      await started.promise;
      controller.abort();
      await assertRejects(async () => await call, Error, "cancelled");
      assertEquals(preparedSignal?.aborted, true);
      await assertRejects(
        async () => await channels.proxy.doGenerate({ prompt, abortSignal: controller.signal }),
        Error,
        "cancelled",
      );
      assertEquals(generations, 0);
    } finally {
      await channels.close();
    }
  });

  it("bounds input collections and oversized output with fixed failures", async () => {
    const channels = await connected(stubModel({
      doGenerate: () => Promise.resolve({ content: ["x".repeat(600_000), "y".repeat(600_000)] }),
    }));
    try {
      await assertRejects(
        () =>
          channels.caller.request("model.generate", {
            modelId,
            options: {
              prompt: Array.from(
                { length: 1001 },
                () => ({ role: "system", content: "synthetic" }),
              ),
            },
          }),
        Error,
        "operation-failed",
      );
      const error = await assertRejects(
        async () => await channels.proxy.doGenerate({ prompt }),
        Error,
      );
      assert(error instanceof Error);
      assertEquals(error.message, "Executor call operation-failed");
    } finally {
      await channels.close();
    }
  });

  it("preserves recoverable provider-tool errors and subsequent text and usage", async () => {
    for (
      const toolError of [
        {
          type: "tool-error",
          toolCallId: "search-test",
          toolName: "web_search",
          error: [{ type: "web_search_tool_result_error", error_code: "max_uses_exceeded" }],
          isError: true,
          providerExecuted: true,
        },
        {
          type: "tool-error",
          toolCallId: "code-test",
          toolName: "code_execution",
          error: { outcome: "OUTCOME_FAILED", output: "Synthetic tool failure" },
          isError: true,
          providerExecuted: true,
        },
      ]
    ) {
      const parts = [toolError, { type: "text-delta", delta: "Synthetic continuation" }, {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 2 },
      }];
      const channels = await connected(stubModel({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.close();
              },
            }),
          }),
      }));
      try {
        const { stream } = await channels.proxy.doStream({ prompt });
        const reader = stream.getReader();
        const received: unknown[] = [];
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          received.push(next.value);
        }
        assertEquals(received, parts);
      } finally {
        await channels.close();
      }
    }
  });

  it("keeps upstream errors and non-data results out of the wire", async () => {
    for (
      const model of [
        stubModel({ doGenerate: () => Promise.reject(new Error("Synthetic private error body")) }),
        stubModel({
          doGenerate: () =>
            Promise.resolve({ content: [new Error("Synthetic private error body")] }),
        }),
      ]
    ) {
      const channels = await connected(model);
      try {
        const error = await assertRejects(
          async () => await channels.proxy.doGenerate({ prompt }),
          Error,
          "operation-failed",
        );
        assert(error instanceof Error);
        assertEquals(error.message, "Executor call operation-failed");
      } finally {
        await channels.close();
      }
    }
    for (
      const part of [
        { type: "error", error: "Synthetic private error body" },
        { type: "raw", rawValue: { error: { message: "Synthetic private error body" } } },
        { type: "raw", rawValue: { type: "tool-error", error: "Synthetic raw error body" } },
      ]
    ) {
      const channels = await connected(stubModel({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue(part);
                controller.close();
              },
            }),
          }),
      }));
      try {
        const error = await assertRejects(
          async () => {
            const { stream } = await channels.proxy.doStream({ prompt });
            await stream.getReader().read();
          },
          Error,
          "operation-failed",
        );
        assert(error instanceof Error);
        assertEquals(error.message, "Executor call operation-failed");
      } finally {
        await channels.close();
      }
    }
  });
});
