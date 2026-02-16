/**
 * Tests for the useChat streaming handler.
 *
 * These tests validate the real parser path (`handleStreamingResponse`)
 * against the veryfront stream event protocol.
 */
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists } from "#veryfront/testing/assert";

import { handleStreamingResponse } from "../../src/agent/react/use-chat/streaming/index.ts";
import type {
  OnToolCallArg,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "../../src/agent/react/use-chat/index.ts";

interface ProcessedStreamResult {
  messages: UIMessage[];
  toolCalls: Array<OnToolCallArg["toolCall"]>;
  dataEvents: unknown[];
  updates: Array<{ parts: UIMessagePart[]; messageId: string }>;
}

function createStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

async function processStream(
  events: Array<Record<string, unknown>>,
): Promise<ProcessedStreamResult> {
  const messages: UIMessage[] = [];
  const toolCalls: Array<OnToolCallArg["toolCall"]> = [];
  const dataEvents: unknown[] = [];
  const updates: Array<{ parts: UIMessagePart[]; messageId: string }> = [];

  await handleStreamingResponse(createStream(events), {
    onMessage: (message) => messages.push(message),
    onData: (data) => dataEvents.push(data),
    onUpdate: (parts, messageId) => updates.push({ parts, messageId }),
    onToolCall: ({ toolCall }) => toolCalls.push(toolCall),
  });

  return { messages, toolCalls, dataEvents, updates };
}

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

describe("useChat streaming handler (veryfront protocol)", () => {
  it("handles message-start/text/step/message-finish lifecycle", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-123" },
      { type: "step-start" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-delta", id: "text-1", delta: " World" },
      { type: "text-end", id: "text-1" },
      { type: "step-end" },
      { type: "message-finish" },
    ]);

    const msg = result.messages[0]!;

    assertEquals(result.messages.length, 1);
    assertEquals(msg.id, "msg-123");
    assertEquals(msg.role, "assistant");
    assertEquals(msg.parts.length, 1);
    assertEquals(msg.parts[0], { type: "text", text: "Hello World", state: "done" });
    assertEquals(getTextContent(msg), "Hello World");
    assertEquals(result.updates.length > 0, true);
  });

  it("handles tool input/output events and onToolCall callback", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-456" },
      { type: "tool-input-start", toolCallId: "call-1", toolName: "getWeather" },
      { type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '{"city":' },
      { type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '"Tokyo"}' },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "getWeather",
        input: { city: "Tokyo" },
      },
      {
        type: "tool-output-available",
        toolCallId: "call-1",
        output: { temp: 72, weather: "sunny" },
      },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The weather in Tokyo is sunny." },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    const msg = result.messages[0]!;
    const toolPart = msg.parts[0] as ToolUIPart;

    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolCalls[0], {
      toolCallId: "call-1",
      toolName: "getWeather",
      input: { city: "Tokyo" },
      dynamic: false,
    });

    assertEquals(msg.parts.length, 2);
    assertEquals(toolPart.type, "tool-getWeather");
    assertEquals(toolPart.toolCallId, "call-1");
    assertEquals(toolPart.toolName, "getWeather");
    assertEquals(toolPart.state, "output-available");
    assertEquals(toolPart.input, { city: "Tokyo" });
    assertEquals(toolPart.output, { temp: 72, weather: "sunny" });

    assertEquals(msg.parts[1], {
      type: "text",
      text: "The weather in Tokyo is sunny.",
      state: "done",
    });
  });

  it("handles reasoning-start/reasoning-delta/reasoning-end events", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-789" },
      { type: "reasoning-start", id: "reason-1" },
      { type: "reasoning-delta", id: "reason-1", delta: "Let me think..." },
      { type: "reasoning-delta", id: "reason-1", delta: " The answer is 42." },
      { type: "reasoning-end", id: "reason-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The answer is 42." },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    const msg = result.messages[0]!;

    assertEquals(msg.parts.length, 2);
    assertEquals(msg.parts[0], {
      type: "reasoning",
      text: "Let me think... The answer is 42.",
      state: "done",
    });
    assertEquals(msg.parts[1], {
      type: "text",
      text: "The answer is 42.",
      state: "done",
    });
  });

  it("handles multiple text blocks", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-multi" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "First block." },
      { type: "text-end", id: "text-1" },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "Second block." },
      { type: "text-end", id: "text-2" },
      { type: "message-finish" },
    ]);

    const msg = result.messages[0]!;

    assertEquals(msg.parts.length, 2);
    assertEquals(getTextContent(msg), "First block.Second block.");
  });

  it("handles data events", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-data" },
      { type: "data", data: { custom: "value" } },
      { type: "data", value: [1, 2, 3] },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Done" },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    assertEquals(result.dataEvents.length, 2);
    assertEquals(result.dataEvents[0], { custom: "value" });
    assertEquals(result.dataEvents[1], [1, 2, 3]);
  });

  it("handles inferenceMode data event from server", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-mode" },
      { type: "data", data: { inferenceMode: "server-local" } },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Local response" },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    assertEquals(result.dataEvents.length, 1);
    assertEquals(result.dataEvents[0], { inferenceMode: "server-local" });
    assertEquals(getTextContent(result.messages[0]!), "Local response");
  });

  it("uses parts array as primary content structure", async () => {
    const result = await processStream([
      { type: "message-start", messageId: "msg-parts" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    const msg = result.messages[0]!;

    assertExists(msg.parts);
    assertEquals(msg.parts.length, 1);
    assertEquals(msg.parts[0]!.type, "text");
    assertEquals("content" in msg, false);
  });
});
