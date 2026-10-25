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
});
