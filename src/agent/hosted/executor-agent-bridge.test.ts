import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/types.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import type { HostedChatRuntimeStreamInput } from "./chat-runtime-contract.ts";
import {
  createHostedChatRuntimeAgentAdapter,
  createHostedChatRuntimeDataStream,
} from "./chat-runtime-agent-adapter.ts";
import {
  createExecutorAgentOperations,
  createExecutorHostedChatRuntimeAgent,
} from "./executor-agent-bridge.ts";
import { ExecutorAgentError } from "./executor-agent-schema.ts";

const handle = "prepared-synthetic-runtime";
const sourceIntegrationPolicy = { schemaVersion: 1, mode: "unrestricted" } as const;
const messages: HostedChatRuntimeStreamInput["messages"] = [{
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "Synthetic question" }],
  timestamp: 1,
}];
const encoder = new TextEncoder();
const sse = (events: JsonValue[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
async function collect(stream: AsyncIterable<ChatUiMessageChunk>) {
  const result: ChatUiMessageChunk[] = [];
  for await (const chunk of stream) result.push(chunk);
  return result;
}
function pair(operations: ReadonlyMap<string, ExecutorOperation>, options: {
  maxConcurrentCalls?: number;
  executorCancellationTimeoutMs?: number;
} = {}) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const binding = { allocationId: "allocation", generation: 1, invocationId: "invocation" };
  const broker = createExecutorChannel({
    binding,
    maxConcurrentCalls: options.maxConcurrentCalls,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const executor = createExecutorChannel({
    binding,
    operations,
    maxConcurrentCalls: options.maxConcurrentCalls,
    cancellationTimeoutMs: options.executorCancellationTimeoutMs,
    transport: { readable: forward.readable, writable: backward.writable },
  });
  return {
    broker,
    executor,
    async close() {
      broker.close();
      await executor.closed;
    },
  };
}

describe("executor hosted agent bridge", () => {
  it("matches legacy chunks and retains context, reasoning, tool failures, progress, usage and broker callbacks", async () => {
    const events: JsonValue[] = [
      { type: "message-start", messageId: "executor-message" },
      { type: "data-veryfront.runtime_context", data: { projectId: "project-1" } },
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", delta: "Synthetic reasoning" },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "lookup", dynamic: true },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"query":"x"}' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "lookup",
        input: { query: "x" },
      },
      { type: "data-tool-progress", data: { step: 1 } },
      { type: "tool-output-error", toolCallId: "tool-1", errorText: "Try another source" },
      { type: "text-delta", id: "text-1", delta: "Synthetic answer" },
      { type: "text-end", id: "text-1" },
      { type: "step-end" },
      {
        type: "message-finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 2, outputTokens: 3, reasoningTokens: 1, costUsd: 0.1 },
      },
    ];
    type RuntimeInput = Parameters<
      Parameters<typeof createHostedChatRuntimeDataStream>[0]["runtimeAgent"]["stream"]
    >[0];
    let received: RuntimeInput | undefined;
    const adapterInput = {
      sourceIntegrationPolicy,
      runId: "run-1",
      agentId: "agent-1",
      projectId: "project-1",
      maxOutputTokens: 100,
      runtimeAgent: {
        stream(input: RuntimeInput) {
          received = input;
          return Promise.resolve({ toDataStreamResponse: () => new Response(sse(events)) });
        },
      },
    };
    let cleaned = 0;
    const channels = pair(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: (input) => createHostedChatRuntimeDataStream(adapterInput, input),
      cleanup: () => {
        cleaned++;
        return Promise.resolve();
      },
    }));
    try {
      const input = { messages, abortSignal: new AbortController().signal };
      const remote = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream(input);
      assertEquals(await remote.steps, []);
      const callbackOrder: string[] = [];
      const metadata = { modelId: "synthetic-model" };
      const chunks = await collect(remote.toUIMessageStream({
        generateMessageId: () => "broker-message",
        sendReasoning: true,
        messageMetadata({ part }) {
          callbackOrder.push("metadata");
          assertEquals(part.totalUsage.inputTokens, 2);
          return metadata;
        },
        async onFinish(event) {
          callbackOrder.push("persist");
          await Promise.resolve();
          assertEquals(event.responseMessage.id, "broker-message");
          assertEquals(event.responseMessage.metadata, metadata);
          callbackOrder.push("persisted");
        },
      }));
      const remoteReceived = received;
      const legacy = await createHostedChatRuntimeAgentAdapter(adapterInput).stream(input);
      assertEquals(
        chunks,
        await collect(legacy.toUIMessageStream({
          generateMessageId: () => "broker-message",
          sendReasoning: true,
          messageMetadata: () => metadata,
        })),
      );
      assertEquals(callbackOrder, ["metadata", "persist", "persisted"]);
      assertEquals(remoteReceived?.messages, messages);
      assertEquals(remoteReceived?.context?.projectId, "project-1");
      assertEquals(remoteReceived?.maxOutputTokens, 100);
      assertEquals(cleaned, 1);
      assertEquals(channels.broker.signal.aborted, false);
    } finally {
      await channels.close();
    }
  });

  it("does not yield finish before the broker persistence callback settles", async () => {
    const persisted = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () => Promise.resolve(sse([{ type: "message-finish" }])),
      }),
    );
    try {
      const runtime = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      const chunks: ChatUiMessageChunk[] = [];
      const consume = (async () => {
        for await (
          const chunk of runtime.toUIMessageStream({
            onFinish: () => {
              entered.resolve();
              return persisted.promise;
            },
          })
        ) chunks.push(chunk);
      })();
      await entered.promise;
      assertEquals(chunks.some((chunk) => chunk.type === "finish"), false);
      persisted.resolve();
      await consume;
      assertEquals(chunks.at(-1)?.type, "finish");
    } finally {
      persisted.resolve();
      await channels.close();
    }
  });

  it("keeps curated error codes and invokes onError locally", async () => {
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () =>
          Promise.resolve(
            sse([{ type: "error", error: "Synthetic error", code: "CONTEXT_LENGTH_EXCEEDED" }]),
          ),
      }),
    );
    try {
      const runtime = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      let code: string | undefined;
      const chunks = await collect(runtime.toUIMessageStream({
        onError: (_error, context) => {
          code = context?.code;
          return "Broker error text";
        },
      }));
      assertEquals(code, "CONTEXT_LENGTH_EXCEEDED");
      assert(
        chunks.some((chunk) => chunk.type === "error" && chunk.errorText === "Broker error text"),
      );
    } finally {
      await channels.close();
    }
  });

  for (
    const input of [
      'data: {"type":"text-delta","delta":42}\n\n',
      'data: {"type":"text-delta","delta":"unfinished"}\n\n',
      'data: {"type":"message-finish"}',
      "data: not-json\n\n",
    ]
  ) {
    it("rejects invalid or truncated source data without calling onFinish", async () => {
      let cleaned = 0;
      const channels = pair(
        createExecutorAgentOperations({
          preparedRuntimeHandle: handle,
          startStream: () => Promise.resolve(new Response(input).body!),
          cleanup: () => {
            cleaned++;
            return Promise.resolve();
          },
        }),
      );
      try {
        const runtime = await createExecutorHostedChatRuntimeAgent({
          channel: channels.broker,
          preparedRuntimeHandle: handle,
        }).stream({ messages, abortSignal: new AbortController().signal });
        let finished = false;
        await assertRejects(() =>
          collect(runtime.toUIMessageStream({
            onFinish: () => {
              finished = true;
            },
          })), ExecutorAgentError);
        assertEquals(finished, false);
        assertEquals(cleaned, 1);
      } finally {
        await channels.close();
      }
    });
  }

  const invalidFrames: JsonValue[][] = [
    [{ type: "ready" }],
    [{ type: "ready" }, { type: "complete" }, {
      type: "event",
      event: { type: "message-finish" },
    }],
    [{ type: "ready" }, {
      type: "event",
      event: { type: "message-finish", credentials: "synthetic" },
    }, { type: "complete" }],
  ];
  for (const frames of invalidFrames) {
    it("validates remote frames and requires completion followed by normal end", async () => {
      const channels = pair(
        new Map([["agent.stream", {
          mode: "stream",
          async *handle(): AsyncIterable<JsonValue> {
            const payloads: JsonValue[] = frames;
            for (const frame of payloads) yield frame;
          },
        }]]),
      );
      try {
        const runtime = await createExecutorHostedChatRuntimeAgent({
          channel: channels.broker,
          preparedRuntimeHandle: handle,
        }).stream({ messages, abortSignal: new AbortController().signal });
        await assertRejects(() => collect(runtime.toUIMessageStream()), ExecutorAgentError);
      } finally {
        await channels.close();
      }
    });
  }

  it("rejects oversized input before starting an operation and never truncates it", async () => {
    let starts = 0;
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () => {
          starts++;
          return Promise.resolve(sse([{ type: "message-finish" }]));
        },
      }),
    );
    try {
      const error = await assertRejects(
        () =>
          createExecutorHostedChatRuntimeAgent({
            channel: channels.broker,
            preparedRuntimeHandle: handle,
          }).stream({
            messages: [{
              ...messages[0]!,
              parts: [{ type: "text", text: "x".repeat(1024 * 1024) }],
            }],
            abortSignal: new AbortController().signal,
          }),
        ExecutorAgentError,
      );
      assert(error instanceof ExecutorAgentError);
      assertEquals(error.code, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
      assertEquals(error.status, 413);
      assertEquals(starts, 0);
    } finally {
      await channels.close();
    }
  });

  it("cancels a pending read, cleans the local runtime once and keeps the channel open", async () => {
    const cleaned = Promise.withResolvers<void>();
    let cancellations = 0;
    let localSignal: AbortSignal | undefined;
    const channels = pair(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: (input) => {
        localSignal = input.abortSignal;
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancellations++;
            },
          }),
        );
      },
      cleanup: () => {
        cleaned.resolve();
        return Promise.resolve();
      },
    }));
    try {
      const controller = new AbortController();
      const agent = createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      });
      const runtime = await agent.stream({ messages, abortSignal: controller.signal });
      const stream = runtime.toUIMessageStream()[Symbol.asyncIterator]();
      await stream.next();
      const pending = assertRejects(() => stream.next());
      controller.abort();
      await pending;
      await cleaned.promise;
      assertEquals(localSignal?.aborted, true);
      assertEquals(cancellations, 1);
      assertEquals(channels.broker.signal.aborted, false);
      await assertRejects(
        () => agent.stream({ messages, abortSignal: new AbortController().signal }),
        ExecutorAgentError,
      );
      assertThrows(() => runtime.toUIMessageStream(), ExecutorAgentError);
    } finally {
      await channels.close();
    }
  });

  it("releases a stream when the consumer returns after the initial UI start chunk", async () => {
    let cleaned = false;
    const channels = pair(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: () => Promise.resolve(new ReadableStream<Uint8Array>()),
      cleanup: () => {
        cleaned = true;
        return Promise.resolve();
      },
    }));
    try {
      const result = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      const iterator = result.toUIMessageStream()[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value.type, "start");
      await iterator.return?.();
      // The close handshake is observable without a sleep or request-signal abort.
      assertEquals(cleaned, true);
      assertEquals(channels.broker.signal.aborted, false);
    } finally {
      await channels.close();
    }
  });

  it("rejects startup with a fixed code and no original exception text", async () => {
    let cleaned = 0;
    const channels = pair(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: () =>
        Promise.reject(
          Object.assign(new Error("synthetic-private-diagnostic"), { code: "OVERLOADED_ERROR" }),
        ),
      cleanup: () => {
        cleaned++;
        return Promise.resolve();
      },
    }));
    try {
      const error = await assertRejects(
        () =>
          createExecutorHostedChatRuntimeAgent({
            channel: channels.broker,
            preparedRuntimeHandle: handle,
          }).stream({ messages, abortSignal: new AbortController().signal }),
        ExecutorAgentError,
      );
      assert(error instanceof ExecutorAgentError);
      assertEquals(error.code, "OVERLOADED_ERROR");
      assertEquals(error.status, 503);
      assertEquals(error.message.includes("synthetic-private-diagnostic"), false);
      assertEquals(cleaned, 1);
    } finally {
      await channels.close();
    }
  });

  it("rejects abnormal channel end after a complete frame", async () => {
    const channels = pair(
      new Map<string, ExecutorOperation>([["agent.stream", {
        mode: "stream",
        async *handle(): AsyncIterable<JsonValue> {
          yield { type: "ready" };
          yield { type: "event", event: { type: "message-finish" } };
          yield { type: "complete" };
          throw new Error("synthetic-private-diagnostic");
        },
      }]]),
    );
    try {
      const runtime = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      let finished = false;
      await assertRejects(() =>
        collect(runtime.toUIMessageStream({
          onFinish: () => {
            finished = true;
          },
        })), ExecutorAgentError);
      assertEquals(finished, false);
    } finally {
      await channels.close();
    }
  });

  it("cancels readiness promptly while retaining setup and late-body cancellation", async () => {
    const entered = Promise.withResolvers<void>();
    const source = Promise.withResolvers<ReadableStream<Uint8Array>>();
    const cancelStarted = Promise.withResolvers<void>();
    const lateCleanup = Promise.withResolvers<void>();
    const runtimeCleaned = Promise.withResolvers<void>();
    let cleaned = 0;
    const operations = new Map(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: () => {
        entered.resolve();
        return source.promise;
      },
      cleanup: () => {
        cleaned++;
        runtimeCleaned.resolve();
        return Promise.resolve();
      },
    }));
    operations.set("ping", { mode: "unary", handle: () => null });
    const channels = pair(operations, { maxConcurrentCalls: 1 });
    try {
      const controller = new AbortController();
      const result = createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: controller.signal });
      const rejected = assertRejects(() => result, ExecutorAgentError);
      await entered.promise;
      controller.abort();
      await rejected;
      assertEquals(cleaned, 0);
      assertEquals(channels.broker.signal.aborted, false);
      await assertRejects(
        () => channels.broker.request("ping", null),
        Error,
        "concurrent call limit",
      );
      source.resolve(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelStarted.resolve();
            return lateCleanup.promise;
          },
        }),
      );
      await cancelStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(cleaned, 0);
      await assertRejects(
        () => channels.broker.request("ping", null),
        Error,
        "concurrent call limit",
      );
      lateCleanup.resolve();
      await runtimeCleaned.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(cleaned, 1);
      assertEquals(await channels.broker.request("ping", null), null);
    } finally {
      lateCleanup.resolve();
      source.resolve(sse([{ type: "message-finish" }]));
      await channels.close();
    }
  });

  it("fences setup that never settles before its cancellation deadline", async () => {
    const entered = Promise.withResolvers<void>();
    const source = Promise.withResolvers<ReadableStream<Uint8Array>>();
    const runtimeCleaned = Promise.withResolvers<void>();
    let cleaned = 0;
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () => {
          entered.resolve();
          return source.promise;
        },
        cleanup: () => {
          cleaned++;
          runtimeCleaned.resolve();
          return Promise.resolve();
        },
      }),
      { executorCancellationTimeoutMs: 20 },
    );
    try {
      const controller = new AbortController();
      const result = createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: controller.signal });
      const rejected = assertRejects(() => result, ExecutorAgentError);
      await entered.promise;
      controller.abort();
      await rejected;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assertEquals(channels.executor.signal.aborted, true);
      assertEquals(
        (await channels.executor.closed).message,
        "Executor handler cancellation deadline exceeded",
      );
      assertEquals(cleaned, 0);
    } finally {
      source.resolve(sse([{ type: "message-finish" }]));
      await runtimeCleaned.promise;
      await channels.close();
    }
  });

  it("releases a UI iterator returned before its first next call", async () => {
    let cleaned = false;
    const channels = pair(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: () => Promise.resolve(new ReadableStream<Uint8Array>()),
      cleanup: () => {
        cleaned = true;
        return Promise.resolve();
      },
    }));
    try {
      const runtime = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      await runtime.toUIMessageStream()[Symbol.asyncIterator]().return?.();
      assertEquals(cleaned, true);
    } finally {
      await channels.close();
    }
  });

  it("rejects an unbound handle or extra authority fields before touching the prepared runtime", async () => {
    let starts = 0;
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () => {
          starts++;
          return Promise.resolve(sse([{ type: "message-finish" }]));
        },
      }),
    );
    try {
      const invalidInputs: JsonValue[] = [
        { preparedRuntimeHandle: "other-runtime", messages: [] },
        { preparedRuntimeHandle: handle, messages: [], authToken: "synthetic" },
      ];
      for (const payload of invalidInputs) {
        const frames: JsonValue[] = [];
        for await (const frame of channels.broker.stream("agent.stream", payload)) {
          frames.push(frame);
        }
        assertEquals(frames, [{
          type: "failure",
          phase: "setup",
          code: "EXECUTOR_AGENT_INVALID_INPUT",
        }]);
      }
      assertEquals(starts, 0);
      const result = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      await collect(result.toUIMessageStream());
      assertEquals(starts, 1);
    } finally {
      await channels.close();
    }
  });

  it("turns channel loss into a typed stream failure without finalizing success", async () => {
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () => Promise.resolve(new ReadableStream<Uint8Array>()),
      }),
    );
    try {
      const result = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      let finished = false;
      const chunks = result.toUIMessageStream({
        onFinish: () => {
          finished = true;
        },
      })[Symbol.asyncIterator]();
      await chunks.next();
      const rejected = assertRejects(() => chunks.next(), ExecutorAgentError);
      channels.executor.close();
      await rejected;
      assertEquals(finished, false);
    } finally {
      await channels.close();
    }
  });

  for (const condition of ["aborted", "closed", "capacity"] as const) {
    it(`normalizes ${condition} setup failures before iteration`, async () => {
      const held = Promise.withResolvers<void>();
      const entered = Promise.withResolvers<void>();
      const channels = pair(
        new Map<string, ExecutorOperation>([["hold", {
          mode: "unary",
          async handle() {
            entered.resolve();
            await held.promise;
            return null;
          },
        }]]),
        { maxConcurrentCalls: 1 },
      );
      let active: Promise<JsonValue> | undefined;
      try {
        const controller = new AbortController();
        if (condition === "aborted") controller.abort(new Error("Synthetic caller abort"));
        if (condition === "closed") {
          channels.broker.close();
          await channels.broker.closed;
        }
        if (condition === "capacity") {
          active = channels.broker.request("hold", null);
          await entered.promise;
        }
        const error = await assertRejects(
          () =>
            createExecutorHostedChatRuntimeAgent({
              channel: channels.broker,
              preparedRuntimeHandle: handle,
            }).stream({ messages, abortSignal: controller.signal }),
          ExecutorAgentError,
        );
        assert(error instanceof ExecutorAgentError);
        assertEquals(
          error.code,
          condition === "aborted" ? "ABORTED" : "EXECUTOR_AGENT_SETUP_FAILED",
        );
        assertEquals(error.status, condition === "aborted" ? 499 : 500);
      } finally {
        held.resolve();
        await active?.catch(() => {});
        await channels.close();
      }
    });
  }

  it("retains admission and runtime cleanup until source cancellation settles", async () => {
    const sourceCleanup = Promise.withResolvers<void>();
    const cancelStarted = Promise.withResolvers<void>();
    let cleanupCalls = 0;
    let cancelled = false;
    let cancellation: Promise<unknown> | undefined;
    const operations = new Map(createExecutorAgentOperations({
      preparedRuntimeHandle: handle,
      startStream: () =>
        Promise.resolve(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelStarted.resolve();
              return sourceCleanup.promise;
            },
          }),
        ),
      cleanup: () => {
        cleanupCalls++;
        return Promise.resolve();
      },
    }));
    operations.set("ping", { mode: "unary", handle: () => null });
    const channels = pair(operations, { maxConcurrentCalls: 1 });
    try {
      const result = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      cancellation = result.toUIMessageStream()[Symbol.asyncIterator]().return?.();
      void cancellation?.then(() => cancelled = true, () => cancelled = true);
      await cancelStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(cleanupCalls, 0);
      assertEquals(cancelled, false);
      await assertRejects(
        () => channels.broker.request("ping", null),
        Error,
        "concurrent call limit",
      );
      sourceCleanup.resolve();
      await cancellation;
      assertEquals(cleanupCalls, 1);
      assertEquals(await channels.broker.request("ping", null), null);
    } finally {
      sourceCleanup.resolve();
      await cancellation?.catch(() => {});
      await channels.close();
    }
  });

  it("enforces the handler deadline while source cancellation remains pending", async () => {
    const sourceCleanup = Promise.withResolvers<void>();
    const cancelStarted = Promise.withResolvers<void>();
    let cleanupCalls = 0;
    let cancellation: Promise<unknown> | undefined;
    const channels = pair(
      createExecutorAgentOperations({
        preparedRuntimeHandle: handle,
        startStream: () =>
          Promise.resolve(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancelStarted.resolve();
                return sourceCleanup.promise;
              },
            }),
          ),
        cleanup: () => {
          cleanupCalls++;
          return Promise.resolve();
        },
      }),
      { executorCancellationTimeoutMs: 20 },
    );
    try {
      const result = await createExecutorHostedChatRuntimeAgent({
        channel: channels.broker,
        preparedRuntimeHandle: handle,
      }).stream({ messages, abortSignal: new AbortController().signal });
      cancellation = result.toUIMessageStream()[Symbol.asyncIterator]().return?.();
      await cancelStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assertEquals(channels.executor.signal.aborted, true);
      assertEquals(
        (await channels.executor.closed).message,
        "Executor handler cancellation deadline exceeded",
      );
      assertEquals(cleanupCalls, 0);
      await cancellation;
    } finally {
      sourceCleanup.resolve();
      await cancellation?.catch(() => {});
      await channels.close();
    }
  });
});
