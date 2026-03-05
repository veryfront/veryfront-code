/**
 * Tests for SSE line-buffering across chunk boundaries.
 *
 * Validates that `handleStreamingResponse` correctly reassembles SSE
 * events when `reader.read()` splits them mid-line — the fix from #477.
 */
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";

import { handleStreamingResponse } from "../../src/agent/react/use-chat/streaming/index.ts";
import type {
  UIMessage,
  UIMessagePart,
} from "../../src/agent/react/use-chat/index.ts";

/**
 * Creates a ReadableStream that delivers raw bytes in the exact chunks provided.
 * This lets us simulate network-level splitting where an SSE line is cut
 * across two or more `read()` calls.
 */
function createRawStream(rawChunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of rawChunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

interface SimpleResult {
  messages: UIMessage[];
  updates: Array<{ parts: UIMessagePart[]; messageId: string }>;
}

async function processRawStream(rawChunks: string[]): Promise<SimpleResult> {
  const messages: UIMessage[] = [];
  const updates: Array<{ parts: UIMessagePart[]; messageId: string }> = [];

  await handleStreamingResponse(createRawStream(rawChunks), {
    onMessage: (msg) => messages.push(msg),
    onData: () => {},
    onUpdate: (parts, messageId) => updates.push({ parts, messageId }),
    onToolCall: () => {},
  });

  return { messages, updates };
}

function sse(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("SSE line-buffering across chunk boundaries", () => {
  it("reassembles a single event split across two chunks", async () => {
    const event = { type: "text-delta", id: "t1", delta: "Hello World" };
    const line = `data: ${JSON.stringify(event)}\n\n`;
    // Split the line in the middle of the JSON payload
    const splitPoint = Math.floor(line.length / 2);

    const result = await processRawStream([
      sse({ type: "message-start", messageId: "msg-buf" }),
      sse({ type: "text-start", id: "t1" }),
      line.slice(0, splitPoint), // first half of text-delta
      line.slice(splitPoint), // second half of text-delta
      sse({ type: "text-end", id: "t1" }),
      sse({ type: "message-finish" }),
    ]);

    assertEquals(result.messages.length, 1);
    const textPart = result.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "Hello World");
  });

  it("handles event split across three chunks", async () => {
    const event = { type: "text-delta", id: "t1", delta: "ABC" };
    const line = `data: ${JSON.stringify(event)}\n\n`;
    const third = Math.floor(line.length / 3);

    const result = await processRawStream([
      sse({ type: "message-start", messageId: "msg-3" }),
      sse({ type: "text-start", id: "t1" }),
      line.slice(0, third),
      line.slice(third, third * 2),
      line.slice(third * 2),
      sse({ type: "text-end", id: "t1" }),
      sse({ type: "message-finish" }),
    ]);

    assertEquals(result.messages.length, 1);
    const textPart = result.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "ABC");
  });

  it("handles multiple events in a single chunk", async () => {
    // All events packed into one chunk — tests that the parser doesn't break
    const allInOne =
      sse({ type: "message-start", messageId: "msg-pack" }) +
      sse({ type: "text-start", id: "t1" }) +
      sse({ type: "text-delta", id: "t1", delta: "packed" }) +
      sse({ type: "text-end", id: "t1" }) +
      sse({ type: "message-finish" });

    const result = await processRawStream([allInOne]);

    assertEquals(result.messages.length, 1);
    const textPart = result.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "packed");
  });

  it("handles split right at the newline boundary", async () => {
    const event = { type: "text-delta", id: "t1", delta: "edge" };
    const json = JSON.stringify(event);
    // Split: "data: {...}" in one chunk, "\n\n" in the next
    const result = await processRawStream([
      sse({ type: "message-start", messageId: "msg-nl" }),
      sse({ type: "text-start", id: "t1" }),
      `data: ${json}`,
      "\n\n",
      sse({ type: "text-end", id: "t1" }),
      sse({ type: "message-finish" }),
    ]);

    assertEquals(result.messages.length, 1);
    const textPart = result.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "edge");
  });

  it("handles final event with no trailing newline (buffer flush)", async () => {
    // Simulate a stream that ends with data in the buffer (no trailing \n\n)
    const result = await processRawStream([
      sse({ type: "message-start", messageId: "msg-flush" }),
      sse({ type: "text-start", id: "t1" }),
      sse({ type: "text-delta", id: "t1", delta: "flushed" }),
      sse({ type: "text-end", id: "t1" }),
      `data: ${JSON.stringify({ type: "message-finish" })}`, // no trailing newline
    ]);

    assertEquals(result.messages.length, 1);
    const textPart = result.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "flushed");
  });

  it("survives interleaved tool + text events split across chunks", async () => {
    const toolStart = sse({
      type: "tool-input-start",
      toolCallId: "c1",
      toolName: "search",
    });
    const toolAvail = sse({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "search",
      input: { q: "test" },
    });
    const textDelta = sse({ type: "text-delta", id: "t1", delta: "result" });

    // Split tool-input-available across chunks
    const splitPoint = Math.floor(toolAvail.length / 2);

    const result = await processRawStream([
      sse({ type: "message-start", messageId: "msg-mix" }),
      toolStart,
      toolAvail.slice(0, splitPoint),
      toolAvail.slice(splitPoint),
      sse({ type: "text-start", id: "t1" }),
      textDelta,
      sse({ type: "text-end", id: "t1" }),
      sse({ type: "message-finish" }),
    ]);

    assertEquals(result.messages.length, 1);
    const parts = result.messages[0]!.parts;
    const textPart = parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "result");
  });
});
