/**
 * Tests for useChat v5 stream protocol handling
 * Following AI SDK v5 UI Message types and patterns
 */
import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

// Import AI SDK v5 compatible types for testing
import type {
  UIMessage,
  UIMessagePart,
  ToolUIPart,
  ToolState,
} from "../../src/ai/react/hooks/use-chat.ts";

/**
 * Internal tool tracking during streaming (mirrors implementation)
 */
interface StreamingToolCall {
  toolCallId: string;
  toolName: string;
  inputText: string;
  input?: unknown;
  output?: unknown;
  state: ToolState;
}

/**
 * Internal reasoning tracking during streaming
 */
interface StreamingReasoning {
  id: string;
  text: string;
  isComplete: boolean;
}

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
 * Returns AI SDK v5 compatible UIMessage format
 */
async function processV5Stream(
  stream: ReadableStream<Uint8Array>,
): Promise<{
  messages: UIMessage[];
  toolCalls: StreamingToolCall[];
  reasoningBlocks: StreamingReasoning[];
  dataEvents: unknown[];
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const textBlocks = new Map<string, { text: string; state: "streaming" | "done" }>();
  let currentTextId = "";
  let messageId = "";

  const toolCalls = new Map<string, StreamingToolCall>();
  const reasoningBlocks = new Map<string, StreamingReasoning>();
  const messageParts: UIMessagePart[] = [];
  const messages: UIMessage[] = [];
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
              textBlocks.set(currentTextId, { text: "", state: "streaming" });
              break;

            case "text-delta": {
              const textId = parsed.id || currentTextId || "default";
              const delta = parsed.delta || "";
              if (!textBlocks.has(textId)) {
                textBlocks.set(textId, { text: "", state: "streaming" });
                currentTextId = textId;
              }
              const block = textBlocks.get(textId)!;
              block.text += delta;
              break;
            }

            case "text-end": {
              const textId = parsed.id || currentTextId;
              const block = textBlocks.get(textId);
              if (block && block.text) {
                block.state = "done";
                messageParts.push({ type: "text", text: block.text, state: "done" });
              }
              break;
            }

            case "tool-input-start": {
              const toolCallId = parsed.toolCallId;
              toolCalls.set(toolCallId, {
                toolCallId,
                toolName: parsed.toolName,
                inputText: "",
                state: "input-streaming",
              });
              break;
            }

            case "tool-input-delta": {
              const toolCall = toolCalls.get(parsed.toolCallId);
              if (toolCall) {
                toolCall.inputText += parsed.inputTextDelta || "";
              }
              break;
            }

            case "tool-input-available": {
              const toolCall = toolCalls.get(parsed.toolCallId);
              if (toolCall) {
                toolCall.input = parsed.input;
                toolCall.state = "input-available";
                messageParts.push({
                  type: "tool-call",
                  toolCallId: parsed.toolCallId,
                  toolName: toolCall.toolName,
                  state: "input-available",
                  input: toolCall.input,
                });
              }
              break;
            }

            case "tool-output-available": {
              const toolCall = toolCalls.get(parsed.toolCallId);
              if (toolCall) {
                toolCall.output = parsed.output;
                toolCall.state = "output-available";
                messageParts.push({
                  type: "tool-result",
                  toolCallId: parsed.toolCallId,
                  toolName: toolCall.toolName,
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
                  text: reasoning.text,
                  state: "done",
                });
              }
              break;
            }

            case "finish": {
              // AI SDK v5: UIMessage uses parts array, no content string
              messages.push({
                id: messageId,
                role: "assistant",
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

/**
 * Helper to get text content from UIMessage parts
 */
function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
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
    assertEquals(msg.id, "msg-123");
    assertEquals(msg.role, "assistant");
    assertEquals(msg.parts.length, 1);
    assertEquals(msg.parts[0], { type: "text", text: "Hello World", state: "done" });
    assertEquals(getTextContent(msg), "Hello World");
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

    // Check tool calls tracking
    assertEquals(result.toolCalls.length, 1);
    assertEquals(toolCall.toolCallId, "call-1");
    assertEquals(toolCall.toolName, "getWeather");
    assertEquals(toolCall.input, { city: "Tokyo" });
    assertEquals(toolCall.output, { temp: 72, weather: "sunny" });
    assertEquals(toolCall.state, "output-available");

    // Check message parts - AI SDK v5 format
    assertEquals(msg.parts.length, 3);

    // Tool call part
    const toolCallPart = msg.parts[0] as ToolUIPart;
    assertEquals(toolCallPart.type, "tool-call");
    assertEquals(toolCallPart.toolCallId, "call-1");
    assertEquals(toolCallPart.toolName, "getWeather");
    assertEquals(toolCallPart.state, "input-available");
    assertEquals(toolCallPart.input, { city: "Tokyo" });

    // Tool result part
    assertEquals(msg.parts[1], {
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "getWeather",
      result: { temp: 72, weather: "sunny" },
    });

    // Text part
    assertEquals(msg.parts[2], {
      type: "text",
      text: "The weather in Tokyo is sunny.",
      state: "done",
    });
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

    // Check reasoning blocks tracking
    assertEquals(result.reasoningBlocks.length, 1);
    assertEquals(reasoning.id, "reason-1");
    assertEquals(reasoning.text, "Let me think... The answer is 42.");
    assertEquals(reasoning.isComplete, true);

    // Check message parts - AI SDK v5 format
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

    assertEquals(msg.parts.length, 2);
    assertEquals(getTextContent(msg), "First block.Second block.");
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

  it("uses parts array as primary content structure (AI SDK v5)", async () => {
    const stream = createV5Stream([
      { type: "start", messageId: "msg-v5" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello v5" },
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ]);

    const result = await processV5Stream(stream);
    const msg = result.messages[0]!;

    // AI SDK v5: UIMessage uses parts array, not content string
    assertExists(msg.parts);
    assertEquals(msg.parts.length, 1);
    assertEquals(msg.parts[0]!.type, "text");

    // No content property in v5 UIMessage
    assertEquals("content" in msg, false);
  });
});
