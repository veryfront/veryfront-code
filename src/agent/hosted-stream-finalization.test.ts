import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { finalizeHostedDetached, finalizeHostedResponse } from "./hosted-stream-finalization.ts";

describe("agent/hosted-stream-finalization", () => {
  it("finalizes hosted responses with fallback chunks and resolved terminal state", async () => {
    const calls: string[] = [];

    await finalizeHostedResponse({
      isAborted: false,
      getFinalStep: async () => ({ step: 1 }),
      buildState: async () => ({
        persistedMessage: { id: "msg-1" },
        finalizedMessage: { id: "msg-1", parts: ["text"] },
        fallbackChunks: ["chunk-1", "chunk-2"],
        hasIncompleteToolParts: false,
        metadata: { modelId: "openai/gpt-5.4" },
      }),
      shouldFailEmptyMessage: () => false,
      resolveEmptyTerminalError: () => ({ code: "EMPTY", message: "empty" }),
      appendFallbackChunk: async (chunk) => {
        calls.push(`append:${chunk}`);
      },
      flushMirror: async () => {
        calls.push("flush");
      },
      dispatchTerminalState: async (state) => {
        calls.push(`dispatch:${state.status}:${state.metadata?.modelId}`);
      },
      resolveTerminalState: () => ({ status: "completed" }),
      cleanup: async () => {
        calls.push("cleanup");
      },
    });

    assertEquals(calls, [
      "append:chunk-1",
      "append:chunk-2",
      "flush",
      "dispatch:completed:openai/gpt-5.4",
      "cleanup",
    ]);
  });

  it("fails empty hosted responses before fallback chunks append", async () => {
    const calls: string[] = [];

    await finalizeHostedResponse({
      isAborted: false,
      getFinalStep: async () => ({ step: 1 }),
      buildState: async () => ({
        persistedMessage: { id: "msg-1" },
        finalizedMessage: { id: "msg-1", parts: [] },
        fallbackChunks: ["chunk-1"],
        hasIncompleteToolParts: false,
        metadata: { modelId: "openai/gpt-5.4" },
      }),
      shouldFailEmptyMessage: () => true,
      resolveEmptyTerminalError: () => ({ code: "EMPTY_RESPONSE", message: "empty" }),
      appendFallbackChunk: async (chunk) => {
        calls.push(`append:${chunk}`);
      },
      flushMirror: async () => {
        calls.push("flush");
      },
      dispatchTerminalState: async (state) => {
        calls.push(`dispatch:${state.status}:${state.terminalErrorCode}`);
      },
      resolveTerminalState: () => ({ status: "completed" }),
      cleanup: async () => {
        calls.push("cleanup");
      },
    });

    assertEquals(calls, ["flush", "dispatch:failed:EMPTY_RESPONSE", "cleanup"]);
  });

  it("finalizes hosted detached streams through detached fallback state", async () => {
    const calls: string[] = [];

    await finalizeHostedDetached({
      isAborted: false,
      mirroredDurableOutput: false,
      getFinalStep: async () => ({ step: 1 }),
      buildState: async () => ({
        hasContent: true,
        fallbackChunks: ["tool-1"],
        hasIncompleteToolParts: true,
      }),
      resolveEmptyTerminalError: () => ({ code: "EMPTY", message: "empty" }),
      appendFallbackChunk: async (chunk) => {
        calls.push(`append:${chunk}`);
      },
      flushMirror: async () => {
        calls.push("flush");
      },
      dispatchTerminalState: async (state) => {
        calls.push(`dispatch:${state.status}`);
      },
      resolveTerminalState: ({ hasIncompleteToolParts }) => ({
        status: hasIncompleteToolParts ? "failed" : "completed",
      }),
      cleanup: async () => {
        calls.push("cleanup");
      },
    });

    assertEquals(calls, ["append:tool-1", "flush", "dispatch:failed", "cleanup"]);
  });

  it("propagates cleanup errors after dispatching terminal state", async () => {
    const calls: string[] = [];

    await assertRejects(
      () =>
        finalizeHostedDetached({
          isAborted: false,
          mirroredDurableOutput: true,
          getFinalStep: async () => ({ step: 1 }),
          buildState: async () => ({
            hasContent: false,
            fallbackChunks: [],
            hasIncompleteToolParts: false,
          }),
          resolveEmptyTerminalError: () => ({ code: "EMPTY", message: "empty" }),
          appendFallbackChunk: async () => {
            calls.push("append");
          },
          flushMirror: async () => {
            calls.push("flush");
          },
          dispatchTerminalState: async (state) => {
            calls.push(`dispatch:${state.status}`);
          },
          resolveTerminalState: () => ({ status: "completed" }),
          cleanup: async () => {
            calls.push("cleanup");
            throw new Error("cleanup failed");
          },
        }),
      Error,
      "cleanup failed",
    );

    assertEquals(calls, ["flush", "dispatch:completed", "cleanup"]);
  });
});
