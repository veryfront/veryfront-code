import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  agUiSseEventTypes,
  type AgUiSseProgressSnapshot,
  parseAgUiSseResponse,
} from "./sse-parser.ts";

function createSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("agent/ag-ui-sse-parser", () => {
  it("parses SSE chunks incrementally and reports progress", async () => {
    const progressSnapshots: AgUiSseProgressSnapshot[] = [];
    const response = createSseResponse([
      'id: 1\nevent: RunStarted\ndata: {"runId":"run-1"}\n\n',
      'id: 2\nevent: ToolCallStart\ndata: {"toolCallName":"load_skill"}\n\n',
      'id: 3\nevent: ToolCallArgs\ndata: {"delta":"{\\"skillId\\":\\"plan\\"}"}\n\n',
      'id: 4\nevent: TextMessageContent\ndata: {"delta":"Hello"}\n\n',
      // the last text event is split across two reads so the parser has to carry
      // the partial event over the chunk boundary
      'id: 5\nevent: TextMessageContent\ndata: {"delta":" wor',
      'ld"}\n\n',
      'id: 6\nevent: RunFinished\ndata: {"metadata":{"finishReason":"stop"}}\n\n',
    ]);

    const run = await parseAgUiSseResponse(response, {
      onProgress: (snapshot) => {
        progressSnapshots.push(snapshot);
      },
      progressThrottleMs: 0,
    });

    assertEquals(run.eventTypes, [
      agUiSseEventTypes.runStarted,
      agUiSseEventTypes.toolCallStart,
      agUiSseEventTypes.toolCallArgs,
      agUiSseEventTypes.textMessageContent,
      agUiSseEventTypes.textMessageContent,
      agUiSseEventTypes.runFinished,
    ]);
    assertEquals(run.toolStarts, ["load_skill"]);
    assertEquals(run.toolArgs, ['{"skillId":"plan"}']);
    assertEquals(run.text, "Hello world");
    assertEquals(
      progressSnapshots.map((snapshot) => snapshot.eventCount),
      [1, 2, 3, 4, 5, 6, 6],
      "progress must be reported after each parsed event and once more after the stream ends",
    );
    assertEquals(
      progressSnapshots[2]?.lastToolCallName,
      "load_skill",
      "an incremental snapshot must be built from live run state",
    );
  });

  it("keeps parsing legacy raw AG-UI payloads", async () => {
    const response = createSseResponse([
      'id: 1\nevent: RunStarted\ndata: {"type":"RUN_STARTED"}\n\n',
      'id: 2\nevent: ToolCallResult\ndata: {"type":"TOOL_CALL_RESULT","content":"{\\"ok\\":true}"}\n\n',
      'id: 3\nevent: RunFinished\ndata: {"type":"RUN_FINISHED"}\n\n',
    ]);

    const run = await parseAgUiSseResponse(response);

    assertEquals(run.eventTypes, [
      agUiSseEventTypes.runStarted,
      agUiSseEventTypes.toolCallResult,
      agUiSseEventTypes.runFinished,
    ]);
    assertEquals(run.events[1]?.content, '{"ok":true}');
  });

  it("uses non-OK response text as run error when no RUN_ERROR event exists", async () => {
    const response = new Response("bad gateway", { status: 502 });

    const run = await parseAgUiSseResponse(response);

    assertEquals(run.responseStatus, 502);
    assertEquals(run.runError, "bad gateway");
  });

  it("uses a RUN_ERROR event message as the run error on a 200 response", async () => {
    const response = createSseResponse([
      'id: 1\nevent: RunError\ndata: {"message":"boom"}\n\n',
    ]);

    const run = await parseAgUiSseResponse(response);

    assertEquals(
      run.runError,
      "boom",
      "a RUN_ERROR event must set runError even on a 200 response",
    );
    assertEquals(
      run.eventTypes,
      [agUiSseEventTypes.runError],
      "the RunError event must be recorded",
    );
  });

  it("prefers the RUN_ERROR event message over non-OK response text", async () => {
    const response = createSseResponse([
      'id: 1\nevent: RunError\ndata: {"message":"boom"}\n\n',
    ], 502);

    const run = await parseAgUiSseResponse(response);

    assertEquals(
      run.runError,
      "boom",
      "the RUN_ERROR event message must win over non-OK body text",
    );
    assertEquals(run.responseStatus, 502, "the non-OK status must still be recorded");
  });
});
