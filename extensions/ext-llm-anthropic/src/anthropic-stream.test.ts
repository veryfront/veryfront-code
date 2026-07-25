import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProviderOverloadedError, ProviderRequestError } from "veryfront/provider/shared";
import {
  addAnthropicUsage,
  extractAnthropicUsage,
  streamAnthropicCompatibleParts,
} from "./anthropic-stream.ts";

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

function streamWithNeverSettlingCancel(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
    },
    cancel() {
      return new Promise<void>(() => {});
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

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`timed out after ${timeoutMs}ms waiting for promise`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for condition`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function data(payload: unknown): string {
  return `event: ${(payload as { type: string }).type}\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`;
}

describe("ext-llm-anthropic/anthropic-stream", () => {
  it("sanitizes usage at the exported extraction boundary", () => {
    assertEquals(
      extractAnthropicUsage({
        usage: {
          input_tokens: Number.MAX_SAFE_INTEGER + 1,
          output_tokens: 2,
          cache_creation_input_tokens: 1.5,
          veryfront: {
            provider_cost_usd: Number.POSITIVE_INFINITY,
            cost_credits: 0.25,
          },
        },
      }),
      {
        outputTokens: 2,
        totalTokens: 2,
        costCredits: 0.25,
      },
    );
  });

  it("rejects invalid trailing-usage timers without locking the body", async () => {
    for (const invalidTimeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const stream = streamFromText("");
      await assertRejects(
        () =>
          collectParts(stream, {
            clientToolUseTrailingUsageGraceMs: invalidTimeout,
          }),
        RangeError,
      );
      assertEquals(stream.locked, false);
    }
  });

  it("adds continuation usage without emitting unsafe or non-finite totals", () => {
    assertEquals(
      addAnthropicUsage(
        {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
          providerCostUsd: 1.25,
          costUsd: 2,
        },
        {
          inputTokens: 9,
          outputTokens: 3,
          totalTokens: 12,
          providerCostUsd: 0.75,
          costUsd: 3,
        },
      ),
      {
        inputTokens: 17,
        outputTokens: 5,
        totalTokens: 22,
        costUsd: 5,
        providerCostUsd: 2,
      },
    );

    assertEquals(
      addAnthropicUsage(
        {
          inputTokens: Number.MAX_SAFE_INTEGER,
          totalTokens: Number.MAX_SAFE_INTEGER,
          providerCostUsd: Number.MAX_VALUE,
        },
        {
          inputTokens: 1,
          totalTokens: 1,
          providerCostUsd: Number.MAX_VALUE,
        },
      ),
      undefined,
    );
    assertEquals(
      addAnthropicUsage(undefined, {
        inputTokens: Number.POSITIVE_INFINITY,
        providerCostUsd: Number.NaN,
      }),
      undefined,
    );
  });

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
      data({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
      }),
      data({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"id":1' },
      }),
      data({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: ',"next":true}' },
      }),
      data({ type: "content_block_stop", index: 1 }),
      data({
        type: "content_block_start",
        index: 2,
        content_block: { type: "text", text: "" },
      }),
      data({
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: "Done." },
      }),
      data({ type: "content_block_stop", index: 2 }),
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
      { type: "tool-input-delta", id: "toolu_1", delta: '{"id":1' },
      { type: "tool-input-delta", id: "toolu_1", delta: ',"next":true}' },
      {
        type: "tool-call",
        toolCallId: "toolu_1",
        toolName: "lookup",
        input: '{"id":1,"next":true}',
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

  it("accepts exactly 1 MiB of partial_json then rejects the next byte and cancels", async () => {
    let cancelCount = 0;
    const exactBoundaryPartialJson = "é".repeat(524_288);
    const stream = streamFromChunksWithCancelSpy([
      [
        data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
        data({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_oversized", name: "bash" },
        }),
        data({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: exactBoundaryPartialJson },
        }),
        data({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "x" },
        }),
      ].join(""),
    ], { onCancel: () => cancelCount++ });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "tool-input-start", id: "toolu_oversized", toolName: "bash" },
    });
    assertEquals(await iterator.next(), {
      done: false,
      value: {
        type: "tool-input-delta",
        id: "toolu_oversized",
        delta: exactBoundaryPartialJson,
      },
    });
    await assertRejects(
      () => iterator.next(),
      RangeError,
      "partial_json exceeded 1048576 UTF-8 bytes",
    );
    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });

  it("rejects more than 4096 partial_json deltas and cancels the provider body", async () => {
    let cancelCount = 0;
    const stream = streamFromChunksWithCancelSpy([
      [
        data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
        data({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_many_deltas", name: "bash" },
        }),
        ...Array.from({ length: 4_097 }, () =>
          data({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: "" },
          })),
      ].join(""),
    ], { onCancel: () => cancelCount++ });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    assertEquals((await iterator.next()).done, false);
    for (let index = 0; index < 4_096; index++) {
      assertEquals((await iterator.next()).done, false);
    }
    await assertRejects(
      () => iterator.next(),
      RangeError,
      "partial_json exceeded 4096 deltas",
    );
    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });

  it("caps an unterminated SSE remainder and cancels the provider body", async () => {
    let cancelCount = 0;
    const stream = streamFromChunksWithCancelSpy([
      "x".repeat(8_388_609),
    ], { onCancel: () => cancelCount++ });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    await assertRejects(
      () => iterator.next(),
      RangeError,
      "SSE remainder exceeded 8388608 bytes",
    );
    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });

  it("caps a complete SSE event across individually bounded lines and cancels", async () => {
    let cancelCount = 0;
    const boundedLine = `:${"x".repeat(4_200_000)}\n`;
    const stream = streamFromChunksWithCancelSpy([
      `${boundedLine}${boundedLine}\n`,
    ], { onCancel: () => cancelCount++ });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    await assertRejects(
      () => iterator.next(),
      RangeError,
      "SSE event exceeded 8388608 bytes",
    );
    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });

  it("rejects invalid UTF-8 and malformed JSON as contextual stream failures", async () => {
    let invalidUtf8CancelCount = 0;
    const invalidUtf8 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array([
            ...new TextEncoder().encode("data: "),
            0xc3,
            0x28,
            0x0a,
            0x0a,
          ]),
        );
      },
      cancel() {
        invalidUtf8CancelCount++;
      },
    });
    await assertRejects(
      () => collectParts(invalidUtf8),
      ProviderRequestError,
      "SSE event was not valid UTF-8",
    );
    assertEquals(invalidUtf8CancelCount, 1);
    assertEquals(invalidUtf8.locked, false);

    let malformedJsonCancelCount = 0;
    const malformedJson = streamFromChunksWithCancelSpy(
      ['data: {"type":\n\n'],
      { onCancel: () => malformedJsonCancelCount++ },
    );
    await assertRejects(
      () => collectParts(malformedJson),
      ProviderRequestError,
      "SSE event contained malformed JSON",
    );
    assertEquals(malformedJsonCancelCount, 1);
    assertEquals(malformedJson.locked, false);
  });

  it("fails closed on unknown typed stream events", async () => {
    let cancelCount = 0;
    const stream = streamFromChunksWithCancelSpy([
      data({
        type: "message_start",
        message: { usage: { input_tokens: 1 } },
      }) + data({ type: "future_actionable_event" }),
    ], { onCancel: () => cancelCount++ });

    await assertRejects(
      () => collectParts(stream),
      ProviderRequestError,
      "unsupported event type",
    );
    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });

  it("surfaces HTTP-200 SSE error events as typed failures and cancels", async () => {
    let cancelCount = 0;
    const privateProviderMessage = "private upstream diagnostic";
    const stream = streamFromChunksWithCancelSpy([
      data({
        type: "error",
        error: { type: "overloaded_error", message: privateProviderMessage },
      }),
    ], { onCancel: () => cancelCount++ });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    const error = await assertRejects(
      () => iterator.next(),
      ProviderOverloadedError,
      "provider overloaded",
    );
    if (!(error instanceof ProviderOverloadedError)) {
      throw new Error("Expected a ProviderOverloadedError");
    }
    assertEquals(error.message.includes(privateProviderMessage), false);
    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
  });

  it("cancels the provider body when the consumer returns early", async () => {
    let cancelCount = 0;
    const stream = streamFromChunksWithCancelSpy([
      data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
      data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "partial" },
      }),
    ], { closeDelayMs: 600, onCancel: () => cancelCount++ });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "text-delta", delta: "partial" },
    });
    await iterator.return?.();

    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
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
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      data({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Done." },
      }),
      data({ type: "content_block_stop", index: 0 }),
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
      data({ type: "message_stop" }),
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
      data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
      data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "encrypted" },
      }),
      data({ type: "content_block_stop", index: 0 }),
      data({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      }),
      data({ type: "message_stop" }),
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "thinking-0" },
      { type: "reasoning-end", id: "thinking-0", redactedData: "encrypted" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: { inputTokens: 1, totalTokens: 1 },
      },
    ]);
  });

  it("fully processes a trailing terminal event without a final delimiter", async () => {
    const terminal = { type: "message_stop" };
    const parts = await collectParts(streamFromText([
      data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
      data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "tail" },
      }),
      data({ type: "content_block_stop", index: 0 }),
      data({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 },
      }),
      `event: ${terminal.type}\r\ndata: ${JSON.stringify(terminal)}`,
    ].join("")));

    assertEquals(parts, [
      { type: "text-delta", delta: "tail" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);
  });

  it("recognizes bare-CR SSE framing before the provider closes the stream", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        controller.enqueue(encoder.encode([
          'event: message_start\rdata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\r\r',
          'event: content_block_start\rdata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Hello"}}\r\r',
        ].join("")));
      },
    });
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();
    let settledBeforeFallback = false;
    const nextPart = iterator.next().then((part) => {
      settledBeforeFallback = true;
      return part;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const parsedBeforeFallback = settledBeforeFallback;
    controller.enqueue(encoder.encode("\n"));
    controller.close();

    assertEquals(await nextPart, {
      done: false,
      value: { type: "text-delta", delta: "Hello" },
    });
    assertEquals(parsedBeforeFallback, true);
    await assertRejects(
      () => iterator.next(),
      ProviderRequestError,
      "unfinished content blocks",
    );
  });

  it("rejects structurally empty, unterminated, and malformed tool streams", async () => {
    await assertRejects(
      () => collectParts(streamFromText(data({ type: "ping" }))),
      ProviderRequestError,
      "stream contained no provider envelope",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "partial" },
          }),
          data({ type: "content_block_stop", index: 0 }),
        ].join(""))),
      ProviderRequestError,
      "stream ended before a stop reason",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_bad", name: "lookup", input: {} },
          }),
          data({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"id":' },
          }),
          data({ type: "content_block_stop", index: 0 }),
        ].join(""))),
      ProviderRequestError,
      "tool call arguments were not valid JSON object text",
    );
    await assertRejects(
      () => collectParts(streamFromText(data({ type: "message_stop" }))),
      ProviderRequestError,
      "message_stop was out of sequence",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "first" },
          }),
          data({ type: "content_block_stop", index: 0 }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "second" },
          }),
          data({ type: "content_block_stop", index: 0 }),
          data({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
          data({ type: "message_stop" }),
        ].join(""))),
      ProviderRequestError,
      "content block index was reused",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "done" },
          }),
          data({ type: "content_block_stop", index: 0 }),
          data({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
          "data: [DONE]\r\n\r\n",
          "data: [DONE]\r\n\r\n",
        ].join(""))),
      ProviderRequestError,
      "terminal marker was out of sequence",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "web_search_tool_result",
              content: [],
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "web-search result block was malformed",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "" },
          }),
          data({
            type: "content_block_delta",
            index: 0,
            delta: { type: "signature_delta", signature: 42 },
          }),
        ].join(""))),
      ProviderRequestError,
      "signature delta was malformed",
    );
  });

  it("accepts a complete empty assistant stream", async () => {
    for (
      const terminal of [
        data({ type: "message_stop" }),
        "data: [DONE]\r\n\r\n",
      ]
    ) {
      assertEquals(
        await collectParts(streamFromText([
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
          data({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
          terminal,
        ].join(""))),
        [{
          type: "finish",
          finishReason: { unified: "stop", raw: "end_turn" },
          usage: { inputTokens: 1, totalTokens: 1 },
        }],
      );
    }
  });

  it("does not finish a client-tool stream while a later content block is unfinished", async () => {
    let cancelCount = 0;
    const stream = streamFromChunksWithCancelSpy([
      [
        data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
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
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "unfinished" },
        }),
      ].join(""),
    ], {
      closeDelayMs: 30,
      onCancel: () => cancelCount++,
    });

    await assertRejects(
      () =>
        collectParts(stream, {
          clientToolUseTrailingUsageGraceMs: 5,
        }),
      ProviderRequestError,
      "unfinished content blocks",
    );
    assertEquals(cancelCount, 0);
  });

  it("does not await a hostile provider body cancellation forever", async () => {
    const stream = streamWithNeverSettlingCancel(
      data({
        type: "message_start",
        message: { usage: { input_tokens: 1 } },
      }) + data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "partial" },
      }),
    );
    const iterator = streamAnthropicCompatibleParts(stream)[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "text-delta", delta: "partial" },
    });
    assertEquals(
      await promiseWithTimeout(
        iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
        100,
      ),
      { done: true, value: undefined },
    );
    assertEquals(stream.locked, false);
  });

  it("preserves gateway billing metadata appended after a client tool-use step", async () => {
    const parts = await collectParts(
      streamFromChunks([
        [
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
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
      ], { close: true }),
      { allowPostTerminalUsage: true },
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
    const parts = await collectParts(
      streamFromChunksWithCancelSpy([
        [
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
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
      ], { closeDelayMs: 5, onCancel: () => cancelCount++ }),
      {
        allowPostTerminalUsage: true,
      },
    );

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
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
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
      {
        clientToolUseTrailingUsageTimeoutMode: "drain",
        allowPostTerminalUsage: true,
      },
    );

    await closed;

    assertEquals(cancelCount, 0);
    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: 1,
        outputTokens: 4,
        totalTokens: 5,
      },
    });
  });

  it("cancels and releases a gateway tail after the drain deadline", async () => {
    let cancelCount = 0;
    const stream = streamFromChunksWithCancelSpy([
      [
        data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
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
      closeDelayMs: 600,
      onCancel: () => cancelCount++,
    });

    const parts = await collectParts(stream, {
      clientToolUseTrailingUsageGraceMs: 5,
      clientToolUseTrailingUsageTimeoutMode: "drain",
      clientToolUseTrailingUsageDrainTimeoutMs: 20,
      allowPostTerminalUsage: true,
    });

    await waitForCondition(() => cancelCount === 1 && !stream.locked, 500);

    assertEquals(cancelCount, 1);
    assertEquals(stream.locked, false);
    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: 1,
        outputTokens: 4,
        totalTokens: 5,
      },
    });
  });

  it("finishes a client tool-use step when trailing metadata never arrives", async () => {
    const parts = await collectFirstParts(
      streamFromChunks(
        [[
          data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
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
          inputTokens: 1,
          outputTokens: 4,
          totalTokens: 5,
        },
      },
    ]);
  });
});
