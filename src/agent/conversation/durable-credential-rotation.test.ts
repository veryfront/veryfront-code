import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createConversationRunEventQueueController } from "./durable.ts";

it("reads renewed writer credentials for each batch and cursor retry in one flush", async () => {
  const canonicalRunId = "11111111-1111-4111-8111-111111111111";
  let token = "writer-1";
  const authorization: (string | null)[] = [];
  const deltas: string[][] = [];
  let cursor = 0;
  const queue = createConversationRunEventQueueController({
    authToken: "launch-writer",
    getAuthToken: () => token,
    apiUrl: "https://api.example.test",
    conversationId: "22222222-2222-4222-8222-222222222222",
    runId: "runtime-run",
    canonicalRunId,
    latestEventId: 0,
    latestExternalEventSequence: 0,
    maxEventsPerBatch: 2,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      authorization.push(request.headers.get("Authorization"));
      const body = await request.json();
      deltas.push(body.events.map((event: { delta: string }) => event.delta));
      token = `writer-${authorization.length + 1}`;
      if (authorization.length === 2) {
        cursor += 1;
        return Response.json({ detail: "External run event cursor mismatch" }, {
          status: 400,
          headers: {
            "X-Run-Latest-Event-Id": String(cursor),
            "X-Run-Latest-External-Sequence": String(cursor),
          },
        });
      }
      cursor += body.events.length;
      return Response.json({
        run_id: canonicalRunId,
        latest_event_id: cursor,
        latest_external_event_sequence: cursor,
        appended_count: body.events.length,
      });
    },
  });
  queue.enqueue(Array.from({ length: 5 }, (_, index) => ({
    type: "TOOL_CALL_ARGS",
    toolCallId: "call-test",
    delta: String(index),
  })));
  const result = await queue.flush();
  assertEquals(result.outcome, "flushed");
  assertEquals(authorization, [
    "Bearer writer-1",
    "Bearer writer-2",
    "Bearer writer-3",
    "Bearer writer-4",
  ]);
  assertEquals(deltas, [["0", "1"], ["2", "3"], ["2", "3"], ["4"]]);
  assertEquals(queue.getSnapshot().pendingEventCount, 0);
});
