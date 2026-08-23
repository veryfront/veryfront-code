import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import { createConversationHostedTerminalAdapter } from "../conversation/hosted-terminal.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorDisableReason } from "../conversation/run-mirror.ts";
import { createMirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import { finalizeHostedChatRun } from "./hosted-chat-finalization.ts";

function createDurableRunMirror(input: {
  calls: string[];
  chunks?: ChatUiMessageChunk<MessageMetadata>[];
  disableReason?: ConversationRunMirrorDisableReason;
}): ConversationRunChunkMirror {
  const snapshot = () => ({
    latestEventId: 0,
    latestExternalEventSequence: 0,
    pendingEventCount: 0,
    consecutiveFailures: 0,
    disabled: input.disableReason !== undefined,
    hasFlushTimer: false,
    hasRetryTimer: false,
    inFlight: false,
    ...(input.disableReason !== undefined ? { disableReason: input.disableReason } : {}),
  });

  return {
    handleChunk: async (chunk) => {
      input.calls.push(`append:${chunk.type}:${"id" in chunk ? chunk.id : ""}`);
      input.chunks?.push(chunk);
    },
    appendEvents: async () => {},
    flush: async () => {
      input.calls.push("flush");
      return snapshot();
    },
    getSnapshot: snapshot,
    dispose: () => {},
  };
}

function createLifecycleAdapter(input: {
  calls: string[];
  terminalStates?: HostedLifecycleTerminalState[];
  mirror?: ConversationRunChunkMirror | null;
}): HostedChatExecutionLifecycleAdapter {
  const terminalStates = input.terminalStates ?? [];
  return {
    durableRootRun: { runId: "root-run-1", messageId: "assistant-message-1" },
    durableRunMirror: input.mirror ?? null,
    terminal: {
      toTerminalState: (state) => state,
      finalizeRun: async (state) => {
        input.calls.push(`terminal:${state.status}:${state.terminalErrorCode ?? ""}`);
        terminalStates.push(state);
      },
      cancelRun: async (state) => {
        input.calls.push(`terminal:${state.status}:${state.terminalErrorCode ?? ""}`);
        terminalStates.push(state);
      },
      onTerminalState: async () => {},
    },
  };
}

function createStreamResult(finalStep: unknown): { steps: Promise<readonly unknown[]> } {
  return { steps: Promise.resolve([finalStep]) };
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

function createLogger() {
  const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  return {
    errors,
    logger: {
      error: (message: string, metadata?: Record<string, unknown>) => {
        errors.push({ message, ...(metadata ? { metadata } : {}) });
      },
    },
  };
}

function getToolOutputErrorChunks(
  chunks: readonly ChatUiMessageChunk<MessageMetadata>[],
  toolCallId: string,
): ChatUiMessageChunk<MessageMetadata>[] {
  return chunks.filter((chunk) =>
    chunk.type === "tool-output-error" && chunk.toolCallId === toolCallId
  );
}

describe("agent/hosted-chat-finalization", () => {
  it("appends response fallback chunks, flushes, dispatches completed, then cleanup", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({ text: "response fallback" }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls, [
      "append:text-start:assistant-message-1",
      "append:text-delta:assistant-message-1",
      "append:text-end:assistant-message-1",
      "flush",
      "terminal:completed:",
      "cleanup",
    ]);
    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("fails empty non-aborted response output before appending fallback chunks", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls, ["flush", "terminal:failed:EMPTY_RESPONSE", "cleanup"]);
    assertEquals(terminalStates.at(0)!.status, "failed");
    assertEquals(terminalStates.at(0)!.terminalErrorCode, "EMPTY_RESPONSE");
  });

  it("preserves response metadata on terminal states", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [{ type: "text", text: "done" }],
        metadata: {
          modelId: "test-model",
          usage: {
            inputTokens: 2,
            outputTokens: 3,
            cachedInputTokens: 1,
          },
        },
      }),
      isAborted: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({ calls, terminalStates }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(terminalStates, [
      {
        status: "completed",
        metadata: {
          modelId: "test-model",
          usage: {
            inputTokens: 2,
            outputTokens: 3,
            cachedInputTokens: 1,
          },
        },
      },
    ]);
  });

  it("posts canonical root usage capture status when finalizing a durable response", async () => {
    const requestBodies: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(
        JSON.stringify({
          completed: true,
          run: { runId: "run-1", status: "completed" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    try {
      const terminal = createConversationHostedTerminalAdapter({
        authToken: "token",
        apiUrl: "https://api.example.com",
        run: {
          conversationId: "conversation-1",
          runId: "run-1",
          messageId: "assistant-message-1",
          latestEventId: 0,
          latestExternalEventSequence: 0,
          waitingToolCallId: null,
          waitingToolName: null,
          streamProtocolVersion: 2,
          status: "running",
        },
        fallbackModelId: "fallback-model",
        resolveProvider: () => "test-provider",
      });

      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({
          parts: [{ type: "text", text: "done" }],
          metadata: {
            modelId: "test-model",
            usage: { inputTokens: 2, outputTokens: 3 },
            usageCaptureStatus: "complete",
          },
        }),
        isAborted: false,
        streamResult: createStreamResult({}),
        lifecycleAdapter: {
          durableRootRun: { runId: "run-1", messageId: "assistant-message-1" },
          durableRunMirror: null,
          terminal,
        },
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {},
        streamError: null,
      });

      assertEquals(requestBodies, [
        {
          status: "completed",
          metadata: {
            provider: "test-provider",
            model: "test-model",
            inputTokens: 2,
            outputTokens: 3,
            usageCaptureStatus: "complete",
            finishReason: "stop",
          },
          terminal_error_code: null,
          terminal_error_message: null,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats provider-owned input-available tool parts as completed", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
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
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({ calls, terminalStates }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("marks local unfinished tool parts as output-error and fails incomplete tool terminal state", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-web_fetch",
            toolCallId: "local-tool-1",
            input: { url: "https://example.com/docs" },
            state: "input-available",
          },
        ],
      }),
      isAborted: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls, chunks }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(
      chunks.some((chunk) =>
        chunk.type === "tool-output-error" &&
        chunk.toolCallId === "local-tool-1" &&
        chunk.errorText === "Tool call did not complete"
      ),
      true,
    );
    assertEquals(terminalStates.at(0)!.status, "failed");
    assertEquals(terminalStates.at(0)!.terminalErrorCode, "INCOMPLETE_TOOL_CALLS");
  });

  it("emits one output-error chunk for unfinished legacy tool parts", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-web_fetch",
            toolCallId: "legacy-tool-1",
            input: { url: "https://example.com/docs" },
            state: "input-available",
          },
        ],
      }),
      isAborted: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls, chunks }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(getToolOutputErrorChunks(chunks, "legacy-tool-1"), [
      {
        type: "tool-output-error",
        toolCallId: "legacy-tool-1",
        errorText: "Tool call did not complete",
      },
    ]);
  });

  for (
    const part of [
      {
        label: "dynamic-tool",
        value: {
          type: "dynamic-tool",
          toolName: "web_fetch",
          toolCallId: "dynamic-tool-1",
          input: { url: "https://example.com/docs" },
          state: "input-available",
        },
      },
      {
        label: "tool_call",
        value: {
          type: "tool_call",
          toolName: "web_fetch",
          toolCallId: "tool-call-1",
          input: { url: "https://example.com/docs" },
          state: "input-available",
        },
      },
    ] as const
  ) {
    it(`emits one output-error chunk for unfinished ${part.label} response parts`, async () => {
      const calls: string[] = [];
      const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];

      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({
          parts: [
            { type: "text", text: "done" },
            part.value,
          ],
        }),
        isAborted: false,
        streamResult: createStreamResult({}),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror: createDurableRunMirror({ calls, chunks }),
        }),
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: null,
      });

      assertEquals(getToolOutputErrorChunks(chunks, part.value.toolCallId), [
        {
          type: "tool-output-error",
          toolCallId: part.value.toolCallId,
          errorText: "Tool call did not complete",
        },
      ]);
    });
  }

  it("emits one output-error chunk for detached unfinished fallback tools", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "detached",
      isAborted: false,
      mirroredDurableOutput: false,
      streamResult: createStreamResult({
        toolCalls: [
          {
            toolCallId: "detached-tool-1",
            toolName: "web_fetch",
            input: { url: "https://example.com/docs" },
          },
        ],
      }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls, chunks }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(getToolOutputErrorChunks(chunks, "detached-tool-1"), [
      {
        type: "tool-output-error",
        toolCallId: "detached-tool-1",
        errorText: "Tool call did not complete",
      },
    ]);
  });

  it("appends detached fallback chunks when no durable output was mirrored", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "detached",
      isAborted: false,
      mirroredDurableOutput: false,
      streamResult: createStreamResult({ text: "detached fallback" }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls, [
      "append:text-start:assistant-message-1",
      "append:text-delta:assistant-message-1",
      "append:text-end:assistant-message-1",
      "flush",
      "terminal:completed:",
      "cleanup",
    ]);
    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("fails detached empty output only without mirrored output or fallback content", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "detached",
      isAborted: false,
      mirroredDurableOutput: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls, ["flush", "terminal:failed:EMPTY_RESPONSE", "cleanup"]);
    assertEquals(terminalStates.at(0)!.status, "failed");
    assertEquals(terminalStates.at(0)!.terminalErrorCode, "EMPTY_RESPONSE");
  });

  it("completes detached empty output when durable output was mirrored", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "detached",
      isAborted: false,
      mirroredDurableOutput: true,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls, ["flush", "terminal:completed:", "cleanup"]);
    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  for (const kind of ["response", "detached"] as const) {
    it(`dispatches failed stream error after fallback append and flush in ${kind} mode`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const common = {
        isAborted: false,
        streamResult: createStreamResult({ text: `${kind} fallback` }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror: createDurableRunMirror({ calls }),
        }),
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: new Error("provider stream failed"),
      };

      await finalizeHostedChatRun(
        kind === "response"
          ? {
            ...common,
            kind,
            responseMessage: createResponseMessage({ parts: [] }),
          }
          : {
            ...common,
            kind,
            mirroredDurableOutput: false,
          },
      );

      assertEquals(calls, [
        "append:text-start:assistant-message-1",
        "append:text-delta:assistant-message-1",
        "append:text-end:assistant-message-1",
        "flush",
        "terminal:failed:STREAM_ERROR",
        "cleanup",
      ]);
      assertEquals(terminalStates.at(0)!.terminalErrorMessage, "provider stream failed");
    });
  }

  for (const kind of ["response", "detached"] as const) {
    it(`completes ${kind} mode when a late body-read error follows a completed final step`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const common = {
        isAborted: false,
        streamResult: createStreamResult({
          text: `${kind} fallback`,
          finishReason: "stop",
        }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror: createDurableRunMirror({ calls }),
        }),
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: new Error("error reading a body from connection"),
      };

      await finalizeHostedChatRun(
        kind === "response"
          ? {
            ...common,
            kind,
            responseMessage: createResponseMessage({ parts: [] }),
          }
          : {
            ...common,
            kind,
            mirroredDurableOutput: false,
          },
      );

      assertEquals(terminalStates, [{ status: "completed" }]);
    });
  }

  it("preserves delivered output when a trailing model step fails after a completed tool handoff", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({
        text: "The environment panel is open and ready.",
        finishReason: "tool-calls",
      }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: new Error("Provider request failed with status 502"),
    });

    assertEquals(terminalStates, [{ status: "completed" }]);
  });

  it("fails a watchdog timeout after a completed tool handoff", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({
        text: "The environment panel is open and ready.",
        finishReason: "tool-calls",
      }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: new Error("Chat stream idle timeout after 300000ms"),
    });

    assertEquals(terminalStates, [{
      status: "failed",
      terminalErrorCode: "STREAM_TIMEOUT",
      terminalErrorMessage:
        "This run timed out after 5 minutes before the agent finished. Try again to continue, or narrow the request.",
    }]);
  });

  it("logs and suppresses cleanup errors after terminal dispatch", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const { logger, errors } = createLogger();

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [{ type: "text", text: "done" }] }),
      isAborted: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({ calls, terminalStates }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
        throw new Error("cleanup failed");
      },
      logger,
      streamError: null,
    });

    assertEquals(calls, ["terminal:completed:", "cleanup"]);
    assertEquals(terminalStates, [{ status: "completed" }]);
    assertEquals(errors, [
      {
        message: "Runtime cleanup failed during finalization",
        metadata: { error: "cleanup failed" },
      },
    ]);
  });
  // veryfront-issue-inbox#743: once the API has rejected an append with
  // "Cannot append external events to a terminal run", the run is finished
  // server-side and its row may already be gone. Completing it afterwards can only
  // 400, so finalization must be skipped entirely rather than attempted and logged.
  it("skips durable run finalization when the mirror stopped on an already-terminal run", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const { errors, logger } = createLogger();

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({ text: "response fallback" }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls, disableReason: "run_terminal" }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      logger,
      streamError: null,
    });

    assertEquals(calls.filter((call) => call.startsWith("terminal:")), []);
    assertEquals(terminalStates, []);
    assertEquals(calls.at(-1), "cleanup");
    assertEquals(errors, []);
  });

  it("skips durable run finalization on the empty-response failure path too", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({}),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls, disableReason: "run_terminal" }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls, ["flush", "cleanup"]);
    assertEquals(terminalStates, []);
  });

  // The critical guard: every other mirror stop leaves a live run that still needs
  // completing. Only `run_terminal` may skip finalization -- widening this would
  // trade a noisy bug for runs stranded in `running` forever.
  it("still finalizes the durable run for every other mirror stop reason", async () => {
    const otherReasons: ConversationRunMirrorDisableReason[] = [
      "cursor_resyncs_exhausted",
      "cursor_mismatch_ambiguous",
      "non_appendable",
      "ignorable_append_rejection",
      "payload_too_large",
      "auth_rejected",
    ];

    for (const disableReason of otherReasons) {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];

      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({ parts: [] }),
        isAborted: false,
        streamResult: createStreamResult({ text: "response fallback" }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror: createDurableRunMirror({ calls, disableReason }),
        }),
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: null,
      });

      assertEquals(
        calls.filter((call) => call.startsWith("terminal:")),
        ["terminal:completed:"],
        `expected ${disableReason} to still finalize the durable run`,
      );
      assertEquals(terminalStates, [{ status: "completed" }]);
    }
  });

  it("still finalizes the durable run when the mirror never stopped", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: false,
      streamResult: createStreamResult({ text: "response fallback" }),
      lifecycleAdapter: createLifecycleAdapter({
        calls,
        terminalStates,
        mirror: createDurableRunMirror({ calls }),
      }),
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(calls.filter((call) => call.startsWith("terminal:")), ["terminal:completed:"]);
  });
});
