import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamAnthropicCompatibleParts } from "./anthropic-stream.ts";

type AnthropicStreamOptions = Parameters<typeof streamAnthropicCompatibleParts>[1];

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return streamFromChunks([text], { close: true });
}

function streamFromChunks(
  chunks: string[],
  options: { close: boolean },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (options.close) {
        controller.close();
      }
    },
  });
}

function streamFromChunksWithCancelSpy(
  chunks: string[],
  options: { closeDelayMs?: number; onCancel: () => void; onClose?: () => void },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (options.closeDelayMs !== undefined) {
        closeTimer = setTimeout(() => {
          controller.close();
          options.onClose?.();
        }, options.closeDelayMs);
      }
    },
    cancel() {
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
      options.onCancel();
    },
  });
}

async function collectParts(
  stream: ReadableStream<Uint8Array>,
  options?: AnthropicStreamOptions,
): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamAnthropicCompatibleParts(stream, options)) {
    parts.push(part);
  }
  return parts;
}

async function collectFirstParts(
  stream: ReadableStream<Uint8Array>,
  count: number,
): Promise<unknown[]> {
  const parts: unknown[] = [];
  const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();
  try {
    for (let index = 0; index < count; index++) {
      const next = await nextWithTimeout(iterator, 500);
      if (next.done) {
        break;
      }
      parts.push(next.value);
    }
  } finally {
    await iterator.return?.();
  }
  return parts;
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`timed out after ${timeoutMs}ms waiting for stream part`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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

  it("preserves Veryfront gateway billing metadata from usage envelopes", async () => {
    const parts = await collectParts(streamFromText([
      data({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 8,
            cache_read_input_tokens: 3,
          },
        },
      }),
      data({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Done." },
      }),
      data({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          output_tokens: 5,
          veryfront: {
            billable_input_tokens: 8,
            billable_output_tokens: 5,
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
    ].join("")));

    assertEquals(parts, [
      { type: "text-delta", delta: "Done." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: 8,
          outputTokens: 5,
          totalTokens: 13,
          cacheReadInputTokens: 3,
          billableInputTokens: 8,
          billableOutputTokens: 5,
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

  it("preserves gateway billing metadata appended after a client tool-use step", async () => {
    const parts = await collectParts(streamFromChunks([
      [
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
        data({
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 4 },
        }),
        data({ type: "message_stop" }),
      ].join(""),
      data({
        type: "message_delta",
        delta: {},
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          veryfront: {
            billable_input_tokens: 10,
            billable_output_tokens: 4,
            provider_cost_usd: 0.001,
            veryfront_charge_usd: 0.0025,
            veryfront_billed_usd: 0.1,
            cost_credits: 1,
            cost_source: "gateway",
            usage_capture_status: "complete",
          },
        },
      }),
    ], { close: true }));

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
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          billableInputTokens: 10,
          billableOutputTokens: 4,
          providerCostUsd: 0.001,
          veryfrontChargeUsd: 0.0025,
          veryfrontBilledUsd: 0.1,
          costCredits: 1,
          costSource: "gateway",
          usageCaptureStatus: "complete",
        },
      },
    ]);
  });

  it("drains the gateway billing metadata close after a client tool-use step", async () => {
    let cancelCount = 0;
    const parts = await collectParts(streamFromChunksWithCancelSpy([
      [
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
        data({
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 4 },
        }),
        data({ type: "message_stop" }),
      ].join(""),
      data({
        type: "message_delta",
        delta: {},
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          veryfront: {
            billable_input_tokens: 10,
            billable_output_tokens: 4,
            cost_source: "gateway",
            usage_capture_status: "complete",
          },
        },
      }),
    ], { closeDelayMs: 5, onCancel: () => cancelCount++ }));

    assertEquals(cancelCount, 0);
    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        billableInputTokens: 10,
        billableOutputTokens: 4,
        costSource: "gateway",
        usageCaptureStatus: "complete",
      },
    });
  });

  it("can finish a client tool-use step without canceling a delayed gateway tail", async () => {
    let cancelCount = 0;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const parts = await collectParts(
      streamFromChunksWithCancelSpy([
        [
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
          data({
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 4 },
          }),
          data({ type: "message_stop" }),
        ].join(""),
      ], {
        closeDelayMs: 150,
        onCancel: () => {
          cancelCount++;
          resolveClosed();
        },
        onClose: resolveClosed,
      }),
      { clientToolUseTrailingUsageTimeoutMode: "drain" },
    );

    await closed;

    assertEquals(cancelCount, 0);
    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: undefined,
        outputTokens: 4,
        totalTokens: 4,
      },
    });
  });

  it("finishes a client tool-use step when trailing metadata never arrives", async () => {
    const parts = await collectFirstParts(
      streamFromChunks(
        [[
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
          data({
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 4 },
          }),
          data({ type: "message_stop" }),
        ].join("")],
        { close: false },
      ),
      4,
    );

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
        usage: {
          inputTokens: undefined,
          outputTokens: 4,
          totalTokens: 4,
        },
      },
    ]);
  });
});
