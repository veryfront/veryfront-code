import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import type { HostedAgentRunSpan, HostedAgentRunTracer } from "./agent-run-lifecycle.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeStreamInput,
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

function createRootStreamWatchdog(input?: {
  disposed?: () => void;
  signal?: AbortSignal;
}): HostedChatExecutionRootStreamWatchdog {
  return {
    signal: input?.signal ?? new AbortController().signal,
    get lastTimeoutState() {
      return null;
    },
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

  it("creates a bootstrapped hosted chat execution runtime", async () => {
    const tracer = createTracer();
    const finalMessages: HostedChatRuntimeStreamInput["messages"] = [];
    let traceStreamCount = 0;
    let capturedMessages: HostedChatRuntimeStreamInput["messages"] | undefined;
    let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
    const agent: HostedChatRuntimeAgent = {
      stream: async (input) => {
        capturedMessages = input.messages;
        return createStreamResult({
          finalStep: {},
          captureOptions: (options) => {
            streamOptions = options;
          },
        });
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
        durableRunMirror: null,
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
    assertEquals(streamOptions?.generateMessageId?.(), "response-message-1");
    assertEquals(tracer.attributes[0], {
      "conversation.id": "conversation-1",
      "project.id": "project-1",
      "user.id": "user-1",
      "agent.id": "agent-1",
      "run.id": "root-run-1",
      "message.id": "stream-message-1",
      "gen_ai.operation.name": "chat",
      "gen_ai.conversation.id": "conversation-1",
      "gen_ai.agent.id": "agent-1",
    });
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
});
