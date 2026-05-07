import { assertEquals } from "@std/assert";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import { createHostedChildForkRunContext } from "./hosted-child-fork-run-context.ts";

Deno.test("createHostedChildForkRunContext wires stream mirror state and buffers", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    messageId: "message-1",
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
  });

  assertEquals(context.streamMirrorContext.durableRunMirror, true);
  assertEquals(context.streamMirrorContext.durableMessageId, "message-1");
  assertEquals(context.streamMirrorContext.durableReasoningMessageId, "message-1:reasoning");
  assertEquals(context.streamMirrorContext.hasStartedStep(), false);
  assertEquals(context.streamMirrorContext.hasEmittedProgress(), false);
  assertEquals(context.streamState.finalText, "");
  assertEquals(context.toolCalls, []);
  assertEquals(context.toolResults, []);

  context.streamMirrorContext.markDurableStepStarted();
  await context.streamMirrorContext.appendDurableMirrorChunk({ type: "start-step" });

  assertEquals(context.streamMirrorContext.hasStartedStep(), true);
  assertEquals(context.streamMirrorContext.hasEmittedProgress(), true);
  assertEquals(chunks, [{ type: "start-step" }]);
});

Deno.test("createHostedChildForkRunContext closes pending tool calls with host logger", async () => {
  const chunks: ChatUiMessageChunk<ChatMessageMetadata>[] = [];
  const warnings: Array<{ message: string; context: Record<string, unknown> }> = [];
  const context = createHostedChildForkRunContext({
    mirror: {
      handleChunk: (chunk) => {
        chunks.push(chunk);
      },
    },
    pendingToolLogContext: {
      conversationId: "conversation-1",
      parentRunId: "run-1",
      description: "Check the app",
    },
    pendingToolLogWriter: {
      warn: (message, logContext) => {
        warnings.push({ message, context: logContext });
      },
    },
  });

  context.pendingToolLifecycle.upsertPendingToolCall("tool-call-1", {
    phase: "awaiting_result",
    toolName: "read_file",
    input: { path: "README.md" },
  });

  await context.pendingToolLifecycle.closePendingToolCalls({ kind: "aborted" });

  assertEquals(chunks.map((chunk) => chunk.type), ["tool-input-start", "tool-output-error"]);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0]?.message, "Closing incomplete child fork tool lifecycles");
  assertEquals(warnings[0]?.context, {
    conversationId: "conversation-1",
    runId: "run-1",
    description: "Check the app",
    reason: "aborted",
    toolCallIds: ["tool-call-1"],
    errorMessage: null,
  });
});
