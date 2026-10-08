import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import { isRecord } from "#veryfront/chat/conversation.ts";
import { createChatStreamMessageProjection } from "#veryfront/agent/react/use-chat/streaming/handler.ts";
import { finalizeConversationAgentRun } from "../conversation/durable.ts";
import { createConversationHostedTerminalAdapter } from "../conversation/hosted-terminal.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorDisableReason } from "../conversation/run-mirror.ts";
import { createMirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import { finalizeHostedChatRun } from "./hosted-chat-finalization.ts";
import {
  createRunBoundAgentManualPause,
  inheritHostedAgentPauseCapability,
} from "./manual-pause-credential.ts";
import {
  canSettleHostedAgentPause,
  recordHostedAgentPauseCleanup,
} from "./manual-pause-settlement.ts";

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
  it("fails streamed empty reasoning shells with the canonical empty response error", async () => {
    for (const extra of [{}, { signature: "" }, { redactedData: "" }]) {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({
          parts: [
            { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
            { type: "reasoning", text: "", ...extra },
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
        streamError: null,
        cleanup: async () => {},
      });
      assertEquals(terminalStates[0]!.status, "failed");
      assertEquals(terminalStates[0]!.terminalErrorCode, "EMPTY_RESPONSE");
      assertEquals(chunks, []);
    }
  });

  it("preserves append-only replay when earlier reasoning recovers after exact or partial text", async () => {
    for (const partial of [true, false]) {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
      const original = { type: "text" as const, text: partial ? "Hello" : "Done" };
      const reasoning = { type: "reasoning" as const, text: "Why", signature: "sig" };
      const finalText = partial ? "Hello world" : "Done";
      const projection = createChatStreamMessageProjection("assistant-message-1");
      projection.append({ type: "text-start", id: "assistant-message-1" });
      projection.append({ type: "text-delta", id: "assistant-message-1", delta: original.text });
      projection.append({ type: "text-end", id: "assistant-message-1" });
      const mirror = createDurableRunMirror({ calls, chunks });
      const accept = mirror.handleChunk;
      mirror.handleChunk = async (chunk) => {
        await accept(chunk);
        if (chunk.type === "finish") throw new Error("Unexpected finish in fallback content");
        projection.append(chunk);
      };
      const canonicalProjectionParts = () =>
        projection.snapshot().parts.map((part) => {
          if (
            (part.type === "text" || part.type === "reasoning") && "state" in part &&
            part.state === "done"
          ) {
            const { state: _uiPhase, ...canonical } = part;
            return canonical;
          }
          return part;
        });
      const input = {
        kind: "response" as const,
        responseMessage: createResponseMessage({ parts: [original] }),
        isAborted: false,
        streamResult: createStreamResult({
          response: {
            messages: [{
              role: "assistant",
              content: [reasoning, { type: "text", text: finalText }],
            }],
          },
        }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror,
        }),
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        streamError: null,
        cleanup: async () => {},
      };
      await finalizeHostedChatRun(input);
      const output = terminalStates[0]!.output as ChatUiMessage;
      assertEquals<unknown>(canonicalProjectionParts(), output.parts);
      assertEquals(output.parts, [
        original,
        reasoning,
        ...(partial ? [{ type: "text" as const, text: "world" }] : []),
      ]);
      assertEquals(chunks.map((chunk) => chunk.type), [
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        ...(partial ? ["text-start", "text-delta", "text-end"] : []),
      ]);
      chunks.length = 0;
      await finalizeHostedChatRun({ ...input, responseMessage: output });
      assertEquals(terminalStates[1]!.output, output);
      assertEquals<unknown>(canonicalProjectionParts(), output.parts);
      assertEquals(chunks, []);
    }
  });
  for (const reasoning of [true, false]) {
    it(`appends recovered ${reasoning ? "reasoning" : "text suffix"} after the persisted tool while completing its output`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
      const mirrored = createMirroredToolChunkState();
      mirrored.startedToolCallIds.add("c");
      mirrored.inputAvailableToolCallIds.add("c");
      const tool = {
        type: "tool-bash" as const,
        toolName: "bash",
        toolCallId: "c",
        state: "input-available" as const,
        input: { command: "x" },
        providerExecuted: true,
      };
      const projection = createChatStreamMessageProjection("assistant-message-1");
      if (!reasoning) {
        projection.append({ type: "text-start", id: "assistant-message-1" });
        projection.append({ type: "text-delta", id: "assistant-message-1", delta: "Hello" });
        projection.append({ type: "text-end", id: "assistant-message-1" });
      }
      projection.append({
        type: "tool-input-start",
        toolCallId: "c",
        toolName: "bash",
        providerExecuted: true,
      });
      projection.append({
        type: "tool-input-available",
        toolCallId: "c",
        toolName: "bash",
        input: { command: "x" },
        providerExecuted: true,
      });
      const mirror = createDurableRunMirror({ calls, chunks });
      const accept = mirror.handleChunk;
      mirror.handleChunk = async (chunk) => {
        await accept(chunk);
        if (chunk.type === "finish") throw new Error("Unexpected finish in fallback content");
        projection.append(chunk);
      };
      const canonicalProjectionParts = () =>
        projection.snapshot().parts.map((part) => {
          if (
            (part.type === "text" || part.type === "reasoning") && "state" in part &&
            part.state === "done"
          ) {
            const { state: _uiPhase, ...canonical } = part;
            return canonical;
          }
          return part;
        });
      const input = {
        kind: "response",
        responseMessage: createResponseMessage({
          parts: [...(reasoning ? [] : [{ type: "text" as const, text: "Hello" }]), tool],
        }),
        isAborted: false,
        streamResult: createStreamResult({
          response: {
            messages: [{
              role: "assistant",
              content: [
                reasoning
                  ? { type: "reasoning", text: "Why", signature: "sig" }
                  : { type: "text", text: "Hello world" },
                { type: "tool-call", toolCallId: "c", toolName: "bash", input: { command: "x" } },
                { type: "tool-result", toolCallId: "c", toolName: "bash", output: "ok" },
              ],
            }],
          },
        }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror,
        }),
        mirroredToolChunkState: mirrored,
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: null,
      } satisfies Parameters<typeof finalizeHostedChatRun>[0];
      await finalizeHostedChatRun(input);
      assertEquals(terminalStates[0]!.status, "completed");
      assertEquals((terminalStates[0]!.output as ChatUiMessage).parts, [
        ...(reasoning ? [] : [{ type: "text" as const, text: "Hello" }]),
        { ...tool, state: "output-available" as const, output: "ok" },
        reasoning
          ? { type: "reasoning" as const, text: "Why", signature: "sig" }
          : { type: "text" as const, text: "world" },
      ]);
      assertEquals(
        chunks.map((chunk) => chunk.type),
        reasoning
          ? ["reasoning-start", "reasoning-delta", "reasoning-end", "tool-output-available"]
          : ["text-start", "text-delta", "text-end", "tool-output-available"],
      );
      assertEquals(chunks.at(-1), {
        type: "tool-output-available",
        toolCallId: "c",
        output: "ok",
        providerExecuted: true,
      });
      assertEquals(calls.slice(-3), ["flush", "terminal:completed:", "cleanup"]);
      const firstOutput = terminalStates[0]!.output as ChatUiMessage;
      assertEquals<unknown>(canonicalProjectionParts(), firstOutput.parts);
      chunks.length = 0;
      calls.length = 0;
      await finalizeHostedChatRun({ ...input, responseMessage: firstOutput });
      assertEquals(terminalStates[1]!.output, firstOutput);
      assertEquals<unknown>(canonicalProjectionParts(), firstOutput.parts);
      assertEquals(chunks, []);
      assertEquals(calls, ["flush", "terminal:completed:", "cleanup"]);
      const rejectedState = createMirroredToolChunkState();
      rejectedState.startedToolCallIds.add("c");
      rejectedState.inputAvailableToolCallIds.add("c");
      const rejectedMirror = createDurableRunMirror({ calls });
      rejectedMirror.handleChunk = async () => {
        throw new Error("mirror rejected");
      };
      let rejection: unknown;
      try {
        await finalizeHostedChatRun({
          ...input,
          responseMessage: firstOutput,
          mirroredToolChunkState: rejectedState,
          lifecycleAdapter: createLifecycleAdapter({ calls, mirror: rejectedMirror }),
        });
      } catch (error) {
        rejection = error;
      }
      assertEquals(rejection instanceof Error ? rejection.message : rejection, "mirror rejected");
      assertEquals(rejectedState.outputAvailableToolCallIds.has("c"), false);
    });
  }
  for (const partialTool of [true, false]) {
    it(`completes ${partialTool ? "persisted tool input" : "partial text before tool"} with coherent terminal and replay`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
      const mirrored = createMirroredToolChunkState();
      if (partialTool) {
        mirrored.startedToolCallIds.add("c");
        mirrored.inputAvailableToolCallIds.add("c");
      }
      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({
          parts: partialTool
            ? [{
              type: "tool-bash",
              toolCallId: "c",
              state: "input-available",
              input: { command: "x" },
            }]
            : [{ type: "text", text: "Hello" }],
        }),
        isAborted: false,
        streamResult: createStreamResult({
          response: {
            messages: [{
              role: "assistant",
              content: [
                ...(partialTool ? [] : [{ type: "text", text: "Hello world" }]),
                { type: "tool-call", toolCallId: "c", toolName: "bash", input: { command: "x" } },
                { type: "tool-result", toolCallId: "c", toolName: "bash", output: "ok" },
              ],
            }],
          },
        }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror: createDurableRunMirror({ calls, chunks }),
        }),
        mirroredToolChunkState: mirrored,
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: null,
      });
      assertEquals(terminalStates[0]!.status, "completed");
      const parts = (terminalStates[0]!.output as ChatUiMessage).parts;
      if (partialTool) {
        assertEquals(parts, [{
          type: "tool-bash",
          toolCallId: "c",
          state: "output-available",
          input: { command: "x" },
          output: "ok",
        }]);
        assertEquals(chunks, [{ type: "tool-output-available", toolCallId: "c", output: "ok" }]);
      } else {
        assertEquals(parts.map((part) => part.type), ["text", "text", "dynamic-tool"]);
        assertEquals(parts[1], { type: "text", text: "world" });
        assertEquals(chunks.map((chunk) => chunk.type), [
          "text-start",
          "text-delta",
          "text-end",
          "tool-input-start",
          "tool-input-available",
          "tool-output-available",
        ]);
        assertEquals(chunks[1], {
          type: "text-delta",
          id: "assistant-message-1",
          delta: "world",
        });
      }
      assertEquals(calls.slice(-3), ["flush", "terminal:completed:", "cleanup"]);
    });
  }
  for (const toolState of ["input-streaming", "pending"] as const) {
    it(`completes ${toolState} tool input with coherent terminal and replay`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
      const mirrored = createMirroredToolChunkState();
      mirrored.startedToolCallIds.add("c");
      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({
          parts: [{
            type: "tool-bash",
            toolCallId: "c",
            state: toolState,
            input: { command: "partial" },
          }],
        }),
        isAborted: false,
        streamResult: createStreamResult({
          response: {
            messages: [{
              role: "assistant",
              content: [
                { type: "tool-call", toolCallId: "c", toolName: "bash", input: { command: "x" } },
                { type: "tool-result", toolCallId: "c", toolName: "bash", output: "ok" },
              ],
            }],
          },
        }),
        lifecycleAdapter: createLifecycleAdapter({
          calls,
          terminalStates,
          mirror: createDurableRunMirror({ calls, chunks }),
        }),
        mirroredToolChunkState: mirrored,
        capturedMessageId: "assistant-message-1",
        incompleteToolCallsPartErrorText: "Tool call did not complete",
        cleanup: async () => {
          calls.push("cleanup");
        },
        streamError: null,
      });
      assertEquals(terminalStates[0]!.status, "completed");
      const parts = (terminalStates[0]!.output as ChatUiMessage).parts;
      assertEquals(parts, [{
        type: "tool-bash",
        toolCallId: "c",
        state: "output-available",
        input: { command: "x" },
        output: "ok",
      }]);
      assertEquals(chunks, [{
        type: "tool-input-available",
        toolCallId: "c",
        toolName: "bash",
        input: { command: "x" },
      }, { type: "tool-output-available", toolCallId: "c", output: "ok" }]);
      const projection = createChatStreamMessageProjection("assistant-message-1");
      projection.append({ type: "tool-input-start", toolCallId: "c", toolName: "bash" });
      projection.append({
        type: "tool-input-delta",
        toolCallId: "c",
        inputTextDelta: '{"command":"partial',
      });
      for (const chunk of chunks) {
        if (chunk.type === "finish") throw new Error("Unexpected finish in fallback content");
        projection.append(chunk);
      }
      assertEquals<unknown>(projection.snapshot().parts, [{ ...parts[0], toolName: "bash" }]);
      assertEquals(calls.slice(-3), ["flush", "terminal:completed:", "cleanup"]);
    });
  }
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
    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
      status: "completed",
    }]);
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

  it("fails response output with only runtime metadata and stream framing", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [
          { type: "step-start" },
          {
            type: "data-veryfront.runtime_context",
            data: {
              currentDateUtc: "2026-10-07",
              currentTimeUtc: "09:30:41",
              runStartedAtUtc: "2026-10-07T09:30:40.526Z",
            },
          },
        ],
      }),
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

  for (const text of ["", " \n\t"]) {
    it(`fails blank text shell ${JSON.stringify(text)} beside runtime metadata`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];

      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({
          parts: [
            { type: "step-start" },
            { type: "text", text },
            {
              type: "data-veryfront.runtime_context",
              data: {
                currentDateUtc: "2026-10-07",
                currentTimeUtc: "09:30:41",
                runStartedAtUtc: "2026-10-07T09:30:40.526Z",
              },
            },
          ],
        }),
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
  }

  it("completes runtime-metadata-only response output with final-step tool fallback", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [{
          type: "data-veryfront.runtime_context",
          data: { currentDateUtc: "2026-10-07" },
        }],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        toolCalls: [{
          toolCallId: "fallback-tool-1",
          toolName: "form_input",
          input: { title: "Continue?" },
        }],
        toolResults: [{
          toolCallId: "fallback-tool-1",
          toolName: "form_input",
          input: { title: "Continue?" },
          output: { submitted: true },
        }],
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
      streamError: null,
    });

    assertEquals(calls, [
      "append:tool-input-start:",
      "append:tool-input-available:",
      "append:tool-output-available:",
      "flush",
      "terminal:completed:",
      "cleanup",
    ]);
    assertEquals(terminalStates.at(0)!.status, "completed");
  });

  it("completes runtime-metadata-only response output with final-step reasoning fallback", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [{
          type: "data-veryfront.runtime_context",
          data: { currentDateUtc: "2026-10-07" },
        }],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        response: {
          messages: [{
            role: "assistant",
            content: [{
              type: "reasoning",
              text: "Checking the retained state.",
              signature: "sig_123",
            }],
          }],
        },
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

    assertEquals(calls, [
      "append:reasoning-start:assistant-message-1:reasoning",
      "append:reasoning-delta:assistant-message-1:reasoning",
      "append:reasoning-end:assistant-message-1:reasoning",
      "flush",
      "terminal:completed:",
      "cleanup",
    ]);
    assertEquals(chunks, [
      { type: "reasoning-start", id: "assistant-message-1:reasoning" },
      {
        type: "reasoning-delta",
        id: "assistant-message-1:reasoning",
        delta: "Checking the retained state.",
      },
      {
        type: "reasoning-end",
        id: "assistant-message-1:reasoning",
        signature: "sig_123",
      },
    ]);
    assertEquals(terminalStates.at(0)!.status, "completed");
    assertEquals((terminalStates.at(0)!.output as ChatUiMessage).parts, [
      { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
      { type: "reasoning", text: "Checking the retained state.", signature: "sig_123" },
    ]);
  });

  it("recovers each missing final-step reasoning block into terminal output and durable replay", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [
          {
            type: "data-veryfront.runtime_context",
            data: { currentDateUtc: "2026-10-07" },
          },
          { type: "reasoning", text: "First thought.", signature: "sig_first" },
        ],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        response: {
          messages: [{
            role: "assistant",
            content: [
              { type: "reasoning", text: "First thought.", signature: "sig_first" },
              { type: "reasoning", text: "Second thought.", signature: "sig_second" },
            ],
          }],
        },
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

    assertEquals(chunks, [
      { type: "reasoning-start", id: "assistant-message-1:reasoning" },
      {
        type: "reasoning-delta",
        id: "assistant-message-1:reasoning",
        delta: "Second thought.",
      },
      {
        type: "reasoning-end",
        id: "assistant-message-1:reasoning",
        signature: "sig_second",
      },
    ]);
    assertEquals((terminalStates.at(0)!.output as ChatUiMessage).parts, [
      {
        type: "data-veryfront.runtime_context",
        data: { currentDateUtc: "2026-10-07" },
      },
      { type: "reasoning", text: "First thought.", signature: "sig_first" },
      { type: "reasoning", text: "Second thought.", signature: "sig_second" },
    ]);
  });

  it("mirrors only the missing suffix of a later final-step text block", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];
    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "First answer." },
          { type: "text", text: "Sec" },
        ],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        response: {
          messages: [{
            role: "assistant",
            content: [
              { type: "text", text: "First answer." },
              { type: "text", text: "Second answer." },
            ],
          }],
        },
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
    assertEquals(chunks, [
      { type: "text-start", id: "assistant-message-1" },
      { type: "text-delta", id: "assistant-message-1", delta: "ond answer." },
      { type: "text-end", id: "assistant-message-1" },
    ]);
    assertEquals(terminalStates.at(0)!.status, "completed");
    assertEquals((terminalStates.at(0)!.output as ChatUiMessage).parts, [
      { type: "text", text: "First answer." },
      { type: "text", text: "Sec" },
      { type: "text", text: "ond answer." },
    ]);
  });

  it("fails runtime-metadata-only response output with an empty final-step reasoning shell", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [{
          type: "data-veryfront.runtime_context",
          data: { currentDateUtc: "2026-10-07" },
        }],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        response: {
          messages: [{
            role: "assistant",
            content: [{ type: "reasoning", text: "" }],
          }],
        },
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
      streamError: null,
    });

    assertEquals(calls, ["flush", "terminal:failed:EMPTY_RESPONSE", "cleanup"]);
    assertEquals(terminalStates.at(0)!.status, "failed");
    assertEquals(terminalStates.at(0)!.terminalErrorCode, "EMPTY_RESPONSE");
  });

  it("preserves text-before-tool fallback stream ordering after runtime metadata", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [{
          type: "data-veryfront.runtime_context",
          data: { currentDateUtc: "2026-10-07" },
        }],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        response: {
          messages: [{
            role: "assistant",
            content: [
              { type: "text", text: "Checking now." },
              {
                type: "tool-call",
                toolCallId: "fallback-tool-1",
                toolName: "form_input",
                input: { title: "Continue?" },
              },
              {
                type: "tool-result",
                toolCallId: "fallback-tool-1",
                toolName: "form_input",
                output: { submitted: true },
              },
            ],
          }],
        },
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
      streamError: null,
    });

    assertEquals(calls, [
      "append:text-start:assistant-message-1",
      "append:text-delta:assistant-message-1",
      "append:text-end:assistant-message-1",
      "append:tool-input-start:",
      "append:tool-input-available:",
      "append:tool-output-available:",
      "flush",
      "terminal:completed:",
      "cleanup",
    ]);
    assertEquals(terminalStates.at(0)!.status, "completed");
  });

  for (const kind of ["response", "detached"] as const) {
    for (const callOwnership of [undefined, false, true]) {
      for (const streamed of ["absent", "input-streaming", "input-available"] as const) {
        it(`retains result ownership with ${String(callOwnership)} call ownership in ${kind} ${streamed} fallback`, async () => {
          const calls: string[] = [];
          const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
          const terminalStates: HostedLifecycleTerminalState[] = [];
          const metadata = { type: "data-veryfront.runtime_context" as const, data: {} };
          const finalInput = { query: "final" };
          const streamedInput = { query: "streamed" };
          const ownership = callOwnership === undefined ? true : callOwnership;
          const mirrored = createMirroredToolChunkState();
          const projection = createChatStreamMessageProjection("assistant-message-1");
          const parts: ChatUiMessage["parts"] = [metadata];
          projection.append(metadata);
          if (streamed !== "absent") {
            parts.push({
              type: "tool-web_fetch",
              toolCallId: "result-owned",
              state: streamed,
              input: streamedInput,
              ...(callOwnership === undefined ? {} : { providerExecuted: callOwnership }),
            });
            mirrored.startedToolCallIds.add("result-owned");
            projection.append({
              type: "tool-input-start",
              toolCallId: "result-owned",
              toolName: "web_fetch",
              ...(callOwnership === undefined ? {} : { providerExecuted: callOwnership }),
            });
            if (streamed === "input-available") {
              mirrored.inputAvailableToolCallIds.add("result-owned");
              projection.append({
                type: "tool-input-available",
                toolCallId: "result-owned",
                toolName: "web_fetch",
                input: streamedInput,
                ...(callOwnership === undefined ? {} : { providerExecuted: callOwnership }),
              });
            }
          }
          const mirror = createDurableRunMirror({ calls, chunks });
          const append = mirror.handleChunk;
          mirror.handleChunk = async (chunk) => {
            await append(chunk);
            if (chunk.type === "finish") throw new Error("Unexpected fallback finish");
            projection.append(chunk);
          };
          const common = {
            isAborted: false,
            streamResult: createStreamResult({
              response: {
                messages: [
                  {
                    role: "assistant",
                    content: [{
                      type: "tool-call",
                      toolCallId: "result-owned",
                      toolName: "web_fetch",
                      input: finalInput,
                      ...(callOwnership === undefined ? {} : { providerExecuted: callOwnership }),
                    }],
                  },
                  {
                    role: "tool",
                    content: [{
                      type: "tool-result",
                      toolCallId: "result-owned",
                      toolName: "web_fetch",
                      providerExecuted: callOwnership === true ? false : true,
                      output: "found",
                    }],
                  },
                ],
              },
            }),
            lifecycleAdapter: createLifecycleAdapter({ calls, terminalStates, mirror }),
            mirroredToolChunkState: mirrored,
            capturedMessageId: "assistant-message-1",
            incompleteToolCallsPartErrorText: "Tool call did not complete",
            cleanup: async () => {},
            streamError: null,
          };
          await finalizeHostedChatRun(
            kind === "response"
              ? { ...common, kind, responseMessage: createResponseMessage({ parts }) }
              : {
                ...common,
                kind,
                mirroredMessage: createResponseMessage({ parts }),
                mirroredDurableOutput: false,
              },
          );
          const output = terminalStates[0]!.output as ChatUiMessage;
          assertEquals(terminalStates[0]!.status, "completed");
          const summarize = (part: unknown) =>
            isRecord(part) && part.toolCallId === "result-owned"
              ? {
                state: part.state,
                input: part.input,
                output: part.output,
                providerExecuted: part.providerExecuted,
              }
              : null;
          const expected = {
            state: "output-available",
            input: streamed === "input-available" ? streamedInput : finalInput,
            output: "found",
            providerExecuted: ownership,
          };
          assertEquals<unknown>(output.parts.map(summarize).filter(Boolean), [expected]);
          assertEquals<unknown>(projection.snapshot().parts.map(summarize).filter(Boolean), [
            expected,
          ]);
          assertEquals(chunks.filter((chunk) => chunk.type === "tool-output-available"), [{
            type: "tool-output-available",
            toolCallId: "result-owned",
            output: "found",
            providerExecuted: ownership,
          }]);
          assertEquals(getToolOutputErrorChunks(chunks, "result-owned"), []);
        });
      }
    }
  }

  for (const source of ["content", "extracted", "ui"] as const) {
    for (const providerExecuted of [true, false]) {
      for (const hasResult of [false, true]) {
        for (const streamed of ["absent", "input-streaming", "input-available"] as const) {
          it(`retains ${providerExecuted ? "provider" : "local"} ownership for ${source} fallback (${hasResult ? "result" : "no result"}, ${streamed})`, async () => {
            const calls: string[] = [];
            const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
            const terminalStates: HostedLifecycleTerminalState[] = [];
            const metadata = {
              type: "data-veryfront.runtime_context" as const,
              data: { currentDateUtc: "2026-10-08" },
            };
            const finalInput = { url: "https://example.com/final" };
            const originalInput = { url: "https://example.com/streamed" };
            const output = { found: true };
            const toolCall = {
              type: "tool-call",
              toolCallId: "owned-fallback",
              toolName: "web_fetch",
              input: finalInput,
              providerExecuted,
            };
            const toolResult = {
              type: "tool-result",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              output,
            };
            const finalStep = source === "extracted"
              ? { toolCalls: [toolCall], toolResults: hasResult ? [toolResult] : [] }
              : {
                response: {
                  messages: [
                    source === "content"
                      ? { role: "assistant", content: [toolCall] }
                      : { role: "assistant", parts: [toolCall] },
                    ...(hasResult
                      ? [
                        source === "content"
                          ? { role: "tool", content: [toolResult] }
                          : { role: "tool", parts: [{ ...toolResult, result: output }] },
                      ]
                      : []),
                  ],
                },
              };
            const mirrored = createMirroredToolChunkState();
            const projection = createChatStreamMessageProjection("assistant-message-1");
            const parts: ChatUiMessage["parts"] = [metadata];
            if (streamed !== "absent") {
              parts.push({
                type: "tool-web_fetch",
                toolCallId: toolCall.toolCallId,
                state: streamed,
                input: originalInput,
                providerExecuted,
              });
              mirrored.startedToolCallIds.add(toolCall.toolCallId);
              projection.append({
                type: "tool-input-start",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                providerExecuted,
              });
              if (streamed === "input-streaming") {
                projection.append({
                  type: "tool-input-delta",
                  toolCallId: toolCall.toolCallId,
                  inputTextDelta: JSON.stringify(originalInput),
                });
              }
              if (streamed === "input-available") {
                mirrored.inputAvailableToolCallIds.add(toolCall.toolCallId);
                projection.append({
                  type: "tool-input-available",
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: originalInput,
                  providerExecuted,
                });
              }
            }
            const mirror = createDurableRunMirror({ calls, chunks });
            const append = mirror.handleChunk;
            mirror.handleChunk = async (chunk) => {
              await append(chunk);
              if (chunk.type === "finish") throw new Error("Unexpected finish in fallback content");
              projection.append(chunk);
            };
            const input = {
              kind: "response" as const,
              responseMessage: createResponseMessage({ parts }),
              isAborted: false,
              streamResult: createStreamResult(finalStep),
              lifecycleAdapter: createLifecycleAdapter({ calls, terminalStates, mirror }),
              mirroredToolChunkState: mirrored,
              capturedMessageId: "assistant-message-1",
              incompleteToolCallsPartErrorText: "Tool call did not complete",
              cleanup: async () => {},
              streamError: null,
            };
            await finalizeHostedChatRun(input);
            const succeeded = providerExecuted || hasResult;
            assertEquals(terminalStates[0]!.status, succeeded ? "completed" : "failed");
            assertEquals(
              terminalStates[0]!.terminalErrorCode,
              succeeded ? undefined : "INCOMPLETE_TOOL_CALLS",
            );
            const finalized = terminalStates[0]!.output as ChatUiMessage | undefined;
            if (succeeded) assertEquals(finalized?.parts[0], metadata);
            else assertEquals(finalized, undefined);
            const expectedInput =
              streamed === "input-available" || (!succeeded && streamed === "input-streaming")
                ? originalInput
                : finalInput;
            const expectedState = hasResult
              ? "output-available"
              : providerExecuted
              ? "input-available"
              : "output-error";
            const properties = (part: unknown) =>
              isRecord(part) && "toolCallId" in part
                ? {
                  toolCallId: part.toolCallId,
                  state: part.state,
                  input: part.input,
                  providerExecuted: part.providerExecuted,
                  ...(hasResult && "output" in part ? { output: part.output } : {}),
                }
                : null;
            const expected = {
              toolCallId: toolCall.toolCallId,
              state: expectedState,
              input: expectedInput,
              providerExecuted,
              ...(hasResult ? { output } : {}),
            };
            if (succeeded) {
              assertEquals<unknown>(
                finalized!.parts.filter((part) => "toolCallId" in part).map(properties),
                [expected],
              );
            }
            assertEquals<unknown>(
              projection.snapshot().parts.filter((part) => "toolCallId" in part).map(properties),
              [expected],
            );
            assertEquals(
              getToolOutputErrorChunks(chunks, toolCall.toolCallId).length,
              succeeded ? 0 : 1,
            );
            if (finalized) {
              chunks.length = 0;
              await finalizeHostedChatRun({ ...input, responseMessage: finalized });
              assertEquals(terminalStates[1]!.output, finalized);
              assertEquals(chunks, []);
            }
          });
        }
      }
    }
  }

  it("fails runtime-metadata-only response output with unfinished final-step tool fallback", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [{
          type: "data-veryfront.runtime_context",
          data: { currentDateUtc: "2026-10-07" },
        }],
      }),
      isAborted: false,
      streamResult: createStreamResult({
        toolCalls: [{
          toolCallId: "unfinished-fallback-tool-1",
          toolName: "web_fetch",
          input: { url: "https://example.com/docs" },
        }],
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

    assertEquals(
      getToolOutputErrorChunks(chunks, "unfinished-fallback-tool-1").length,
      1,
    );
    assertEquals(terminalStates.at(0)!.status, "failed");
    assertEquals(terminalStates.at(0)!.terminalErrorCode, "INCOMPLETE_TOOL_CALLS");
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

    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [
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
          id: "11111111-1111-4111-8111-111111111111",
          status: "completed",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    try {
      const canonicalId = "11111111-1111-4111-8111-111111111111";
      const terminalToken = `header.${
        btoa(
          JSON.stringify({
            runId: "run-1",
            canonicalRunId: canonicalId,
            tokenUse: "run_event_writer",
            writerPurpose: "current_run_terminal",
            dispatchNonce: "generation",
          }),
        )
      }.signature`;
      const terminal = createConversationHostedTerminalAdapter({
        finalize: (input) =>
          finalizeConversationAgentRun({ ...input, terminalAuthToken: terminalToken }),
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

      assertEquals(requestBodies, [{
        status: "completed",
        output: createResponseMessage({
          parts: [{ type: "text", text: "done" }],
          metadata: {
            modelId: "test-model",
            usage: { inputTokens: 2, outputTokens: 3 },
            usageCaptureStatus: "complete",
          },
        }),
      }]);
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

    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
      status: "completed",
    }]);
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
    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
      status: "completed",
    }]);
    assertEquals((terminalStates[0]!.output as ChatUiMessage).parts.length > 0, true);
  });

  for (
    const shell of [
      [],
      [{ type: "step-start" as const }],
      [{ type: "text" as const, text: "  \n" }],
      [{ type: "reasoning" as const, text: "" }],
    ]
  ) {
    for (
      const mode of [
        "empty",
        "aborted",
        "mirrored",
        "provider-error",
        "text",
        "signed-reasoning",
      ] as const
    ) {
      it(`classifies detached metadata shell ${JSON.stringify(shell)} with ${mode}`, async () => {
        const calls: string[] = [];
        const terminalStates: HostedLifecycleTerminalState[] = [];
        const metadata = {
          type: "data-veryfront.runtime_context" as const,
          data: { currentDateUtc: "2026-10-08" },
        };
        const prefix: ChatUiMessageChunk<MessageMetadata>[] = [metadata];
        const chunks = [...prefix];
        const mirror = createDurableRunMirror({ calls, chunks });
        const projection = createChatStreamMessageProjection("assistant-message-1");
        projection.append(metadata);
        const parts: ChatUiMessage["parts"] = [metadata, ...shell];
        if (mode === "signed-reasoning") {
          parts.push({ type: "reasoning", text: "", signature: "sig" });
        }
        await finalizeHostedChatRun({
          kind: "detached",
          isAborted: mode === "aborted",
          mirroredDurableOutput: mode === "mirrored",
          mirroredMessage: createResponseMessage({ parts }),
          streamResult: createStreamResult(mode === "text" ? { text: "Recovered answer." } : {}),
          lifecycleAdapter: createLifecycleAdapter({ calls, terminalStates, mirror }),
          mirroredToolChunkState: createMirroredToolChunkState(),
          capturedMessageId: "assistant-message-1",
          incompleteToolCallsPartErrorText: "Tool call did not complete",
          cleanup: async () => {
            calls.push("cleanup");
          },
          streamError: mode === "provider-error" ? new Error("provider stream failed") : null,
        });
        const substantive = mode === "text" || mode === "signed-reasoning";
        const status = mode === "aborted"
          ? "cancelled"
          : substantive || mode === "mirrored"
          ? "completed"
          : "failed";
        assertEquals(terminalStates[0]!.status, status);
        assertEquals(
          terminalStates[0]!.terminalErrorCode,
          status === "failed"
            ? mode === "provider-error" ? "STREAM_ERROR" : "EMPTY_RESPONSE"
            : mode === "aborted"
            ? "ABORTED"
            : undefined,
        );
        if (status === "failed" || !substantive) assertEquals(terminalStates[0]!.output, undefined);
        assertEquals(chunks.slice(0, prefix.length), prefix);
        if (status === "failed") {
          assertEquals(chunks, prefix);
          assertEquals(calls, [
            "flush",
            `terminal:failed:${mode === "provider-error" ? "STREAM_ERROR" : "EMPTY_RESPONSE"}`,
            "cleanup",
          ]);
          assertEquals<unknown>(projection.snapshot().parts, [metadata]);
        }
      });
    }
  }

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
    assertEquals("output" in terminalStates[0]!, false);
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

      assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
        status: "completed",
      }]);
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

    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
      status: "completed",
    }]);
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

    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
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
    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
      status: "completed",
    }]);
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
    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), []);
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
    assertEquals(terminalStates.map(({ output: _output, ...state }) => state), []);
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
      assertEquals(terminalStates.map(({ output: _output, ...state }) => state), [{
        status: "completed",
      }]);
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

  const cancelledTerminalState: HostedLifecycleTerminalState = {
    status: "cancelled",
    terminalErrorCode: "ABORTED",
    terminalErrorMessage: "Chat stream aborted",
  };

  it("resolves an aborted empty response run to cancelled instead of a failure", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({ parts: [] }),
      isAborted: true,
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
      streamError: new Error("aborted"),
    });

    assertEquals(
      terminalStates,
      [cancelledTerminalState],
      "aborted runs must resolve to cancelled",
    );
    assertEquals(
      calls.some((call) => call.startsWith("terminal:failed:")),
      false,
      "aborted runs must not dispatch a failed terminal state",
    );
  });

  it("resolves an aborted empty detached run to cancelled instead of a failure", async () => {
    const calls: string[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];

    await finalizeHostedChatRun({
      kind: "detached",
      isAborted: true,
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
      streamError: new Error("aborted"),
    });

    assertEquals(
      terminalStates,
      [cancelledTerminalState],
      "aborted runs must resolve to cancelled",
    );
    assertEquals(
      calls.some((call) => call.startsWith("terminal:failed:")),
      false,
      "aborted runs must not dispatch a failed terminal state",
    );
  });

  it("keeps an aborted run cancelled even with unfinished local tool parts", async () => {
    const calls: string[] = [];
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
      isAborted: true,
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

    assertEquals(
      terminalStates,
      [cancelledTerminalState],
      "aborted runs with unfinished tools must stay cancelled rather than INCOMPLETE_TOOL failures",
    );
  });

  it("does not re-emit output-error for tool calls already mirrored as output-error", async () => {
    const calls: string[] = [];
    const chunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    const terminalStates: HostedLifecycleTerminalState[] = [];
    const state = createMirroredToolChunkState();
    state.outputErrorToolCallIds.add("seen-1");

    await finalizeHostedChatRun({
      kind: "response",
      responseMessage: createResponseMessage({
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-web_fetch",
            toolCallId: "seen-1",
            input: { url: "https://example.com/docs" },
            state: "output-error",
            errorText: "boom",
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
      mirroredToolChunkState: state,
      capturedMessageId: "assistant-message-1",
      incompleteToolCallsPartErrorText: "Tool call did not complete",
      cleanup: async () => {
        calls.push("cleanup");
      },
      streamError: null,
    });

    assertEquals(
      getToolOutputErrorChunks(chunks, "seen-1"),
      [],
      "an already-mirrored tool call must not receive a duplicate output-error chunk",
    );
  });
});

