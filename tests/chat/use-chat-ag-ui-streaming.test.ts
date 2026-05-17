/**
 * Tests for the useChat AG-UI streaming path.
 *
 * These tests validate that browser AG-UI SSE can feed the same chat message
 * state as the existing Veryfront chat stream protocol.
 */
import "../_helpers/contract-init.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";

import { handleAgUiStreamingResponse } from "../../src/agent/react/use-chat/streaming/index.ts";
import type {
  ChatMessage,
  ChatMessagePart,
  ChatToolPart,
  OnToolCallArg,
} from "../../src/agent/react/use-chat/index.ts";

interface ProcessedAgUiStreamResult {
  messages: ChatMessage[];
  toolCalls: Array<OnToolCallArg["toolCall"]>;
  dataEvents: unknown[];
  updates: Array<{ parts: ChatMessagePart[]; messageId: string }>;
}

function createAgUiStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

function agUiFrame(id: number, event: string, payload: Record<string, unknown>): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function processAgUiStream(frames: string[]): Promise<ProcessedAgUiStreamResult> {
  const messages: ChatMessage[] = [];
  const toolCalls: Array<OnToolCallArg["toolCall"]> = [];
  const dataEvents: unknown[] = [];
  const updates: Array<{ parts: ChatMessagePart[]; messageId: string }> = [];

  await handleAgUiStreamingResponse(createAgUiStream(frames), {
    onMessage: (message) => messages.push(message),
    onData: (data) => dataEvents.push(data),
    onUpdate: (parts, messageId) => updates.push({ parts, messageId }),
    onToolCall: ({ toolCall }) => toolCalls.push(toolCall),
  });

  return { messages, toolCalls, dataEvents, updates };
}

function getTextContent(message: ChatMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

describe("useChat streaming handler (AG-UI protocol)", () => {
  it("handles AG-UI text and run lifecycle events", async () => {
    const result = await processAgUiStream([
      agUiFrame(1, "RunStarted", {
        runId: "run-1",
        threadId: "thread-1",
        agentId: "assistant",
      }),
      agUiFrame(2, "TextMessageStart", { messageId: "msg-1", role: "assistant" }),
      agUiFrame(3, "TextMessageContent", { messageId: "msg-1", delta: "Hello" }),
      agUiFrame(4, "TextMessageContent", { messageId: "msg-1", delta: " AG-UI" }),
      agUiFrame(5, "TextMessageEnd", { messageId: "msg-1" }),
      agUiFrame(6, "RunFinished", { metadata: { finishReason: "stop" } }),
    ]);

    const msg = result.messages[0]!;

    assertEquals(result.messages.length, 1);
    assertEquals(msg.id, "msg-1");
    assertEquals(msg.role, "assistant");
    assertEquals(getTextContent(msg), "Hello AG-UI");
    assertEquals(msg.parts[0], { type: "text", text: "Hello AG-UI", state: "done" });
    assertEquals(result.updates.length > 0, true);
  });

  it("handles AG-UI tool calls and custom data events", async () => {
    const result = await processAgUiStream([
      agUiFrame(1, "RunStarted", { runId: "run-2" }),
      agUiFrame(2, "ToolCallStart", {
        toolCallId: "call-1",
        toolCallName: "searchDocs",
      }),
      agUiFrame(3, "ToolCallArgs", {
        toolCallId: "call-1",
        delta: '{"query":"agents"}',
      }),
      agUiFrame(4, "ToolCallEnd", { toolCallId: "call-1" }),
      agUiFrame(5, "ToolCallResult", {
        toolCallId: "call-1",
        result: '{"count":2}',
      }),
      agUiFrame(6, "Custom", {
        name: "state",
        value: { selected: "docs" },
      }),
      agUiFrame(7, "TextMessageStart", { messageId: "msg-tools", role: "assistant" }),
      agUiFrame(8, "TextMessageContent", {
        messageId: "msg-tools",
        delta: "Found two docs.",
      }),
      agUiFrame(9, "TextMessageEnd", { messageId: "msg-tools" }),
      agUiFrame(10, "RunFinished", { metadata: { finishReason: "stop" } }),
    ]);

    const msg = result.messages[0]!;
    const toolPart = msg.parts[0] as ChatToolPart;

    assertEquals(result.toolCalls, [{
      toolCallId: "call-1",
      toolName: "searchDocs",
      input: { query: "agents" },
      dynamic: false,
    }]);
    assertEquals(toolPart.type, "tool-searchDocs");
    assertEquals(toolPart.toolCallId, "call-1");
    assertEquals(toolPart.toolName, "searchDocs");
    assertEquals(toolPart.state, "output-available");
    assertEquals(toolPart.input, { query: "agents" });
    assertEquals(toolPart.output, { count: 2 });
    assertEquals(getTextContent(msg), "Found two docs.");
    assertEquals(result.dataEvents, [{ selected: "docs" }]);
  });

  it("preserves AG-UI tool results without preceding tool-call events", async () => {
    const result = await processAgUiStream([
      agUiFrame(1, "RunStarted", { runId: "run-result-only" }),
      agUiFrame(2, "ToolCallResult", {
        toolCallId: "call-result-only",
        input: { query: "fallback" },
        result: '{"count":1}',
      }),
      agUiFrame(3, "RunFinished", { metadata: { finishReason: "stop" } }),
    ]);

    const msg = result.messages[0]!;
    const toolPart = msg.parts[0] as ChatToolPart;

    assertEquals(result.messages.length, 1);
    assertEquals(toolPart.type, "dynamic-tool");
    assertEquals(toolPart.toolCallId, "call-result-only");
    assertEquals(toolPart.toolName, "tool");
    assertEquals(toolPart.state, "output-available");
    assertEquals(toolPart.input, { query: "fallback" });
    assertEquals(toolPart.output, { count: 1 });
  });
});
