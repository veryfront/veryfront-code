/**
 * Tests for useChat v5 stream protocol handling
 */
import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

// Import types for testing
import type {
  ToolCallUI,
  ReasoningUI,
  MessageWithParts,
} from "../../src/ai/react/hooks/use-chat.ts";

/**
 * Create a mock SSE stream from v5 events
 */
function createV5Stream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
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

/**
 * Simplified stream processor for testing (mirrors handleStreamingResponse logic)
 */
async function processV5Stream(
  stream: ReadableStream<Uint8Array>,
): Promise<{
  messages: MessageWithParts[];
  toolCalls: ToolCallUI[];
  reasoningBlocks: ReasoningUI[];
  dataEvents: unknown[];
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const textBlocks = new Map<string, string>();
  let currentTextId = "";
  let messageId = "";

  const toolCalls = new Map<string, ToolCallUI>();
  const reasoningBlocks = new Map<string, ReasoningUI>();
  const messageParts: MessageWithParts["parts"] = [];
  const messages: MessageWithParts[] = [];
  const dataEvents: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            case "start":
              messageId = parsed.messageId || "test-msg";
              textBlocks.clear();
              break;

            case "text-start":
              currentTextId = parsed.id || "text-0";
              textBlocks.set(currentTextId, "");
              break;

            case "text-delta": {
              const textId = parsed.id || currentTextId || "default";
              // Support both v5 (delta) and v4 (textDelta) formats
              const delta = parsed.delta || parsed.textDelta || "";
              if (!textBlocks.has(textId)) {
                textBlocks.set(textId, "");
                currentTextId = textId;
              }
              textBlocks.set(textId, (textBlocks.get(textId) || "") + delta);
              break;
            }

            case "text-end": {
              const textId = parsed.id || currentTextId;
              const text = textBlocks.get(textId) || "";
              if (text) {
                messageParts.push({ type: "text", text });
              }
              break;
            }

            case "tool-input-start": {
              const toolCallId = parsed.toolCallId;
              toolCalls.set(toolCallId, {
                id: toolCallId,
                toolName: parsed.toolName,
                inputText: "",
                status: "pending",
              });
              break;
            }

            case "tool-input-delta": {
              const toolCall = toolCalls.get(parsed.toolCallId);
              if (toolCall) {
                toolCall.inputText = (toolCall.inputText || "") + (parsed.inputTextDelta || "");
                toolCall.status = "streaming";
              }
              break;
            }

            case "tool-input-available": {
              const toolCall = toolCalls.get(parsed.toolCallId);
              if (toolCall) {
                toolCall.input = parsed.input;
                toolCall.status = "executing";
                messageParts.push({
                  type: "tool-call",
                  toolCallId: parsed.toolCallId,
                  toolName: toolCall.toolName,
                  args: toolCall.input,
                });
              }
              break;
            }

            case "tool-output-available": {
              const toolCall = toolCalls.get(parsed.toolCallId);
              if (toolCall) {
                toolCall.output = parsed.output;
                toolCall.status = "completed";
                messageParts.push({
                  type: "tool-result",
                  toolCallId: parsed.toolCallId,
                  result: toolCall.output,
                });
              }
              break;
            }

            case "reasoning-start": {
              reasoningBlocks.set(parsed.id, {
                id: parsed.id,
                text: "",
                isComplete: false,
              });
              break;
            }

            case "reasoning-delta": {
              const reasoning = reasoningBlocks.get(parsed.id);
              if (reasoning) {
                reasoning.text += parsed.delta || "";
              }
              break;
            }

            case "reasoning-end": {
              const reasoning = reasoningBlocks.get(parsed.id);
              if (reasoning) {
                reasoning.isComplete = true;
                messageParts.push({
                  type: "reasoning",
                  id: reasoning.id,
                  text: reasoning.text,
                });
              }
              break;
            }

            case "finish": {
              const content = Array.from(textBlocks.values()).join("");
              messages.push({
                id: messageId,
                role: "assistant",
                content,
                timestamp: Date.now(),
                parts: [...messageParts],
              });
              break;
            }

            case "data":
              dataEvents.push(parsed.data || parsed.value);
              break;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  return {
    messages,
    toolCalls: Array.from(toolCalls.values()),
    reasoningBlocks: Array.from(reasoningBlocks.values()),
    dataEvents,
  };
}

