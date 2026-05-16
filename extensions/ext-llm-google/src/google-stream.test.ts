import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamGoogleCompatibleParts } from "./google-stream.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collectParts(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamGoogleCompatibleParts(stream)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-google/google-stream", () => {
  it("preserves thought, text, tool-call, usage, and finish events", async () => {
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Think", thought: true }],
          },
        }],
      }),
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Done." }],
          },
        }],
      }),
      "data: {malformed\r\n\r\n",
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { id: "tool_1", name: "lookup", args: { id: "abc" } } }],
          },
        }],
      }),
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { id: "tool_1", name: "lookup", args: { id: "abc" } } }],
          },
        }],
      }),
      data({
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 7,
          totalTokenCount: 12,
          cachedContentTokenCount: 3,
        },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Think" },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "text-delta", delta: "Done." },
      { type: "tool-input-start", id: "tool_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "tool_1", delta: '{"id":"abc"}' },
      {
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "lookup",
        input: '{"id":"abc"}',
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          cacheReadInputTokens: 3,
        },
      },
    ]);
  });

  it("flushes trailing buffered usage records without a final delimiter", async () => {
    const parts = await collectParts(streamFromText(
      `data: ${
        JSON.stringify({
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            totalTokenCount: 3,
          },
        })
      }`,
    ));

    assertEquals(parts, [{
      type: "finish",
      finishReason: null,
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
    }]);
  });
});
