import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamOpenAICompatibleParts } from "./openai-chat-stream.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function openStreamWithCancelSpy(text: string, onCancel: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
    },
    cancel: onCancel,
  });
}

async function collectParts(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamOpenAICompatibleParts(stream)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-openai/openai-chat-stream", () => {
  it("preserves reasoning, text, tool-call assembly, usage, and finish events", async () => {
    const parts = await collectParts(streamFromText([
      data({
        choices: [{
          delta: { reasoning_content: "think" },
        }],
      }),
      data({
        choices: [{
          delta: { content: "done" },
        }],
      }),
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              function: { name: "lookup", arguments: '{"id":' },
            }],
          },
        }],
      }),
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '"abc"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 1 },
          veryfront: {
            billable_input_tokens: 3,
            billable_output_tokens: 4,
            provider_input_cost_usd: 0.0004,
            provider_output_cost_usd: 0.0006,
            provider_cost_usd: 0.001,
            veryfront_input_charge_usd: 0.001,
            veryfront_output_charge_usd: 0.0015,
            veryfront_charge_usd: 0.0025,
            cost_source: "gateway",
            billing_mode: "deferred",
            usage_capture_status: "complete",
          },
        },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "think" },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "text-delta", delta: "done" },
      { type: "tool-input-start", id: "call_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "call_1", delta: '{"id":' },
      { type: "tool-input-delta", id: "call_1", delta: '"abc"}' },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "lookup",
        input: '{"id":"abc"}',
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
          cacheReadInputTokens: 2,
          reasoningTokens: 1,
          billableInputTokens: 3,
          billableOutputTokens: 4,
          providerInputCostUsd: 0.0004,
          providerOutputCostUsd: 0.0006,
          providerCostUsd: 0.001,
          veryfrontInputChargeUsd: 0.001,
          veryfrontOutputChargeUsd: 0.0015,
          veryfrontChargeUsd: 0.0025,
          costSource: "gateway",
          billingMode: "deferred",
          usageCaptureStatus: "complete",
        },
      },
    ]);
  });

  it("flushes trailing buffered usage records without a final delimiter", async () => {
    const parts = await collectParts(streamFromText(
      `data: ${
        JSON.stringify({
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
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

  it("cancels the upstream response when the consumer stops early", async () => {
    let cancelCount = 0;
    const stream = openStreamWithCancelSpy(
      data({
        choices: [{ delta: { content: "partial" } }],
      }),
      () => cancelCount++,
    );
    const iterator = streamOpenAICompatibleParts(stream)[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      value: { type: "text-delta", delta: "partial" },
      done: false,
    });
    await iterator.return?.();

    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });
});
