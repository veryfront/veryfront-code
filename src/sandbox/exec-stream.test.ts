import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExecStreamEvent } from "./types.ts";
import { readExecStreamEvents } from "./exec-stream.ts";

/** Streams `chunks` verbatim so chunk boundaries can be placed deliberately. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ExecStreamEvent[]> {
  const events: ExecStreamEvent[] = [];
  for await (const event of readExecStreamEvents(stream)) events.push(event);
  return events;
}

describe("sandbox/exec-stream", () => {
  it("yields one event per NDJSON line", async () => {
    const events = await collect(streamOf(
      '{"type":"stdout","data":"a"}\n{"type":"stderr","data":"b"}\n{"type":"exit","exitCode":0}\n',
    ));

    assertEquals(events.map((event) => event.type), ["stdout", "stderr", "exit"]);
  });

  it("keeps streaming past a malformed line", async () => {
    const events = await collect(streamOf(
      '{"type":"stdout","data":"a"}\n',
      "<<garbage>>\n",
      '{"type":"exit","exitCode":0}\n',
    ));

    assertEquals(
      events.map((event) => event.type),
      ["stdout", "exit"],
      "a truncated chunk must not discard the events buffered around it",
    );
  });

  it("discards a malformed final chunk rather than throwing", async () => {
    const events = await collect(streamOf('{"type":"stdout","data":"a"}\n', "{truncated"));

    assertEquals(
      events.map((event) => event.type),
      ["stdout"],
      "an unterminated trailing chunk must not surface as a SyntaxError",
    );
  });

  it("yields a final line that arrives without a trailing newline", async () => {
    const events = await collect(streamOf('{"type":"exit","exitCode":3}'));

    assertEquals(events.length, 1, "the last line need not be newline-terminated");
    assertEquals(events[0]?.exitCode, 3);
  });

  it("reassembles an event split across chunk boundaries", async () => {
    const events = await collect(streamOf('{"type":"std', 'out","data":"split"}\n'));

    assertEquals(events.length, 1, "a JSON object split mid-token must be rejoined, not dropped");
    assertEquals(events[0]?.data, "split");
  });

  it("ignores blank lines", async () => {
    const events = await collect(streamOf('\n\n{"type":"exit","exitCode":0}\n\n'));

    assertEquals(events.length, 1);
  });

  it("cancels the body when the caller stops iterating early", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"stdout","data":"a"}\n'));
        controller.enqueue(encoder.encode('{"type":"exit","exitCode":0}\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const _event of readExecStreamEvents(stream)) break;

    assertEquals(cancelled, true, "abandoning the generator must not leave the body open");
  });
});
