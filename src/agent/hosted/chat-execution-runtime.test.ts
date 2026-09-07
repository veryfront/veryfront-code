import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "#veryfront/chat/types.ts";
import type { HostedAgentRunSpan, HostedAgentRunTracer } from "./agent-run-lifecycle.ts";
import {
  type ConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
} from "#veryfront/agent/conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorDisableReason } from "../conversation/run-mirror.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeStreamInput,
  HostedChatRuntimeStreamResult,
  HostedChatRuntimeToUiMessageStreamOptions,
} from "./chat-runtime-contract.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import { createMirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import {
  cleanupAfterHostedChatExecutionFinalization,
  createBootstrappedHostedChatExecutionRuntime,
  createHostedChatExecutionRuntime,
  createHostedChatExecutionRuntimeBootstrap,
  createHostedChatFinalizeDetachedBuildState,
  createHostedChatFinalizeResponseBuildState,
  createHostedChatStreamFinalizationHooks,
  type HostedChatExecutionLifecycleAdapter,
  type HostedChatExecutionRootStreamWatchdog,
  toHostedChatExecutionFinalState,
} from "./chat-execution-runtime.ts";
import {
  getActiveRunEventSink,
  runWithRunEventSink,
} from "../../runtime/run-event-sink-context.ts";
import { streamText } from "../../runtime/runtime-bridge.ts";
import { createStreamModel } from "../../runtime/runtime-bridge.test-helpers.ts";
import { DurableRunEventPersistenceError } from "./durable-run-event-sink.ts";

function createRootStreamWatchdog(input?: {
  disposed?: () => void;
  signal?: AbortSignal;
}): HostedChatExecutionRootStreamWatchdog {
  return {
    signal: input?.signal ?? new AbortController().signal,
    get lastTimeoutState() {
      return null;
    },
    keepAlive: () => {},
    observe: () => {},
    dispose: () => {
      input?.disposed?.();
    },
  };
}

function createDurableRunMirror(input: {
  chunks: ChatUiMessageChunk<MessageMetadata>[];
  flushes: string[];
}): ConversationRunChunkMirror {
  return {
    handleChunk: async (chunk) => {
      input.chunks.push(chunk);
    },
    appendEvents: async () => {},
    flush: async () => {
      input.flushes.push("flush");
      return {
        latestEventId: 0,
        latestExternalEventSequence: 0,
        pendingEventCount: 0,
        consecutiveFailures: 0,
        disabled: false,
        hasFlushTimer: false,
        hasRetryTimer: false,
        inFlight: false,
      };
    },
    getSnapshot: () => ({
      latestEventId: 0,
      latestExternalEventSequence: 0,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: false,
      hasFlushTimer: false,
      hasRetryTimer: false,
      inFlight: false,
    }),
    dispose: () => {},
  };
}

function withoutEventTiming(event: unknown): unknown {
  if (typeof event !== "object" || event === null) return event;
  const { elapsedMs: _elapsedMs, emittedAt: _emittedAt, ...semanticEvent } = event as Record<
    string,
    unknown
  >;
  return semanticEvent;
}

function createLifecycleAdapter(input?: {
  durableRunMirror?: ConversationRunChunkMirror | null;
  messageId?: string | null;
  terminalStates?: HostedLifecycleTerminalState[];
}): HostedChatExecutionLifecycleAdapter {
  const terminalStates = input?.terminalStates ?? [];
  return {
    durableRootRun: {
      runId: "root-run-1",
      messageId: input && "messageId" in input ? input.messageId : "stream-message-1",
    },
    durableRunMirror: input?.durableRunMirror ?? null,
    terminal: {
      toTerminalState: (state) => ({
        status: state.status,
        ...(state.metadata ? { metadata: state.metadata } : {}),
        ...(state.terminalErrorCode !== undefined
          ? { terminalErrorCode: state.terminalErrorCode }
          : {}),
        ...(state.terminalErrorMessage !== undefined
          ? { terminalErrorMessage: state.terminalErrorMessage }
          : {}),
      }),
      finalizeRun: async (state) => {
        terminalStates.push(state);
      },
      cancelRun: async (state) => {
        terminalStates.push(state);
      },
      onTerminalState: async () => {},
    },
  };
}

function createDisabledDurableRunMirror(
  disableReason: ConversationRunMirrorDisableReason,
): ConversationRunChunkMirror {
  const snapshot = () => ({
    latestEventId: 0,
    latestExternalEventSequence: 0,
    pendingEventCount: 0,
    consecutiveFailures: 0,
    disabled: true,
    disableReason,
    hasFlushTimer: false,
    hasRetryTimer: false,
    inFlight: false,
  });

  return {
    handleChunk: async () => {},
    appendEvents: async () => {},
    flush: async () => snapshot(),
    getSnapshot: snapshot,
    dispose: () => {},
  };
}

