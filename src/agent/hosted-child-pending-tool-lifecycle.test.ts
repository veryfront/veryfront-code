import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "../chat/protocol.ts";
import {
  createHostedChildPendingToolLifecycle,
  createHostedChildPendingToolLifecycleLogger,
} from "./hosted-child-pending-tool-lifecycle.ts";

Deno.test("createHostedChildPendingToolLifecycle closes incomplete streaming input", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const logs: unknown[] = [];
  const lifecycle = createHostedChildPendingToolLifecycle({
    appendMirrorChunk: (chunk) => {
      chunks.push(chunk);
    },
    logger: {
      warnIncompleteToolLifecycles: (input) => logs.push(input),
    },
  });

  lifecycle.upsertPendingToolCall("tool-1", {
    phase: "input_streaming",
    toolName: "lookup",
    input: { query: "docs" },
  });

  await lifecycle.closePendingToolCalls({ kind: "ended" });

  assertEquals(chunks, [
    { type: "tool-input-start", toolCallId: "tool-1", toolName: "lookup" },
    {
      type: "tool-input-error",
      toolCallId: "tool-1",
      toolName: "lookup",
      input: { query: "docs" },
      errorText: "Child fork stream ended before tool input completed",
    },
  ]);
  assertEquals(logs, [{ reason: "ended", toolCallIds: ["tool-1"], errorMessage: null }]);
});

Deno.test("createHostedChildPendingToolLifecycle closes awaiting result with output error", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const lifecycle = createHostedChildPendingToolLifecycle({
    appendMirrorChunk: (chunk) => {
      chunks.push(chunk);
    },
  });

  await lifecycle.emitToolInputStartIfNeeded("tool-1", "lookup");
  lifecycle.upsertPendingToolCall("tool-1", {
    phase: "awaiting_result",
    toolName: "lookup",
    input: { query: "docs" },
  });

  await lifecycle.closePendingToolCalls({ kind: "aborted" });

  assertEquals(chunks, [
    { type: "tool-input-start", toolCallId: "tool-1", toolName: "lookup" },
    {
      type: "tool-output-error",
      toolCallId: "tool-1",
      errorText: "Child fork stream aborted before tool result completed",
    },
  ]);
});

Deno.test("createHostedChildPendingToolLifecycle logs unknown tool identity and recovers input", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const unknownLogs: unknown[] = [];
  const lifecycle = createHostedChildPendingToolLifecycle({
    appendMirrorChunk: (chunk) => {
      chunks.push(chunk);
    },
    logger: {
      warnUnknownToolIdentity: (input) => unknownLogs.push(input),
    },
  });

  lifecycle.upsertPendingToolCall("tool-1", {
    phase: "input_streaming",
    input: "not-an-object",
  });

  await lifecycle.closePendingToolCalls({ kind: "error", error: new Error("stream failed") });

  assertEquals(chunks, [
    { type: "tool-input-start", toolCallId: "tool-1", toolName: "unknown" },
    {
      type: "tool-input-error",
      toolCallId: "tool-1",
      toolName: "unknown",
      input: {},
      errorText: "Child fork stream errored before tool input completed: stream failed",
    },
  ]);
  assertEquals(unknownLogs, [
    {
      toolCallId: "tool-1",
      phase: "input_streaming",
      reason: "error",
      hasInputSnapshot: true,
    },
  ]);
});

Deno.test("createHostedChildPendingToolLifecycle deletes settled pending tool calls", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const lifecycle = createHostedChildPendingToolLifecycle({
    appendMirrorChunk: (chunk) => {
      chunks.push(chunk);
    },
  });

  lifecycle.upsertPendingToolCall("tool-1", { phase: "awaiting_result", toolName: "lookup" });
  lifecycle.deletePendingToolCall("tool-1");

  await lifecycle.closePendingToolCalls({ kind: "ended" });

  assertEquals(chunks, []);
});

Deno.test("createHostedChildPendingToolLifecycleLogger writes host context for pending lifecycle warnings", () => {
  const warnings: Array<{ message: string; context: Record<string, unknown> }> = [];
  const logger = createHostedChildPendingToolLifecycleLogger(
    {
      conversationId: "conv-1",
      parentRunId: "run-1",
      description: "Summarize docs",
    },
    {
      warn: (message: string, context: Record<string, unknown>) => {
        warnings.push({ message, context });
      },
    },
  );

  logger.warnIncompleteToolLifecycles?.({
    reason: "error",
    toolCallIds: ["tool-1", "tool-2"],
    errorMessage: "stream failed",
  });
  logger.warnUnknownToolIdentity?.({
    toolCallId: "tool-1",
    phase: "input_streaming",
    reason: "error",
    hasInputSnapshot: true,
  });

  assertEquals(warnings, [
    {
      message: "Closing incomplete child fork tool lifecycles",
      context: {
        conversationId: "conv-1",
        runId: "run-1",
        description: "Summarize docs",
        reason: "error",
        toolCallIds: ["tool-1", "tool-2"],
        errorMessage: "stream failed",
      },
    },
    {
      message: "Closing child fork tool lifecycle without recoverable tool identity",
      context: {
        conversationId: "conv-1",
        runId: "run-1",
        description: "Summarize docs",
        toolCallId: "tool-1",
        phase: "input_streaming",
        reason: "error",
        hasInputSnapshot: true,
      },
    },
  ]);
});
