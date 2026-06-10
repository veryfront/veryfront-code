import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamAnthropicCompatibleParts } from "./anthropic-stream.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function hangingStreamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
    },
  });
}

async function collectParts(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamAnthropicCompatibleParts(stream)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `event: ${(payload as { type: string }).type}\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-anthropic/anthropic-stream", () => {
  it("preserves thinking, text, tool-call assembly, usage, and finish events", async () => {
    const parts = await collectParts(streamFromText([
      data({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 8,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 3,
          },
        },
      }),
      data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "Think" },
      }),
      data({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: " more" },
      }),
      data({ type: "content_block_stop", index: 0 }),
      "data: {malformed\r\n\r\n",
      data({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: { id: 1 } },
      }),
      data({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: ', "next": true' },
      }),
      data({ type: "content_block_stop", index: 1 }),
      data({
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: "Done." },
      }),
      data({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 5 },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "thinking-0" },
      { type: "reasoning-delta", id: "thinking-0", delta: "Think" },
      { type: "reasoning-delta", id: "thinking-0", delta: " more" },
      { type: "reasoning-end", id: "thinking-0" },
      { type: "tool-input-start", id: "toolu_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "toolu_1", delta: '{"id":1}' },
      { type: "tool-input-delta", id: "toolu_1", delta: ', "next": true' },
      {
        type: "tool-call",
        toolCallId: "toolu_1",
        toolName: "lookup",
        input: '{"id":1}, "next": true',
      },
      { type: "text-delta", delta: "Done." },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage: {
          inputTokens: 8,
          outputTokens: 5,
          totalTokens: 13,
          cacheCreationInputTokens: 2,
          cacheReadInputTokens: 3,
        },
      },
    ]);
  });

  it("emits zero-length reasoning blocks for redacted thinking", async () => {
    const parts = await collectParts(streamFromText([
      data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "encrypted" },
      }),
      data({ type: "content_block_stop", index: 0 }),
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "thinking-0" },
      { type: "reasoning-end", id: "thinking-0", redactedData: "encrypted" },
      { type: "finish", finishReason: null },
    ]);
  });

  it("ends a client tool-use step once the tool call is complete", async () => {
    let timeoutId: number | undefined;
    const parts = await Promise.race([
      collectParts(hangingStreamFromText([
        data({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "bash" },
        }),
        data({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"command":"pwd"}' },
        }),
        data({ type: "content_block_stop", index: 0 }),
      ].join(""))),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), 50);
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    });

    assertEquals(parts, [
      { type: "tool-input-start", id: "toolu_1", toolName: "bash" },
      { type: "tool-input-delta", id: "toolu_1", delta: '{"command":"pwd"}' },
      {
        type: "tool-call",
        toolCallId: "toolu_1",
        toolName: "bash",
        input: '{"command":"pwd"}',
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_use" },
      },
    ]);
  });
});
