import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamOpenAIResponsesParts } from "./openai-responses-stream.ts";

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
  for await (const part of streamOpenAIResponsesParts(stream)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-openai/openai-responses-stream", () => {
  it("preserves reasoning, text, tool-call assembly, usage, and finish events", async () => {
    const parts = await collectParts(streamFromText([
      data({ type: "response.output_item.added", item: { id: "rs_1", type: "reasoning" } }),
      data({
        type: "response.reasoning_summary_text.delta",
        item_id: "rs_1",
        delta: "Thinking",
      }),
      data({ type: "response.output_item.done", item: { id: "rs_1", type: "reasoning" } }),
      "data: {malformed\r\n\r\n",
      data({
        type: "response.output_item.added",
        item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "lookup" },
      }),
      data({
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        delta: '{"id":',
      }),
      data({
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        delta: '"abc"}',
      }),
      data({ type: "response.output_item.done", item: { id: "fc_1", type: "function_call" } }),
      data({
        type: "response.output_text.delta",
        item_id: "msg_1",
        delta: "Done.",
      }),
      data({
        type: "response.completed",
        response: {
          status: "completed",
          usage: {
            input_tokens: 5,
            output_tokens: 7,
            total_tokens: 12,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens_details: { reasoning_tokens: 2 },
          },
        },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Thinking" },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "tool-input-start", id: "call_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "call_1", delta: '{"id":' },
      { type: "tool-input-delta", id: "call_1", delta: '"abc"}' },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "lookup",
        input: '{"id":"abc"}',
      },
      { type: "text-delta", delta: "Done." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "completed" },
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          cacheReadInputTokens: 3,
          reasoningTokens: 2,
        },
      },
    ]);
  });

  it("normalizes incomplete and failed terminal events", async () => {
    const incomplete = await collectParts(streamFromText(data({
      type: "response.incomplete",
      response: {
        status: "incomplete",
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    })));
    const failed = await collectParts(streamFromText(data({
      type: "response.failed",
      response: { status: "failed" },
    })));

    assertEquals(incomplete, [{
      type: "finish",
      finishReason: { unified: "length", raw: "incomplete" },
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      },
    }]);
    assertEquals(failed, [{
      type: "finish",
      finishReason: { unified: "error", raw: "failed" },
    }]);
  });
});
