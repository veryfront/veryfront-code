import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agUiSseEventTypes, parseAgUiSseResponse } from "./ag-ui-sse-parser.ts";

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
  it("parses browser-wire SSE chunks incrementally and reports progress", async () => {
    const progressEventCounts: number[] = [];
    const response = createSseResponse([
      'id: 1\nevent: RunStarted\ndata: {"runId":"run-1"}\n\n',
      'id: 2\nevent: ToolCallStart\ndata: {"toolCallName":"load_skill"}\n\n',
      'id: 3\nevent: ToolCallArgs\ndata: {"delta":"{\\"skillId\\":\\"plan\\"}"}\n\n',
      'id: 4\nevent: TextMessageContent\ndata: {"delta":"Hello"}\n\n',
      'id: 5\nevent: TextMessageContent\ndata: {"delta":" world"}\n\n',
      'id: 6\nevent: RunFinished\ndata: {"metadata":{"finishReason":"stop"}}\n\n',
    ]);

    const run = await parseAgUiSseResponse(response, {
      onProgress: (snapshot) => {
        progressEventCounts.push(snapshot.eventCount);
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
    assertEquals(progressEventCounts.at(-1), 6);
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
});
