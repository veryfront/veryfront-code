import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { appendConversationRunEvents } from "./durable.ts";
it("adapts canonical append receipts while retaining original runtime payload identifiers", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let request: Request | undefined;
  const event = { type: "STATE_SNAPSHOT", snapshot: { runId: "original-runtime-id" } };
  const receipt = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "original-runtime-id",
    canonicalRunId: id,
    conversationId: id,
    events: [event],
    fetch: (_input, init) => {
      request = new Request(_input, init);
      return Promise.resolve(
        Response.json({
          run_id: id,
          latest_event_id: 7,
          latest_external_event_sequence: 5,
          appended_count: 1,
        }),
      );
    },
  });
  assertEquals(request!.url, `https://api.example.test/runs/${id}/events`);
  assertEquals((await request!.json()).events, [event]);
  assertEquals(receipt.latestEventId, 7);
  assertEquals(receipt.latestExternalEventSequence, 5);
  assertEquals(receipt.run.runId, "original-runtime-id");
});

import { flushConversationRunEventQueue } from "./durable.ts";
it("recovers authenticated cursor mismatch by append hints without any event read", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const methods: string[] = [];
  const result = await flushConversationRunEventQueue({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "original",
    canonicalRunId: id,
    conversationId: id,
    latestEventId: 1,
    latestExternalEventSequence: 1,
    maxEventsPerBatch: 100,
    maxCursorResyncsPerFlush: 2,
    events: [{ type: "STATE_SNAPSHOT", snapshot: {} }],
    fetch: (_input, init) => {
      methods.push(init?.method ?? "GET");
      if (methods.length === 1) {
        return Promise.resolve(
          Response.json({ detail: "External run event cursor mismatch" }, {
            status: 400,
            headers: { "X-Run-Latest-Event-Id": "5", "X-Run-Latest-External-Sequence": "3" },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          run_id: id,
          latest_event_id: 6,
          latest_external_event_sequence: 4,
          appended_count: 1,
        }),
      );
    },
  });
  assertEquals(methods, ["POST", "POST"]);
  assertEquals(result, { outcome: "flushed", latestEventId: 6, latestExternalEventSequence: 4 });
});

const ambiguousCursorHeaders: Record<string, string>[] = [{}, {
  "X-Run-Latest-Event-Id": "0",
  "X-Run-Latest-External-Sequence": "0",
}, {
  "X-Run-Latest-Event-Id": "5",
  "X-Run-Latest-External-Sequence": "invalid",
}];
for (const headers of ambiguousCursorHeaders) {
  it(`stops ambiguous append recovery without reading events: ${JSON.stringify(headers)}`, async () => {
    let calls = 0;
    const result = await flushConversationRunEventQueue({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "original",
      canonicalRunId: "11111111-1111-4111-8111-111111111111",
      conversationId: "11111111-1111-4111-8111-111111111111",
      latestEventId: 1,
      latestExternalEventSequence: 1,
      maxEventsPerBatch: 100,
      maxCursorResyncsPerFlush: 2,
      events: [{ type: "STATE_SNAPSHOT", snapshot: {} }],
      fetch: () => {
        calls++;
        return Promise.resolve(
          Response.json({ detail: "External run event cursor mismatch" }, { status: 400, headers }),
        );
      },
    });
    assertEquals(calls, 1);
    assertEquals(result.outcome, "stopped");
  });
}
