import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseDataStreamSseEvents,
  parseToolInputObject,
  streamDataStreamEvents,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";

const encoder = new TextEncoder();

function captureConsoleLog(): { getOutput: () => string; restore: () => void } {
  const originalLog = console.log;
  const originalDebug = console.debug;
  let capturedOutput = "";

  const capture = (msg: string) => {
    capturedOutput = msg;
  };

  console.log = capture;
  console.debug = capture;

  return {
    getOutput: () => capturedOutput,
    restore: () => {
      console.log = originalLog;
      console.debug = originalDebug;
    },
  };
}

function encodeEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function withJsonDebugLogFormat<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("LOG_FORMAT", "json");
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();

  try {
    return await fn();
  } finally {
    Deno.env.delete("LOG_FORMAT");
    Deno.env.delete("LOG_LEVEL");
    __resetLoggerConfigForTests();
  }
}

describe("agent/data-stream", () => {
  it("parses complete frames and preserves incomplete remainder", () => {
    const parsed = parseDataStreamSseEvents(
      'data: {"type":"text-delta","id":"text-1","delta":"hello"}\n\n' +
        'data: {"type":"step-end"}\n\n' +
        'data: {"type":"message-start"',
    );

    assertEquals(parsed.events, [
      { type: "text-delta", id: "text-1", delta: "hello" },
      { type: "step-end" },
    ]);
    assertEquals(parsed.remainder, 'data: {"type":"message-start"');
  });

  it("streams trailing final frames even when the upstream body omits the closing blank line", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"message-start","messageId":"assistant-1"}\n\n'),
        );
        controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"hello"}'));
        controller.close();
      },
    });

    const events: Array<Record<string, unknown>> = [];
    for await (const event of streamDataStreamEvents(stream)) {
      events.push(event);
    }

    assertEquals(events, [
      { type: "message-start", messageId: "assistant-1" },
      { type: "text-delta", delta: "hello" },
    ]);
  });

  it("propagates upstream stream read errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeEvent({ type: "message-start", messageId: "assistant-1" }));
        controller.error(new Error("stream exploded"));
      },
    });

    await assertRejects(
      async () => {
        for await (const _event of streamDataStreamEvents(stream)) {
          // drain until the read rejects
        }
      },
      Error,
      "stream exploded",
    );
  });

  it("debug logs reader cancellation failures when the consumer stops early", async () => {
    const { getOutput, restore } = captureConsoleLog();

    try {
      await withJsonDebugLogFormat(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encodeEvent({ type: "message-start", messageId: "assistant-1" }));
          },
          cancel() {
            throw new Error("cancel failed");
          },
        });

        for await (const event of streamDataStreamEvents(stream)) {
          assertEquals(event, { type: "message-start", messageId: "assistant-1" });
          break;
        }
      });
    } finally {
      restore();
    }

    const entry = JSON.parse(getOutput()) as LogEntry;
    assertEquals(entry.component, "agent-data-stream");
    assertEquals(entry.level, "debug");
    assertEquals(entry.message, "Data stream reader cancellation failed during cleanup");
  });

  it("drops malformed SSE data blocks and returns an empty events array", () => {
    const parsed = parseDataStreamSseEvents("data: {invalid json}\n\n");
    assertEquals(parsed.events, []);
    assertEquals(parsed.remainder, "");
  });

  it("drops blocks that contain no data: lines (e.g. comment-only or blank blocks)", () => {
    // A block with only a comment line has no data: lines — must yield [].
    const withComment = parseDataStreamSseEvents("comment: ignored\n\n");
    assertEquals(withComment.events, []);
    assertEquals(withComment.remainder, "");

    // A block that is just whitespace also has no data: lines.
    const blankBlock = parseDataStreamSseEvents("\n\n");
    assertEquals(blankBlock.events, []);
    assertEquals(blankBlock.remainder, "");
  });

  it("drops the [DONE] sentinel block without throwing", () => {
    // SSE streams commonly terminate with `data: [DONE]`. [DONE] is not valid
    // JSON, so parseDataStreamSseEvents must drop it silently and return [].
    const parsed = parseDataStreamSseEvents("data: [DONE]\n\n");
    assertEquals(parsed.events, []);
    assertEquals(parsed.remainder, "");
  });

  it("normalizes streamed tool input placeholders consistently", () => {
    assertEquals(
      stripLeadingEmptyObjectPlaceholder('{} {"query":"Veryfront"}'),
      '{"query":"Veryfront"}',
    );
    assertEquals(mergeToolInputDelta("{}", '{"query":"Veryfront"}'), '{"query":"Veryfront"}');
    assertEquals(mergeToolCallInput('{"query":"Veryfront"}', "{}"), '{"query":"Veryfront"}');
    assertEquals(
      parseToolInputObject('{} {"query":"Veryfront"}'),
      { query: "Veryfront" },
    );
  });

  it("repairs placeholder deltas when the provider streams the object body without a leading brace", () => {
    assertEquals(
      stripLeadingEmptyObjectPlaceholder('{}"path":"/plans/report.md","content":"# Report"}'),
      '{"path":"/plans/report.md","content":"# Report"}',
    );
    assertEquals(
      mergeToolInputDelta("{}", '"path":"/plans/report.md","content":"# Report"}'),
      '{"path":"/plans/report.md","content":"# Report"}',
    );
    assertEquals(
      parseToolInputObject('{}"path":"/plans/report.md","content":"# Report"}'),
      { path: "/plans/report.md", content: "# Report" },
    );
  });

  it("dedupes cumulative streamed tool argument buffers instead of concatenating them", () => {
    const firstDelta = '{"path":"plans/report.md","content":"# Report';
    const cumulativeSecondDelta =
      '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}';

    const merged = mergeToolInputDelta(firstDelta, cumulativeSecondDelta);

    assertEquals(
      merged,
      '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
    );
    assertEquals(
      parseToolInputObject(merged),
      {
        path: "plans/report.md",
        content: "# Report\n\nExecutive summary",
      },
    );
  });

  it("merges overlapping tool argument deltas without duplicating the shared prefix", () => {
    const firstDelta = '{"path":"plans/report.md","content":"# Report';
    const overlappingSecondDelta = 'Report\\n\\nExecutive summary"}';

    const merged = mergeToolInputDelta(firstDelta, overlappingSecondDelta);

    assertEquals(
      merged,
      '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
    );
    assertEquals(
      parseToolInputObject(merged),
      {
        path: "plans/report.md",
        content: "# Report\n\nExecutive summary",
      },
    );
  });

  it("dedupes repeated placeholder-style cumulative chunks that omit the opening brace", () => {
    const firstDelta = mergeToolInputDelta(
      "{}",
      '"path":"plans/report.md","content":"# Report',
    );

    assertEquals(firstDelta, '{"path":"plans/report.md","content":"# Report');

    const secondDelta = mergeToolInputDelta(
      firstDelta,
      '"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
    );

    assertEquals(
      secondDelta,
      '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
    );
    assertEquals(
      parseToolInputObject(secondDelta),
      {
        path: "plans/report.md",
        content: "# Report\n\nExecutive summary",
      },
    );
  });

  it("normalizes a first streamed delta that starts at the first property without an opening brace", () => {
    const merged = mergeToolInputDelta(
      "",
      '"path":"plans/report.md","content":"# Report"}',
    );

    assertEquals(
      merged,
      '{"path":"plans/report.md","content":"# Report"}',
    );
    assertEquals(
      parseToolInputObject(merged),
      { path: "plans/report.md", content: "# Report" },
    );
  });

  it("preserves normalized partial streamed arguments when the later tool-call payload is only an empty object", () => {
    const normalizedPartial = mergeToolInputDelta(
      "",
      '"path":"plans/report.md","content":"# Report',
    );

    assertEquals(
      mergeToolCallInput(normalizedPartial, "{}"),
      '{"path":"plans/report.md","content":"# Report',
    );
  });

  // ============================================================================
  // Regression tests for the false-overlap drop bug observed in staging on
  // 2026-04-15. The streamed-tool-call classifier from PR #1082 surfaced
  // `create_file` tool calls with partial argument buffers shaped like:
  //
  //   {"project_reference": "13c888cc-ad7f-40af-81bf-d939fc922713", athplans/...
  //   {"project_reference": "13c888cc-ad7f-40af-81bf-d939fc922713", "path"plans/...
  //
  // i.e., 2–5 characters silently dropped from the middle of the buffer.
  //
  // Root cause: the tail-overlap loop inside mergeToolInputDelta accepted any
  // match of length ≥ 1 as a "retransmission" and trimmed that many chars off
  // the incoming delta. When the buffer coincidentally ended with a single
  // character that also appeared at the start of the next append-mode delta
  // (common in JSON: `"`, `:`, `,`), the loop dropped 1–2 chars off delta,
  // producing a corrupted merged buffer.
  //
  // These tests pin the invariant: mergeToolInputDelta must NEVER drop
  // characters in the middle of a pure append-mode sequence. The legitimate
  // overlap-dedup case (where the provider actually retransmits a multi-char
  // tail) continues to work — see the existing
  // "merges overlapping tool argument deltas without duplicating the shared
  // prefix" test above, which asserts a 6-char `Report` overlap is still
  // deduped.
  // ============================================================================
  describe("append-mode correctness (regression for #false-overlap-drops)", () => {
    function mergeChunks(chunks: string[]): string {
      return chunks.reduce((acc, chunk) => mergeToolInputDelta(acc, chunk), "");
    }

    it("preserves both quotes when current ends with a quote and next delta opens with a quote", () => {
      // If the provider is in pure append mode, the correct delta boundary
      // is `{"a":"x"` + `,"name":"y"}` (no retransmission). If instead the
      // delta starts with `","name":"y"}` the concatenation is lossless:
      // `{"a":"x"","name":"y"}` — invalid JSON that the downstream parser
      // will reject loudly. That is strictly better than silently dropping
      // the leading `"` of the delta (the production corruption observed
      // in staging). LOSSLESS concat is the invariant.
      const merged = mergeToolInputDelta('{"a":"x"', '","name":"y"}');
      assertEquals(merged, '{"a":"x"","name":"y"}');
    });

    it('does not drop ": " when the previous delta ended mid-key', () => {
      // Exact shape of the staging corruption: buffer ends with `"path"`,
      // next delta starts with `: "plans/..."`. Naive overlap dedup would
      // false-match the single trailing `"` of `"path"` against the first
      // character of the delta and drop it.
      const merged = mergeToolInputDelta(
        '{"project_reference": "13c888cc-ad7f-40af-81bf-d939fc922713", "path"',
        ': "plans/ai-code-review-bots-research.md"}',
      );
      assertEquals(
        merged,
        '{"project_reference": "13c888cc-ad7f-40af-81bf-d939fc922713", "path": "plans/ai-code-review-bots-research.md"}',
      );
      assertEquals(parseToolInputObject(merged), {
        project_reference: "13c888cc-ad7f-40af-81bf-d939fc922713",
        path: "plans/ai-code-review-bots-research.md",
      });
    });

    it("does not drop a trailing comma when the next delta starts with a comma", () => {
      const merged = mergeToolInputDelta('{"a":1,', ',"b":2}');
      // With 1-char false-match dedup this would become `{"a":1,"b":2}` which
      // happens to parse but silently corrupts the sequence — two distinct
      // commas in the stream become one, which would also corrupt the text
      // case where a comma is part of a string value. Guarantee the two
      // chars are preserved; downstream JSON validity is the parser's job.
      assertEquals(merged, '{"a":1,,"b":2}');
    });

    it("reconstructs a realistic create_file tool call split into append-mode chunks", () => {
      // Chunks intentionally split on boundaries that overlap in single
      // characters with the next chunk (e.g. `"` → `"`, `,` → `,`) so every
      // transition exercises the false-match path.
      const chunks = [
        '{"project_reference": "13c888cc-ad7f-40af-81bf-d939fc922713"',
        ', "path": "/plans/ai-code-review-bots-research.md"',
        ', "content": "# AI Code Review Bots Research Report"',
        "}",
      ];

      const merged = mergeChunks(chunks);

      assertEquals(merged, chunks.join(""));
      assertEquals(parseToolInputObject(merged), {
        project_reference: "13c888cc-ad7f-40af-81bf-d939fc922713",
        path: "/plans/ai-code-review-bots-research.md",
        content: "# AI Code Review Bots Research Report",
      });
    });

    it("handles many single-character append-mode chunks without dropping anything", () => {
      // Pathological but deterministic: stream the JSON one character at a
      // time. Every single transition has a 1-char overlap opportunity that
      // the old logic could false-match against (current ends with `X`, next
      // starts with `X`). A correct implementation must produce the exact
      // concatenation.
      const fullJson = '{"a":"hello","b":42,"c":[1,2,3],"d":{"nested":true}}';
      const chunks = Array.from(fullJson);

      const merged = mergeChunks(chunks);

      assertEquals(merged, fullJson);
      assertEquals(parseToolInputObject(merged), {
        a: "hello",
        b: 42,
        c: [1, 2, 3],
        d: { nested: true },
      });
    });

    it("still dedupes a legitimate multi-char overlap from a retransmitting provider", () => {
      // Regression-within-a-regression: the false-match fix must not regress
      // the intended overlap-dedup behavior pinned by commit 24e1da60e
      // ("Prevent cumulative tool-arg chunks from corrupting child calls").
      // A 6-char `Report` overlap is unambiguously a retransmission, not a
      // coincidence, and must still be deduped.
      const first = '{"path":"plans/report.md","content":"# Report';
      const second = 'Report\\n\\nExecutive summary"}';
      const merged = mergeToolInputDelta(first, second);
      assertEquals(
        merged,
        '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
      );
    });
  });
});