function createResponseMessage(input: {
  parts: ChatUiMessage["parts"];
  metadata?: MessageMetadata;
}): ChatUiMessage {
  return {
    id: "assistant-message-1",
    role: "assistant",
    parts: input.parts,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function createStreamResult(input: {
  finalStep: unknown;
  captureOptions: (options?: HostedChatRuntimeToUiMessageStreamOptions) => void;
}) {
  return {
    steps: Promise.resolve([input.finalStep]),
    toUIMessageStream: (options?: HostedChatRuntimeToUiMessageStreamOptions) => {
      input.captureOptions(options);
      return emptyStream();
    },
  };
}

async function* emptyStream(): AsyncIterable<ChatUiMessageChunk<MessageMetadata>> {}

function createLogger() {
  const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  return {
    errors,
    warnings,
    logger: {
      error: (message: string, metadata?: Record<string, unknown>) => {
        errors.push({ message, ...(metadata ? { metadata } : {}) });
      },
      warn: (message: string, metadata?: Record<string, unknown>) => {
        warnings.push({ message, ...(metadata ? { metadata } : {}) });
      },
    },
  };
}

function createTracer() {
  const attributes: Array<Parameters<HostedAgentRunSpan["setAttributes"]>[0]> = [];
  let finishCount = 0;
  let contextCount = 0;
  const span: HostedAgentRunSpan = {
    setAttributes: (nextAttributes) => {
      attributes.push(nextAttributes);
    },
    finish: () => {
      finishCount += 1;
    },
    withContext: (fn) => {
      contextCount += 1;
      return fn();
    },
  };
  const tracer: HostedAgentRunTracer = {
    startSpan: () => span,
  };

  return {
    attributes,
    tracer,
    get finishCount() {
      return finishCount;
    },
    get contextCount() {
      return contextCount;
    },
  };
}

describe("agent/hosted-chat-execution-runtime", () => {
  it("keeps public compatibility shims exported from the agent barrel", async () => {
    const script = `
      const publicAgent = await import("./src/agent/index.ts");
      const names = [
        "toHostedChatExecutionFinalState",
        "cleanupAfterHostedChatExecutionFinalization",
        "createHostedChatStreamFinalizationHooks",
        "createHostedChatFinalizeResponseBuildState",
        "createHostedChatFinalizeDetachedBuildState",
        "finalizeHostedResponse",
        "finalizeHostedDetached",
      ];
      const missing = names.filter((name) => typeof publicAgent[name] !== "function");
      if (missing.length > 0) {
        throw new Error("Missing public compatibility shim exports: " + missing.join(", "));
      }
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", script],
      stderr: "piped",
    }).output();

    assertEquals(
      output.code,
      0,
      new TextDecoder().decode(output.stderr),
    );
  });

  it("does not inject fallback model metadata for finalization-only states", () => {
    assertEquals(toHostedChatExecutionFinalState({ status: "completed" }), {
      status: "completed",
    });
  });

  it("keeps only present metadata and terminal error fields", () => {
    assertEquals(
      toHostedChatExecutionFinalState({
        status: "failed",
        metadata: {
          modelId: "gpt-5.4",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 4,
          },
        },
        terminalErrorCode: "STREAM_ERROR",
      }),
      {
        status: "failed",
        metadata: {
          modelId: "gpt-5.4",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 4,
          },
        },
        terminalErrorCode: "STREAM_ERROR",
      },
    );
  });

  it("logs cleanup failures during finalization without rethrowing", async () => {
    const { logger, errors } = createLogger();

    await cleanupAfterHostedChatExecutionFinalization({
      cleanup: async () => {
        throw new Error("cleanup failed");
      },
      logger,
    });

    assertEquals(errors, [
      {
        message: "Runtime cleanup failed during finalization",
        metadata: { error: "cleanup failed" },
      },
    ]);
  });

  it("runs cleanup during finalization when cleanup succeeds", async () => {
    let cleanupCount = 0;

    await cleanupAfterHostedChatExecutionFinalization({
      cleanup: async () => {
        cleanupCount += 1;
      },
    });

    assertEquals(cleanupCount, 1);
  });

  it("resolves aborted terminal state before incomplete tool state", () => {
    const hooks = createHostedChatStreamFinalizationHooks({
      lifecycleAdapter: createLifecycleAdapter(),
      cleanup: async () => {},
      streamError: null,
    });

    assertEquals(hooks.resolveTerminalState({ isAborted: true, hasIncompleteToolParts: true }), {
      status: "cancelled",
      terminalErrorCode: "ABORTED",
      terminalErrorMessage: "Chat stream aborted",
    });
  });

  it("skips durable run finalization in the exported hooks when the run is already terminal", async () => {
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const hooks = createHostedChatStreamFinalizationHooks({
      lifecycleAdapter: createLifecycleAdapter({
        durableRunMirror: createDisabledDurableRunMirror("run_terminal"),
        terminalStates,
      }),
      cleanup: async () => {},
      streamError: null,
    });

    await hooks.dispatchTerminalState({
      status: "failed",
      terminalErrorCode: "STREAM_ERROR",
      terminalErrorMessage: "durable mirror stopped",
    });

    assertEquals(terminalStates, []);
  });

  it("still finalizes through the exported hooks for every other mirror state", async () => {
    const otherReasons: ConversationRunMirrorDisableReason[] = [
      "cursor_resyncs_exhausted",
      "cursor_mismatch_ambiguous",
      "non_appendable",
      "ignorable_append_rejection",
      "payload_too_large",
      "auth_rejected",
    ];

    for (const disableReason of otherReasons) {
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const hooks = createHostedChatStreamFinalizationHooks({
        lifecycleAdapter: createLifecycleAdapter({
          durableRunMirror: createDisabledDurableRunMirror(disableReason),
          terminalStates,
        }),
        cleanup: async () => {},
        streamError: null,
      });

      await hooks.dispatchTerminalState({ status: "completed" });

      assertEquals(terminalStates.length, 1, `expected finalization for ${disableReason}`);
    }

    const undisabledTerminalStates: HostedLifecycleTerminalState[] = [];
    const undisabledHooks = createHostedChatStreamFinalizationHooks({
      lifecycleAdapter: createLifecycleAdapter({
        durableRunMirror: createDurableRunMirror({ chunks: [], flushes: [] }),
        terminalStates: undisabledTerminalStates,
      }),
      cleanup: async () => {},
      streamError: null,
    });

    await undisabledHooks.dispatchTerminalState({ status: "completed" });

    assertEquals(undisabledTerminalStates.length, 1);
  });

  it("creates a traced runtime bootstrap with merged abort signal and idempotent cleanup", async () => {
    const requestAbortController = new AbortController();
    const watchdogAbortController = new AbortController();
    const finalMessages: HostedChatRuntimeStreamInput["messages"] = [];
    let cleanupCount = 0;
    let traceCount = 0;
    let capturedMessages: HostedChatRuntimeStreamInput["messages"] | undefined;
    let capturedAbortSignal: AbortSignal | undefined;
    const agent: HostedChatRuntimeAgent = {
      stream: async (input) => {
        capturedMessages = input.messages;
        capturedAbortSignal = input.abortSignal;
        return createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        });
      },
    };

    const bootstrap = await createHostedChatExecutionRuntimeBootstrap({
      agent,
      cleanup: async () => {
        cleanupCount += 1;
      },
      lifecycleAdapter: createLifecycleAdapter(),
      durableRunEventMirror: createDurableRunMirror({ chunks: [], flushes: [] }),
      finalMessages,
      conversationId: "conversation-1",
      abortSignal: requestAbortController.signal,
      traceStream: async (operation) => {
        traceCount += 1;
        return await operation();
      },
      createRootStreamWatchdog: () =>
        createRootStreamWatchdog({
          signal: watchdogAbortController.signal,
        }),
    });

    assertEquals(traceCount, 1);
    assertEquals(capturedMessages, finalMessages);
    if (!capturedAbortSignal) {
      throw new Error("stream abort signal was not captured");
    }
    assertEquals(capturedAbortSignal.aborted, false);
    watchdogAbortController.abort();
    assertEquals(capturedAbortSignal.aborted, true);
    assertEquals(bootstrap.streamingMessageId, "stream-message-1");
    assertEquals(bootstrap.capturedMessageId, "stream-message-1");
    assertEquals(bootstrap.capturedConversationId, "conversation-1");

    await bootstrap.cleanup();
    await bootstrap.cleanup();

    assertEquals(cleanupCount, 1);
  });

  it("rejects a conversation runtime bootstrap without a durable stream message id", async () => {
    let streamCalls = 0;
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        streamCalls += 1;
        return createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        });
      },
    };

    await assertRejects(
      async () => {
        await createHostedChatExecutionRuntimeBootstrap({
          agent,
          cleanup: async () => {},
          lifecycleAdapter: createLifecycleAdapter({ messageId: null }),
          finalMessages: [],
          conversationId: "conversation-1",
          abortSignal: new AbortController().signal,
          createRootStreamWatchdog,
        });
      },
      Error,
      "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION",
    );
    assertEquals(streamCalls, 0);
  });

  it("rejects a durable runtime bootstrap without a private event mirror", async () => {
    let streamCalls = 0;
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        streamCalls += 1;
        return createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        });
      },
    };

    await assertRejects(
      () =>
        createHostedChatExecutionRuntimeBootstrap({
          agent,
          cleanup: async () => {},
          lifecycleAdapter: createLifecycleAdapter(),
          finalMessages: [],
          abortSignal: new AbortController().signal,
          createRootStreamWatchdog,
        }),
      DurableRunEventPersistenceError,
      "Durable hosted root run requires an authorized private event mirror",
    );
    assertEquals(streamCalls, 0);
  });

  it("keeps the root stream watchdog active while stream bootstrap is pending", async () => {
    using time = new FakeTime();
    let keepAliveCount = 0;
    let observeCount = 0;
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        await streamGate;
        return createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        });
      },
    };

    const bootstrapPromise = createHostedChatExecutionRuntimeBootstrap({
      agent,
      cleanup: async () => {},
      lifecycleAdapter: createLifecycleAdapter(),
      durableRunEventMirror: createDurableRunMirror({ chunks: [], flushes: [] }),
      finalMessages: [],
      abortSignal: new AbortController().signal,
      streamBootstrapKeepaliveIntervalMs: 1,
      createRootStreamWatchdog: () => ({
        ...createRootStreamWatchdog(),
        keepAlive: () => {
          keepAliveCount += 1;
        },
        observe: () => {
          observeCount += 1;
        },
      }),
    });

    try {
      time.tick(1);
      await Promise.resolve();

      assertEquals(keepAliveCount > 0, true);
      assertEquals(observeCount, 0);
    } finally {
      releaseStream();
      await bootstrapPromise;
    }
  });

  it("aborts stream bootstrap when the bootstrap timeout elapses", async () => {
    using time = new FakeTime();
    let disposeCount = 0;
    let streamAbortSignal: AbortSignal | undefined;
    const externalAbort = new AbortController();
    const agent: HostedChatRuntimeAgent = {
      stream: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          streamAbortSignal = abortSignal;
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), {
            once: true,
          });
        }),
    };

    const pending = createHostedChatExecutionRuntimeBootstrap({
      agent,
      cleanup: async () => {},
      lifecycleAdapter: createLifecycleAdapter(),
      durableRunEventMirror: createDurableRunMirror({ chunks: [], flushes: [] }),
      finalMessages: [],
      abortSignal: externalAbort.signal,
      streamBootstrapTimeoutMs: 50,
      streamBootstrapKeepaliveIntervalMs: 10,
      createRootStreamWatchdog: () =>
        createRootStreamWatchdog({
          disposed: () => {
            disposeCount += 1;
          },
        }),
    });

    time.tick(50);
    if (!streamAbortSignal?.aborted) {
      // Release the hung stream so a missing timeout fails instead of hanging the suite.
      externalAbort.abort(new Error("bootstrap timeout never fired"));
    }

    await assertRejects(
      () => pending,
      DOMException,
      "Chat stream bootstrap timeout after 50ms",
      "a hung stream bootstrap must be aborted by the watchdog timeout",
    );
    assertEquals(
      disposeCount,
      1,
      "root stream watchdog must be disposed when bootstrap fails",
    );
  });

  it("creates a bootstrapped hosted chat execution runtime", async () => {
    const tracer = createTracer();
    const finalMessages: HostedChatRuntimeStreamInput["messages"] = [];
    let traceStreamCount = 0;
    let capturedMessages: HostedChatRuntimeStreamInput["messages"] | undefined;
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    let activeDuringStream = false;
    let activeDuringToUi = false;
    let activeDuringIteration = false;
    const durableRunMirror = createDurableRunMirror({ chunks: [], flushes: [] });
    const agent: HostedChatRuntimeAgent = {
      stream: async (input) => {
        activeDuringStream = getActiveRunEventSink() !== undefined;
        capturedMessages = input.messages;
        return {
          steps: Promise.resolve([{}]),
          toUIMessageStream: (options) => {
            activeDuringToUi = getActiveRunEventSink() !== undefined;
            streamOptions = options;
            return (async function* () {
              activeDuringIteration = getActiveRunEventSink() !== undefined;
              yield { type: "start" } as ChatUiMessageChunk<MessageMetadata>;
            })();
          },
        };
      },
    };

    const bootstrapped = await createBootstrappedHostedChatExecutionRuntime({
      authToken: "token",
      apiUrl: "https://api.example.test",
      agent,
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      cleanup: async () => {},
      messages: [],
      finalMessages,
      conversationId: "conversation-1",
      projectId: "project-1",
      userId: "user-1",
      rootRunContext: {
        durableRootRun: {
          runId: "root-run-1",
          conversationId: "conversation-1",
          messageId: "stream-message-1",
          latestEventId: 0,
          latestExternalEventSequence: 0,
        },
        durableRunMirror,
        privateDurableRunMirror: durableRunMirror,
      },
      abortSignal: new AbortController().signal,
      responseMessageId: "response-message-1",
      tracer: tracer.tracer,
      resolveProvider: () => "openai",
      traceStream: async (operation) => {
        traceStreamCount += 1;
        return await operation();
      },
      createRootStreamWatchdog,
    });

    assertEquals(traceStreamCount, 1);
    assertEquals(tracer.contextCount, 1);
    assertEquals(capturedMessages, finalMessages);
    assertEquals(bootstrapped.execution.agentUIStream !== undefined, true);
    const iterator = bootstrapped.execution.agentUIStream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    assertEquals(activeDuringStream, true);
    assertEquals(activeDuringToUi, true);
    assertEquals(activeDuringIteration, true);
    assertEquals(streamOptions?.generateMessageId?.(), "response-message-1");
    assertEquals(tracer.attributes[0], {
      "conversation.id": "conversation-1",
      "project.id": "project-1",
      "user.id": "user-1",
      "agent.id": "agent-1",
      "run.id": "root-run-1",
      "message.id": "stream-message-1",
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.conversation.id": "conversation-1",
      "gen_ai.agent.id": "agent-1",
      "gen_ai.request.model": "openai/gpt-5.4",
    });
  });

  it("keeps the mandatory root sink when middleware scopes a public observer around next()", async () => {
    const order: string[] = [];
    const persisted: unknown[] = [];
    const observed: unknown[] = [];
    let providerDispatches = 0;
    let lazyScopeActive = false;
    const mirror = createDurableRunMirror({ chunks: [], flushes: [] });
    mirror.appendEvents = async (events) => {
      order.push("append");
      persisted.push(...events);
    };
    mirror.flush = async () => {
      order.push("flush");
      return mirror.getSnapshot();
    };
    const model = createStreamModel("test", "test/hosted-root", async () => {
      providerDispatches += 1;
      order.push("dispatch");
      return {
        stream: ReadableStream.from([
          { type: "text-delta", delta: "root ok" },
          { type: "finish", finishReason: "stop", usage: {} },
        ]),
      };
    });
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        const next = () =>
          streamText({
            model,
            system: "Hosted root instructions",
            messages: [{ role: "user", content: "Run root" }],
          });
        const result = runWithRunEventSink(
          (event) => {
            order.push("observe");
            observed.push(event);
          },
          next,
        );
        return {
          steps: Promise.resolve([{}]),
          toUIMessageStream: () =>
            (async function* () {
              lazyScopeActive = getActiveRunEventSink() !== undefined;
              const fullStream = result.fullStream as unknown as AsyncIterable<
                | { type: "text-delta"; text: string }
                | { type: "finish" }
              >;
              for await (const part of fullStream) {
                if (part.type === "text-delta" && "text" in part) {
                  yield { type: "text-delta", id: "root", delta: part.text } as const;
                }
              }
            })(),
        };
      },
    };
    const bootstrap = await createHostedChatExecutionRuntimeBootstrap({
      agent,
      cleanup: async () => {},
      lifecycleAdapter: createLifecycleAdapter({ durableRunMirror: mirror }),
      finalMessages: [],
      conversationId: "conversation-1",
      abortSignal: new AbortController().signal,
      durableRunEventMirror: mirror,
      createRootStreamWatchdog,
    });
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "test/hosted-root",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap,
    });

    const uiChunks: unknown[] = [];
    for await (const chunk of runtime.agentUIStream) {
      uiChunks.push(chunk);
    }

    assertEquals(order.slice(0, 4), ["append", "flush", "observe", "dispatch"]);
    assertEquals(providerDispatches, 1);
    assertEquals(
      persisted.filter((event) =>
        (event as { type?: string }).type === "AGENT_RUN_MODEL_CALL_CONTEXT"
      ).length,
      1,
    );
    const persistedContext = persisted.find((event) =>
      (event as { type?: string }).type === "AGENT_RUN_MODEL_CALL_CONTEXT"
    ) as Record<string, unknown> | undefined;
    assertEquals(
      typeof persistedContext?.elapsedMs === "number" &&
        Number.isFinite(persistedContext.elapsedMs) && persistedContext.elapsedMs >= 0,
      true,
    );
    assertEquals(
      typeof persistedContext?.emittedAt === "number" &&
        Number.isInteger(persistedContext.emittedAt) && persistedContext.emittedAt > 0,
      true,
    );
    assertEquals(observed, persisted.map(withoutEventTiming));
    assertEquals(JSON.stringify(uiChunks).includes("AGENT_RUN_MODEL_CALL_CONTEXT"), false);
    assertEquals(lazyScopeActive, true);
  });

  it("drains queued root events before a subsequent model dispatch", async () => {
    const order: string[] = [];
    const persisted: unknown[] = [];
    let pendingEventCount = 0;
    const mirror = createDurableRunMirror({ chunks: [], flushes: [] });
    mirror.handleChunk = async () => {
      pendingEventCount += 1;
      order.push("queue-ui");
    };
    mirror.appendEvents = async (events) => {
      pendingEventCount += events.length;
      persisted.push(...events);
      order.push("append-context");
    };
    mirror.flush = async () => {
      order.push("flush");
      pendingEventCount = 0;
      return mirror.getSnapshot();
    };
    mirror.getSnapshot = () => ({
      latestEventId: 0,
      latestExternalEventSequence: 0,
      pendingEventCount,
      consecutiveFailures: 0,
      disabled: false,
      hasFlushTimer: pendingEventCount > 0,
      hasRetryTimer: false,
      inFlight: false,
    });
    let dispatches = 0;
    const model = createStreamModel("test", "test/hosted-root-two-step", async () => {
      dispatches += 1;
      order.push(`dispatch-${dispatches}`);
      return {
        stream: ReadableStream.from([
          { type: "text-delta", delta: `step ${dispatches}` },
          { type: "finish", finishReason: "stop", usage: {} },
        ]),
      };
    });
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        const first = streamText({
          model,
          messages: [{ role: "user", content: "First step" }],
        });
        return {
          steps: Promise.resolve([{}, {}]),
          toUIMessageStream: () =>
            (async function* () {
              const firstStream = first.fullStream as unknown as AsyncIterable<
                | { type: "text-delta"; text: string }
                | { type: string }
              >;
              for await (const part of firstStream) {
                if (part.type === "text-delta" && "text" in part) {
                  yield { type: "text-delta", id: "root", delta: part.text } as const;
                }
              }
              const second = streamText({
                model,
                messages: [{ role: "user", content: "Second step" }],
              });
              const secondStream = second.fullStream as unknown as AsyncIterable<
                | { type: "text-delta"; text: string }
                | { type: string }
              >;
              for await (const part of secondStream) {
                if (part.type === "text-delta" && "text" in part) {
                  yield { type: "text-delta", id: "root", delta: part.text } as const;
                }
              }
            })(),
        };
      },
    };
    const bootstrap = await createHostedChatExecutionRuntimeBootstrap({
      agent,
      cleanup: async () => {},
      lifecycleAdapter: createLifecycleAdapter({ durableRunMirror: mirror }),
      finalMessages: [],
      conversationId: "conversation-1",
      abortSignal: new AbortController().signal,
      durableRunEventMirror: mirror,
      createRootStreamWatchdog,
    });
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "test/hosted-root-two-step",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap,
    });

    for await (const _chunk of runtime.agentUIStream) {
      // Consume both steps so the hosted mirror queues the first step before the second dispatch.
    }

    assertEquals(dispatches, 2);
    assertEquals(
      persisted.filter((event) =>
        (event as { type?: string }).type === "AGENT_RUN_MODEL_CALL_CONTEXT"
      ).length,
      2,
    );
    const secondDispatch = order.indexOf("dispatch-2");
    const secondContextFlush = order.lastIndexOf("flush", secondDispatch);
    const secondContextAppend = order.lastIndexOf("append-context", secondContextFlush);
    const priorEventFlush = order.lastIndexOf("flush", secondContextAppend - 1);
    const priorUiEvent = order.lastIndexOf("queue-ui", priorEventFlush);
    assertEquals(
      priorUiEvent < priorEventFlush && priorEventFlush < secondContextAppend &&
        secondContextAppend < secondContextFlush && secondContextFlush < secondDispatch,
      true,
    );
  });

  it("finalizes the agent run span when bootstrapping hosted chat execution fails", async () => {
    const tracer = createTracer();
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        throw new Error("stream startup failed");
      },
    };

    await assertRejects(
      async () => {
        await createBootstrappedHostedChatExecutionRuntime({
          authToken: "token",
          apiUrl: "https://api.example.test",
          agent,
          agentId: "agent-1",
          modelId: "openai/gpt-5.4",
          cleanup: async () => {},
          messages: [],
          finalMessages: [],
          projectId: null,
          userId: "user-1",
          rootRunContext: {
            durableRootRun: null,
            durableRunMirror: null,
            privateDurableRunMirror: null,
          },
          abortSignal: new AbortController().signal,
          tracer: tracer.tracer,
          resolveProvider: () => "openai",
        });
      },
      Error,
      "stream startup failed",
    );

    assertEquals(tracer.finishCount, 1);
    assertEquals(tracer.attributes.at(-1), {
      "agent.run.final_status": "failed",
      "gen_ai.provider.name": "openai",
      "gen_ai.response.model": "openai/gpt-5.4",
      "error.type": "STREAM_ERROR",
      "error.message": "stream startup failed",
    });
  });

  it("finalizes durable root runs when bootstrapping hosted chat execution fails", async () => {
    const tracer = createTracer();
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        throw new Error("stream startup failed");
      },
    };
    const durableRunMirror = createDurableRunMirror({ chunks: [], flushes: [] });

    await assertRejects(
      async () => {
        await createBootstrappedHostedChatExecutionRuntime({
          authToken: "token",
          apiUrl: "https://api.example.test",
          agent,
          agentId: "agent-1",
          modelId: "openai/gpt-5.4",
          cleanup: async () => {},
          messages: [],
          finalMessages: [],
          conversationId: "conversation-1",
          projectId: "project-1",
          userId: "user-1",
          rootRunContext: {
            durableRootRun: {
              runId: "root-run-1",
              conversationId: "conversation-1",
              messageId: "stream-message-1",
              latestEventId: 0,
              latestExternalEventSequence: 0,
            },
            durableRunMirror,
            privateDurableRunMirror: durableRunMirror,
          },
          abortSignal: new AbortController().signal,
          tracer: tracer.tracer,
          resolveProvider: () => "openai",
          createTerminalAdapter: (input) => ({
            toTerminalState: (state) => ({
              status: state.status,
              metadata: state.metadata ?? { modelId: input.fallbackModelId },
              ...(state.terminalErrorCode !== undefined
                ? { terminalErrorCode: state.terminalErrorCode }
                : {}),
              ...(state.terminalErrorMessage !== undefined
                ? { terminalErrorMessage: state.terminalErrorMessage }
                : {}),
            }),
            finalizeRun: async (state) => {
              terminalStates.push(state);
            },
            cancelRun: async (state) => {
              terminalStates.push(state);
            },
            onTerminalState: async (state) => {
              await input.onTerminalState?.(state);
            },
            dispatch: async (state) => {
              const terminalState = {
                status: state.status,
                metadata: state.metadata ?? { modelId: input.fallbackModelId },
                ...(state.terminalErrorCode !== undefined
                  ? { terminalErrorCode: state.terminalErrorCode }
                  : {}),
                ...(state.terminalErrorMessage !== undefined
                  ? { terminalErrorMessage: state.terminalErrorMessage }
                  : {}),
              };
              terminalStates.push(terminalState);
              await input.onTerminalState?.(terminalState);
              return terminalState;
            },
          }),
        });
      },
      Error,
      "stream startup failed",
    );

    assertEquals(terminalStates, [
      {
        status: "failed",
        metadata: { modelId: "openai/gpt-5.4" },
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "stream startup failed",
      },
    ]);
    assertEquals(tracer.finishCount, 1);
  });

  it("skips durable root run finalization on bootstrap failure when the run is already terminal", async () => {
    const tracer = createTracer();
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const observedTerminalStates: HostedLifecycleTerminalState[] = [];
    const agent: HostedChatRuntimeAgent = {
      stream: async () => {
        throw new Error("stream startup failed");
      },
    };
    const durableRunMirror = createDisabledDurableRunMirror("run_terminal");

    await assertRejects(
      async () => {
        await createBootstrappedHostedChatExecutionRuntime({
          authToken: "token",
          apiUrl: "https://api.example.test",
          agent,
          agentId: "agent-1",
          modelId: "openai/gpt-5.4",
          cleanup: async () => {},
          messages: [],
          finalMessages: [],
          conversationId: "conversation-1",
          projectId: "project-1",
          userId: "user-1",
          rootRunContext: {
            durableRootRun: {
              runId: "root-run-1",
              conversationId: "conversation-1",
              messageId: "stream-message-1",
              latestEventId: 0,
              latestExternalEventSequence: 0,
            },
            durableRunMirror,
            privateDurableRunMirror: durableRunMirror,
          },
          abortSignal: new AbortController().signal,
          tracer: tracer.tracer,
          resolveProvider: () => "openai",
          createTerminalAdapter: (input) => ({
            toTerminalState: (state) => ({
              status: state.status,
              metadata: state.metadata ?? { modelId: input.fallbackModelId },
              ...(state.terminalErrorCode !== undefined
                ? { terminalErrorCode: state.terminalErrorCode }
                : {}),
              ...(state.terminalErrorMessage !== undefined
                ? { terminalErrorMessage: state.terminalErrorMessage }
                : {}),
            }),
            finalizeRun: async (state) => {
              terminalStates.push(state);
            },
            cancelRun: async (state) => {
              terminalStates.push(state);
            },
            onTerminalState: async (state) => {
              observedTerminalStates.push(state);
              await input.onTerminalState?.(state);
            },
            dispatch: async (state) => {
              const terminalState = {
                status: state.status,
                metadata: state.metadata ?? { modelId: input.fallbackModelId },
                ...(state.terminalErrorCode !== undefined
                  ? { terminalErrorCode: state.terminalErrorCode }
                  : {}),
                ...(state.terminalErrorMessage !== undefined
                  ? { terminalErrorMessage: state.terminalErrorMessage }
                  : {}),
              };
              terminalStates.push(terminalState);
              await input.onTerminalState?.(terminalState);
              return terminalState;
            },
          }),
        });
      },
      Error,
      "stream startup failed",
    );

    // The durable completion call is skipped, but the local terminal-state
    // callback still runs so the stream is not left hanging.
    assertEquals(terminalStates, []);
    assertEquals(observedTerminalStates, [
      {
        status: "failed",
        metadata: { modelId: "openai/gpt-5.4" },
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "stream startup failed",
      },
    ]);
    assertEquals(tracer.finishCount, 1);
  });

  it("appends fallback chunks and flushes through the mirror", async () => {
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const flushes: string[] = [];
    const hooks = createHostedChatStreamFinalizationHooks({
      lifecycleAdapter: createLifecycleAdapter({
        durableRunMirror: createDurableRunMirror({ chunks, flushes }),
      }),
      cleanup: async () => {},
      streamError: null,
    });
    const chunk: ChatUiMessageChunk<MessageMetadata> = {
      type: "text-delta",
      id: "assistant-message-1",
      delta: "hello",
    };

    await hooks.appendFallbackChunk(chunk);
    await hooks.flushMirror();

    assertEquals(chunks, [chunk]);
    assertEquals(flushes, ["flush"]);
  });

  it("builds finalized response state and metadata without mirror fallback chunks", async () => {
    const buildState = createHostedChatFinalizeResponseBuildState({
      responseMessage: createResponseMessage({
        parts: [],
        metadata: {
          modelId: "gpt-test",
          usage: { inputTokens: 2, outputTokens: 3 },
        },
      }),
      isAborted: false,
      lifecycleAdapter: createLifecycleAdapter(),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
    });

    const state = await buildState({ text: "fallback text" });

    assertEquals(state.persistedMessage.parts, []);
    assertEquals(state.finalizedMessage.parts, [{ type: "text", text: "fallback text" }]);
    assertEquals(state.fallbackChunks, []);
    assertEquals(state.hasIncompleteToolParts, false);
    assertEquals(state.metadata, {
      modelId: "gpt-test",
      usage: { inputTokens: 2, outputTokens: 3 },
    });
  });

  it("builds detached fallback chunks only with content, mirror, and captured message id", async () => {
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const flushes: string[] = [];
    const buildState = createHostedChatFinalizeDetachedBuildState({
      capturedMessageId: "assistant-message-1",
      isAborted: false,
      lifecycleAdapter: createLifecycleAdapter({
        durableRunMirror: createDurableRunMirror({ chunks, flushes }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      mirroredDurableOutput: false,
      incompleteToolCallsPartErrorText: "Tool call did not complete",
    });

    const state = await buildState({ text: "detached fallback" });

    assertEquals(state, {
      hasContent: true,
      fallbackChunks: [
        { type: "text-start", id: "assistant-message-1" },
        { type: "text-delta", id: "assistant-message-1", delta: "detached fallback" },
        { type: "text-end", id: "assistant-message-1" },
      ],
      hasIncompleteToolParts: false,
    });
  });

  it("requires a durable stream message id when a conversation id is present", async () => {
    await assertRejects(
      async () => {
        const streamResult = createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        });
        createHostedChatExecutionRuntime({
          agentId: "agent-1",
          modelId: "openai/gpt-5.4",
          originalMessages: [],
          runContext: { withContext: (fn) => fn() },
          abortSignal: new AbortController().signal,
          bootstrap: {
            cleanup: async () => {},
            lifecycleAdapter: createLifecycleAdapter({ messageId: null }),
            rootStreamWatchdog: createRootStreamWatchdog(),
            streamResult,
            streamingMessageId: null,
            capturedMessageId: null,
            capturedConversationId: "conversation-1",
            mirroredToolChunkState: createMirroredToolChunkState(),
          },
        });
      },
      Error,
      "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION",
    );
  });

  it("wires stream metadata and response message ids into runtime stream options", () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const messageIds: string[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      responseMessageId: "response-message-1",
      runContext: {
        withContext: (fn) => fn(),
        setMessageId: (messageId) => {
          messageIds.push(messageId);
        },
      },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter(),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });

    assertEquals(runtime.agentUIStream !== undefined, true);
    assertEquals(messageIds, ["stream-message-1"]);
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }
    assertEquals(streamOptions.generateMessageId?.(), "response-message-1");
    assertEquals(
      streamOptions.messageMetadata?.({
        part: {
          type: "finish",
          finishReason: "stop",
          totalUsage: {
            inputTokens: 5,
            outputTokens: 7,
          },
        },
      }),
      {
        agentId: "agent-1",
        modelId: "openai/gpt-5.4",
        runId: "root-run-1",
        streamingMessageId: "stream-message-1",
        usage: {
          inputTokens: 5,
          outputTokens: 7,
        },
      },
    );
  });

  it("finalizes detached streams when the finish handler never runs", async () => {
    let disposed = 0;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog({
          disposed: () => {
            disposed += 1;
          },
        }),
        streamResult: createStreamResult({
          finalStep: { text: "detached fallback" },
          captureOptions: () => {},
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });

    await runtime.waitForFinish();

    assertEquals(terminalStates, [{ status: "completed" }]);
    assertEquals(disposed, 1);
  });

  it("uses response finish events instead of detached fallback when present", async () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    await streamOptions.onFinish?.({
      messages: [],
      isContinuation: false,
      responseMessage: createResponseMessage({ parts: [{ type: "text", text: "done" }] }),
      isAborted: false,
      finishReason: "stop",
    });
    await runtime.waitForFinish();

    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("marks the root run failed when response finalization itself rejects", async () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const durableRunMirror: ConversationRunChunkMirror = {
      ...createDurableRunMirror({ chunks: [], flushes: [] }),
      flush: async () => {
        throw new Error("flush failed");
      },
    };
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates, durableRunMirror }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    await streamOptions.onFinish?.({
      messages: [],
      isContinuation: false,
      responseMessage: createResponseMessage({ parts: [{ type: "text", text: "done" }] }),
      isAborted: false,
      finishReason: "stop",
    });
    await runtime.waitForFinish();

    assertEquals(terminalStates.length, 1, "a failed terminal state must be dispatched");
    assertEquals(terminalStates[0]?.status, "failed");
    assertEquals(
      terminalStates[0]?.terminalErrorCode,
      "STREAM_ERROR",
      "finalization failures must be classified as stream errors",
    );
    assertEquals(terminalStates[0]?.terminalErrorMessage, "flush failed");
  });

  it("fail disposes the watchdog, runs cleanup and marks the durable root run failed", async () => {
    const terminalStates: HostedLifecycleTerminalState[] = [];
    let disposed = 0;
    let cleanupCount = 0;
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {
          cleanupCount += 1;
        },
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog({
          disposed: () => {
            disposed += 1;
          },
        }),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });

    await runtime.fail(new Error("boom"));

    assertEquals(disposed, 1, "watchdog must be disposed on fail");
    assertEquals(cleanupCount, 1, "cleanup must run once on fail");
    assertEquals(
      terminalStates,
      [{ status: "failed", terminalErrorCode: "STREAM_ERROR", terminalErrorMessage: "boom" }],
      "durable root run must be finalized as failed",
    );
  });

  it("fail logs and resolves when marking the durable root run failed rejects", async () => {
    const { logger, errors } = createLogger();
    const lifecycleAdapter = createLifecycleAdapter();
    lifecycleAdapter.terminal.finalizeRun = async () => {
      throw new Error("finalize rejected");
    };
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      logger,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter,
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: () => {},
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });

    await runtime.fail(new Error("boom"));

    assertEquals(errors, [
      {
        message: "Failed to mark durable chat root run as failed",
        metadata: {
          conversationId: "conversation-1",
          runId: "root-run-1",
          error: "finalize rejected",
        },
      },
    ], "finalization failures inside fail must be logged rather than thrown");
  });

  it("stops cleanly when a late reasoning append finds a deleted run after local completion", async () => {
    let appendRequestCount = 0;
    const finalizeRequestStatuses: string[] = [];
    const errorLogs: string[] = [];
    const observedTerminalStatuses: string[] = [];
    const appendResponse = Promise.withResolvers<Response>();
    const resourceNotFoundFetch: typeof globalThis.fetch = () => {
      appendRequestCount += 1;
      return appendResponse.promise;
    };

    const durableRunMirror = createHostedConversationRunChunkMirror({
      authToken: "token",
      apiUrl: "https://api.example.test",
      conversationId: "conversation-1",
      runId: "root-run-1",
      latestEventId: 0,
      batchSize: 1,
      fetch: resourceNotFoundFetch,
      instrumentation: {
        error: (message) => {
          errorLogs.push(message);
        },
      },
    });
    const lifecycleAdapter = createLifecycleAdapter({ durableRunMirror });
    const rejectFinalize = async (state: HostedLifecycleTerminalState) => {
      finalizeRequestStatuses.push(state.status);
      throw new Error("resource-not-found");
    };
    lifecycleAdapter.terminal.finalizeRun = rejectFinalize;
    lifecycleAdapter.terminal.cancelRun = rejectFinalize;
    lifecycleAdapter.terminal.onTerminalState = async (state) => {
      observedTerminalStatuses.push(state.status);
    };
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      logger: {
        error: (message) => {
          errorLogs.push(message);
        },
        warn: () => {},
      },
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter,
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    await durableRunMirror.handleChunk({
      type: "reasoning-delta",
      id: "reasoning-1",
      delta: "late reasoning",
    });
    assertEquals(appendRequestCount, 1);
    const finishPromise = streamOptions.onFinish?.({
      messages: [],
      isContinuation: false,
      responseMessage: createResponseMessage({ parts: [{ type: "text", text: "done" }] }),
      isAborted: false,
      finishReason: "stop",
    });
    if (!finishPromise) {
      throw new Error("finish callback did not return its completion promise");
    }
    appendResponse.resolve(
      Response.json(
        {
          type: "https://api.veryfront.com/errors/resource-not-found",
          title: "Resource Not Found",
          status: 404,
          slug: "resource-not-found",
          category: "RESOURCE",
          detail: "Run not found",
          instance: "/conversations/conversation-1/runs/root-run-1/events",
          suggestion: "Verify the resource ID exists and you have access to it.",
        },
        { status: 404 },
      ),
    );
    await finishPromise;
    await runtime.waitForFinish();
    const drainedMirror = durableRunMirror.getSnapshot();
    durableRunMirror.dispose();

    assertEquals(
      {
        appendRequestCount,
        mirror: drainedMirror,
        finalizeRequestStatuses,
        errorLogs,
        observedTerminalStatuses,
      },
      {
        appendRequestCount: 1,
        mirror: {
          latestEventId: 0,
          latestExternalEventSequence: 0,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: true,
          hasFlushTimer: false,
          hasRetryTimer: false,
          inFlight: false,
          appendRequestCount: 1,
          disableReason: "run_terminal",
        },
        finalizeRequestStatuses: [],
        errorLogs: [],
        observedTerminalStatuses: ["completed"],
      },
    );
  });

  it("mirrors a pending knowledge source before response finalization flushes", async () => {
    const knowledgePath = "knowledge/product/limits.md";
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const lifecycleOrder: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];
    let resolveFinalizationFlush!: () => void;
    const finalizationFlushed = new Promise<void>((resolve) => {
      resolveFinalizationFlush = resolve;
    });
    const durableRunMirror = createDurableRunMirror({ chunks, flushes: lifecycleOrder });
    const handleChunk = durableRunMirror.handleChunk;
    const flush = durableRunMirror.flush;
    durableRunMirror.handleChunk = async (chunk) => {
      lifecycleOrder.push(chunk.type);
      await handleChunk(chunk);
    };
    durableRunMirror.flush = async () => {
      const snapshot = await flush();
      resolveFinalizationFlush();
      return snapshot;
    };
    const streamResult: HostedChatRuntimeStreamResult = {
      steps: Promise.resolve([{}]),
      toUIMessageStream: (options = {}) =>
        (async function* () {
          yield {
            type: "tool-input-available" as const,
            toolCallId: "tc-knowledge",
            toolName: "get_file",
            input: { path: knowledgePath },
          };
          yield {
            type: "tool-output-available" as const,
            toolCallId: "tc-knowledge",
            output: { path: knowledgePath, content: "# Limits" },
          };
          await options.onFinish?.({
            messages: [],
            isContinuation: false,
            responseMessage: createResponseMessage({
              parts: [{ type: "text", text: "The documented limit applies." }],
            }),
            isAborted: false,
            finishReason: "stop",
          });
          await finalizationFlushed;
          yield { type: "finish" as const, finishReason: "stop" as const };
        })(),
    };
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ durableRunMirror, terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult,
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    const outputChunks: ChatUiMessageChunk<MessageMetadata>[] = [];

    for await (const chunk of runtime.agentUIStream) {
      outputChunks.push(chunk);
    }
    await runtime.waitForFinish();

    const sourceChunk = {
      type: "source-document" as const,
      sourceId: knowledgePath,
      mediaType: "text/markdown",
      title: knowledgePath,
      filename: knowledgePath,
    };
    assertEquals(
      outputChunks.filter((chunk) => chunk.type === "source-document"),
      [sourceChunk],
    );
    assertEquals(
      chunks.filter((chunk) => chunk.type === "source-document"),
      [sourceChunk],
    );
    assertEquals(
      lifecycleOrder.indexOf("source-document") < lifecycleOrder.indexOf("flush"),
      true,
    );
    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("completes response finalization with provider-owned tool input still open", async () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "anthropic/claude-sonnet-4-5-20250929",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    await streamOptions.onFinish?.({
      messages: [],
      isContinuation: false,
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-web_fetch",
            toolCallId: "srvtoolu-fetch",
            input: { url: "https://example.com/docs" },
            state: "input-available",
            providerExecuted: true,
          },
        ],
      }),
      isAborted: false,
      finishReason: "stop",
    });
    await runtime.waitForFinish();

    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("completes response finalization with provider-owned web tool input still open", async () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "anthropic/claude-sonnet-4-5-20250929",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    await streamOptions.onFinish?.({
      messages: [],
      isContinuation: false,
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-web_fetch",
            toolCallId: "srvtoolu-fetch",
            input: { url: "https://veryfront.com/docs/agent/create-agent" },
            state: "input-available",
            providerExecuted: true,
          },
        ],
      }),
      isAborted: false,
      finishReason: "stop",
    });
    await runtime.waitForFinish();

    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("fails response finalization with a local web_fetch input still open", async () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    await streamOptions.onFinish?.({
      messages: [],
      isContinuation: false,
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-web_fetch",
            toolCallId: "local-fetch",
            input: { url: "https://veryfront.com/docs/agent/create-agent" },
            state: "input-available",
          },
        ],
      }),
      isAborted: false,
      finishReason: "stop",
    });
    await runtime.waitForFinish();

    assertEquals(terminalStates.length, 1);
    assertEquals(terminalStates[0]?.status, "failed");
    // The status alone does not identify the cause, and a local tool left at
    // `input-available` must fail for this reason rather than any other.
    assertEquals(terminalStates[0]?.terminalErrorCode, "INCOMPLETE_TOOL_CALLS");
  });

  it("records stream errors before detached finalization fallback", async () => {
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "openai/gpt-5.4",
      originalMessages: [],
      runContext: { withContext: (fn) => fn() },
      abortSignal: new AbortController().signal,
      bootstrap: {
        cleanup: async () => {},
        lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
        rootStreamWatchdog: createRootStreamWatchdog(),
        streamResult: createStreamResult({
          finalStep: { text: "detached fallback" },
          captureOptions: (options) => {
            streamOptions = options;
          },
        }),
        streamingMessageId: "stream-message-1",
        capturedMessageId: "stream-message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    if (!streamOptions) {
      throw new Error("stream options were not captured");
    }

    assertEquals(streamOptions.onError?.(new Error("stream failed")), "stream failed");
    await runtime.waitForFinish();

    assertEquals(terminalStates, [
      {
        status: "failed",
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "stream failed",
      },
    ]);
  });

  it("preserves coded canonical errors through the production stream callback", async () => {
    const cases = [
      {
        code: "INSUFFICIENT_CREDITS",
        message: "Agent run credit limit exceeded: 2 credits required, 1 remaining. " +
          "Start a new reviewed run or reduce the scope of this run.",
      },
      {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "Resource limit exceeded",
      },
      {
        code: "AI_PROVIDER_BILLING_ERROR",
        message:
          "The configured AI provider account cannot process this request. Try a different model, " +
          "or ask an administrator to check provider billing.",
      },
    ] as const;

    for (const expected of cases) {
      let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const runtime = createHostedChatExecutionRuntime({
        agentId: "agent-1",
        modelId: "openai/gpt-5.4",
        originalMessages: [],
        runContext: { withContext: (fn) => fn() },
        abortSignal: new AbortController().signal,
        bootstrap: {
          cleanup: async () => {},
          lifecycleAdapter: createLifecycleAdapter({ terminalStates }),
          rootStreamWatchdog: createRootStreamWatchdog(),
          streamResult: createStreamResult({
            finalStep: { text: "detached fallback" },
            captureOptions: (options) => {
              streamOptions = options;
            },
          }),
          streamingMessageId: "stream-message-1",
          capturedMessageId: "stream-message-1",
          capturedConversationId: "conversation-1",
          mirroredToolChunkState: createMirroredToolChunkState(),
        },
      });
      if (!streamOptions?.onError) {
        throw new Error("stream error callback was not captured");
      }

      assertEquals(
        Reflect.apply(streamOptions.onError, undefined, [expected.message, {
          code: expected.code,
        }]),
        expected.message,
      );
      await runtime.waitForFinish();

      assertEquals(terminalStates, [{
        status: "failed",
        terminalErrorCode: expected.code,
        terminalErrorMessage: expected.message,
      }]);
    }
  });
});