describe("v5 UI Message Stream Protocol", () => {
  it("handles text-start, text-delta, text-end events", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-123" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-delta", id: "text-1", delta: " World" },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);
    const msg = result.messages[0]!;

    assertEquals(result.messages.length, 1);
    assertEquals(msg.content, "Hello World");
    assertEquals(msg.id, "msg-123");
    assertExists(msg.parts);
    assertEquals(msg.parts!.length, 1);
    assertEquals(msg.parts![0], { type: "text", text: "Hello World" });
  });

  it("handles tool-input-start, tool-input-delta, tool-input-available, tool-output-available", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-456" },
      { type: "tool-input-start", toolCallId: "call-1", toolName: "getWeather" },
      { type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '{"city":' },
      { type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '"Tokyo"}' },
      { type: "tool-input-available", toolCallId: "call-1", toolName: "getWeather", input: { city: "Tokyo" } },
      { type: "tool-output-available", toolCallId: "call-1", output: { temp: 72, weather: "sunny" } },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The weather in Tokyo is sunny." },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);
    const toolCall = result.toolCalls[0]!;
    const msg = result.messages[0]!;

    // Check tool calls
    assertEquals(result.toolCalls.length, 1);
    assertEquals(toolCall.id, "call-1");
    assertEquals(toolCall.toolName, "getWeather");
    assertEquals(toolCall.input, { city: "Tokyo" });
    assertEquals(toolCall.output, { temp: 72, weather: "sunny" });
    assertEquals(toolCall.status, "completed");

    // Check message parts
    assertExists(msg.parts);
    assertEquals(msg.parts!.length, 3);
    assertEquals(msg.parts![0], {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "getWeather",
      args: { city: "Tokyo" },
    });
    assertEquals(msg.parts![1], {
      type: "tool-result",
      toolCallId: "call-1",
      result: { temp: 72, weather: "sunny" },
    });
    assertEquals(msg.parts![2], { type: "text", text: "The weather in Tokyo is sunny." });
  });

  it("handles reasoning-start, reasoning-delta, reasoning-end events", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-789" },
      { type: "reasoning-start", id: "reason-1" },
      { type: "reasoning-delta", id: "reason-1", delta: "Let me think..." },
      { type: "reasoning-delta", id: "reason-1", delta: " The answer is 42." },
      { type: "reasoning-end", id: "reason-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The answer is 42." },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);
    const reasoning = result.reasoningBlocks[0]!;
    const msg = result.messages[0]!;

    // Check reasoning blocks
    assertEquals(result.reasoningBlocks.length, 1);
    assertEquals(reasoning.id, "reason-1");
    assertEquals(reasoning.text, "Let me think... The answer is 42.");
    assertEquals(reasoning.isComplete, true);

    // Check message parts include reasoning
    assertExists(msg.parts);
    assertEquals(msg.parts![0], {
      type: "reasoning",
      id: "reason-1",
      text: "Let me think... The answer is 42.",
    });
  });

  it("handles multiple text blocks", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-multi" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "First block." },
      { type: "text-end", id: "text-1" },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "Second block." },
      { type: "text-end", id: "text-2" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);
    const msg = result.messages[0]!;

    assertEquals(msg.content, "First block.Second block.");
    assertEquals(msg.parts!.length, 2);
  });

  it("handles v4 legacy textDelta format", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-v4" },
      { type: "text-delta", textDelta: "Legacy " },
      { type: "text-delta", textDelta: "format" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);
    const msg = result.messages[0]!;

    // Note: v4 format doesn't include text parts in message.parts
    assertEquals(msg.content, "Legacy format");
  });

  it("handles data events", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-data" },
      { type: "data", data: { custom: "value" } },
      { type: "data", value: [1, 2, 3] },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Done" },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);

    assertEquals(result.dataEvents.length, 2);
    assertEquals(result.dataEvents[0], { custom: "value" });
    assertEquals(result.dataEvents[1], [1, 2, 3]);
  });
});
