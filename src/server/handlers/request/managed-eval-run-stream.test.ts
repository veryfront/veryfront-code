import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseAgUiSseResponse } from "#veryfront/agent/ag-ui/sse-parser.ts";
import { adaptManagedEvalRunStream } from "./managed-eval-run-stream.ts";

function frame(payload: Record<string, unknown>, id = 1) {
  return {
    event_id: id,
    event_type: payload.type,
    payload,
    is_error: payload.type === "RUN_ERROR",
    created_at: "2026-10-04T20:00:00.000Z",
  };
}

function wire(value: unknown, event = "TEXT_MESSAGE_CONTENT", id = "1") {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}

describe("managed eval canonical Runs stream", () => {
  it("delivers text, tool calls, errors and progress to the existing AG-UI eval consumer", async () => {
    const payloads = [
      { type: "RUN_STARTED", runId: "run" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "Paris" },
      { type: "TOOL_CALL_START", toolCallId: "search", toolCallName: "lookup" },
      { type: "TOOL_CALL_ARGS", toolCallId: "search", delta: '{"city":"Paris"}' },
      { type: "TOOL_CALL_RESULT", toolCallId: "search", content: "France" },
      { type: "RUN_ERROR", code: "TOOL_FAILED", message: "Lookup failed" },
    ];
    const progress: Array<
      { eventCount: number; textLength: number; lastEventType: string | null }
    > = [];
    const parsed = await parseAgUiSseResponse(
      adaptManagedEvalRunStream(
        new Response(
          payloads.map((payload, i) => wire(frame(payload, i + 1), payload.type, String(i + 1)))
            .join(""),
        ),
      ),
      { progressThrottleMs: 0, onProgress: (snapshot) => progress.push(snapshot) },
    );
    assertEquals(parsed.text, "Paris");
    assertEquals(parsed.toolStarts, ["lookup"]);
    assertEquals(parsed.toolArgs, ['{"city":"Paris"}']);
    assertEquals(parsed.events[4]?.content, "France");
    assertEquals(parsed.runError, "Lookup failed");
    assertEquals(parsed.events[5]?.code, "TOOL_FAILED");
    assertEquals(progress.at(-1)?.eventCount, 6);
    assertEquals(progress.at(-1)?.textLength, 5);
    assertEquals(progress.at(-1)?.lastEventType, "RUN_ERROR");
  });

  it("decodes split UTF-8 and CRLF frames without buffering the entire stream", async () => {
    const raw = wire(frame({ type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "東京" }))
      .replaceAll("\n", "\r\n");
    const bytes = new TextEncoder().encode(raw);
    let index = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(index, ++index));
      },
    });
    const parsed = await parseAgUiSseResponse(adaptManagedEvalRunStream(new Response(source)));
    assertEquals(parsed.text, "東京");
  });

  for (
    const [label, change] of [
      ["string cursor", { event_id: "1" }],
      ["negative cursor", { event_id: -1 }],
      ["missing classification", { is_error: undefined }],
      ["extra envelope field", { unexpected: true }],
      ["conflicting payload type", { payload: { type: "RUN_ERROR" } }],
    ] as const
  ) {
    it(`rejects a canonical frame with ${label}`, async () => {
      const value = { ...frame({ type: "TEXT_MESSAGE_CONTENT", delta: "Paris" }), ...change };
      await assertRejects(() =>
        parseAgUiSseResponse(adaptManagedEvalRunStream(new Response(wire(value))))
      );
    });
  }

  it("rejects an SSE event name or cursor that disagrees with the validated frame", async () => {
    const value = frame({ type: "TEXT_MESSAGE_CONTENT", delta: "Paris" });
    for (const raw of [wire(value, "RUN_ERROR"), wire(value, "TEXT_MESSAGE_CONTENT", "2")]) {
      await assertRejects(() => parseAgUiSseResponse(adaptManagedEvalRunStream(new Response(raw))));
    }
  });

  it("keeps bare AG-UI parsing available for non-Runs agent endpoints", async () => {
    const raw = 'event: TextMessageContent\ndata: {"delta":"Paris"}\n\n';
    assertEquals((await parseAgUiSseResponse(new Response(raw))).text, "Paris");
    await assertRejects(() => parseAgUiSseResponse(adaptManagedEvalRunStream(new Response(raw))));
  });

  it("cancels the upstream Runs reader when the eval consumer detaches", async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const adapted = adaptManagedEvalRunStream(new Response(source));
    await adapted.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(cancelled, true);
  });
});
