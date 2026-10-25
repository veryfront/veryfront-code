import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamAnthropicCompatibleParts } from "../../../extensions/ext-llm-anthropic/src/anthropic-stream.ts";
import { summarizeErrorCausesForLog } from "../../../src/observability/telemetry-error.ts";
import { createRuntimeProviderStreamFailure } from "../../../src/runtime/provider-stream-error-provenance.ts";

async function parserFailure(sequence: boolean): Promise<unknown> {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tool_fixture",
        name: "update_file",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: sequence ? '{"path":"fixture.ts"}' : '{"path":"fixture.ts"',
      },
    },
    ...(sequence ? [] : [{ type: "content_block_stop", index: 0 }]),
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 8 },
    },
    { type: "message_stop" },
  ];
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  try {
    for await (const _part of streamAnthropicCompatibleParts(body)) {
      /* Consume the real parser. */
    }
  } catch (e) {
    return e;
  }
  throw new Error("Expected the parser to reject the malformed fixture");
}

/** Push raw bytes that exceed the SSE remainder (line) limit. */
async function sseRemainderLimitFailure(): Promise<unknown> {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // 8,388,609 bytes without a line terminator exceeds the 8,388,608 limit.
      c.enqueue(new Uint8Array(8_388_609).fill(0x78));
      c.close();
    },
  });
  try {
    for await (const _part of streamAnthropicCompatibleParts(body)) {
      /* drain */
    }
  } catch (e) {
    return e;
  }
  throw new Error("Expected the SSE remainder limit to reject");
}

/** Push bytes that exceed the SSE event limit without exceeding the line limit. */
async function sseEventLimitFailure(): Promise<unknown> {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Two lines: 4,194,304 + newline + 4,194,305 = 8,388,610 event bytes.
      // Each line is under 8,388,608 so the remainder limit does not fire.
      const buf = new Uint8Array(8_388_610);
      buf.fill(0x78);
      buf[4_194_304] = 0x0a;
      c.enqueue(buf);
      c.close();
    },
  });
  try {
    for await (const _part of streamAnthropicCompatibleParts(body)) {
      /* drain */
    }
  } catch (e) {
    return e;
  }
  throw new Error("Expected the SSE event limit to reject");
}

/** Send enough empty partial_json deltas to exceed the empty-fragment limit. */
async function partialJsonEmptyFragmentsFailure(): Promise<unknown> {
  const header = [
    {
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tool_fixture",
        name: "update_file",
        input: {},
      },
    },
  ];
  const delta = {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: "" },
  };
  // 4,097 empty deltas exceed the 4,096 limit.
  const events = [...header, ...Array.from({ length: 4_097 }, () => delta)];
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  try {
    for await (const _part of streamAnthropicCompatibleParts(body)) {
      /* drain */
    }
  } catch (e) {
    return e;
  }
  throw new Error("Expected the partial_json empty-fragment limit to reject");
}

/** Send a single partial_json delta that exceeds the byte limit. */
async function partialJsonBytesFailure(): Promise<unknown> {
  const header = [
    {
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tool_fixture",
        name: "update_file",
        input: {},
      },
    },
  ];
  // 1,048,577 bytes exceeds the 1,048,576 limit.
  const delta = {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: "x".repeat(1_048_577) },
  };
  const events = [...header, delta];
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  try {
    for await (const _part of streamAnthropicCompatibleParts(body)) {
      /* drain */
    }
  } catch (e) {
    return e;
  }
  throw new Error("Expected the partial_json byte limit to reject");
}

describe("Anthropic stream diagnostic regression", () => {
  it("preserves distinct parser failure reasons in safe telemetry", async () => {
    const a = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(await parserFailure(false)),
    );
    const b = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(await parserFailure(true)),
    );
    assertNotEquals(a, b);
    assertEquals(typeof a?.[0]?.streamIssue, "string");
    assertEquals(typeof b?.[0]?.streamIssue, "string");
  });

  it("records trusted provenance from real parser errors", async () => {
    const cause = await parserFailure(false);
    const summary = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(cause),
    );
    assertEquals(summary?.[0]?.provider, "anthropic");
    assertEquals(summary?.[0]?.status, 200);
    assertEquals(
      summary?.[0]?.streamIssue,
      "tool call arguments were not valid JSON object text",
    );
  });

  it("records SSE remainder limit as a distinct streamIssue", async () => {
    const cause = await sseRemainderLimitFailure();
    const summary = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(cause),
    );
    assertEquals(summary?.[0]?.name, "RangeError");
    assertEquals(
      summary?.[0]?.streamIssue,
      "Anthropic SSE remainder exceeded 8388608 bytes",
    );
  });

  it("records SSE event limit as a distinct streamIssue", async () => {
    const cause = await sseEventLimitFailure();
    const summary = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(cause),
    );
    assertEquals(summary?.[0]?.name, "RangeError");
    assertEquals(
      summary?.[0]?.streamIssue,
      "Anthropic SSE event exceeded 8388608 bytes",
    );
  });

  it("records partial_json empty-fragment limit as a distinct streamIssue", async () => {
    const cause = await partialJsonEmptyFragmentsFailure();
    const summary = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(cause),
    );
    assertEquals(summary?.[0]?.name, "RangeError");
    assertEquals(
      summary?.[0]?.streamIssue,
      "Anthropic partial_json exceeded 4096 empty fragments",
    );
  });

  it("records partial_json byte limit as a distinct streamIssue", async () => {
    const cause = await partialJsonBytesFailure();
    const summary = summarizeErrorCausesForLog(
      createRuntimeProviderStreamFailure(cause),
    );
    assertEquals(summary?.[0]?.name, "RangeError");
    assertEquals(
      summary?.[0]?.streamIssue,
      "Anthropic partial_json exceeded 1048576 UTF-8 bytes",
    );
  });
});