describe("native pause mirror retirement", () => {
  for (
    const outcome of [
      "drained",
      "disabled",
      "pending",
      "in-flight",
      "retry",
      "flush-error",
      "stream-error",
    ] as const
  ) {
    it(`requires a healthy drained mirror after ${outcome}`, async () => {
      const calls: string[] = [];
      const terminalStates: HostedLifecycleTerminalState[] = [];
      const mirror = createDurableRunMirror({ calls });
      const flush = mirror.flush;
      mirror.flush = async () => {
        if (outcome === "flush-error") throw new Error("Mirror persistence failed");
        const snapshot = await flush();
        return {
          ...snapshot,
          disabled: outcome === "disabled",
          pendingEventCount: outcome === "pending" ? 1 : 0,
          inFlight: outcome === "in-flight",
          hasRetryTimer: outcome === "retry",
        };
      };
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.com",
        runId: "run_pause_mirror",
        token: "pause-test-token",
        signal: new AbortController().signal,
        fetch: () => Promise.resolve(Response.json({ stop: true })),
      });
      await capability.acknowledge({
        version: 1,
        nextStep: 0,
        messages: [],
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latestAssistantText: "",
        completed: false,
        recoveredEmptyResponse: false,
        recoveredInterruptedLocalToolBatch: false,
      });
      capability.persisted?.(true);
      const lifecycleAdapter = createLifecycleAdapter({ calls, terminalStates, mirror });
      inheritHostedAgentPauseCapability(lifecycleAdapter, capability);
      const { logger, errors } = createLogger();
      await finalizeHostedChatRun({
        kind: "response",
        responseMessage: createResponseMessage({ parts: [] }),
        isAborted: false,
        streamResult: {
          get steps(): Promise<readonly unknown[]> {
            throw new Error("Paused runs have no final step");
          },
        },
        lifecycleAdapter,
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: null,
        incompleteToolCallsPartErrorText: "Incomplete",
        streamError: outcome === "stream-error" ? new Error("Stream failed after ACK") : undefined,
        logger,
        cleanup: async () => {
          calls.push("cleanup");
          recordHostedAgentPauseCleanup(capability, true);
        },
      });
      assertEquals(terminalStates, []);
      assertEquals(calls.at(-1), "cleanup");
      assertEquals(canSettleHostedAgentPause(capability), outcome === "drained");
      assertEquals(errors.length, outcome === "flush-error" ? 1 : 0);
    });
  }
});
