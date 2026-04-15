import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseDataStreamSseEvents,
  parseToolInputObject,
  streamDataStreamEvents,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";

const encoder = new TextEncoder();

function encodeEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
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
});
