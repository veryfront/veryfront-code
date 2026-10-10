import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { listOpenLiveEvalInputRequests, waitForOpenLiveEvalInputRequest } from "./api-client.ts";

const requestId = "64fb6029-c081-4f3b-8612-770371e9fab7";

function contextFor(data: unknown[]) {
  return {
    apiUrl: "https://api.example.test",
    authToken: "test-token",
    projectId: null,
    fetch: () => Promise.resolve(Response.json({ data })),
  };
}

it("live eval sidecar finds the canonical API input request identifier", async () => {
  const id = await waitForOpenLiveEvalInputRequest(
    contextFor([{ input_request_id: requestId, status: "open" }]),
    {
      conversationId: "conversation",
      requestTimeoutMs: 1000,
      timeoutMs: 100,
      pollIntervalMs: 1,
      abortSignal: new AbortController().signal,
    },
  );
  assertEquals(id, requestId);
});

it("live eval input listing normalizes canonical and legacy IDs without ambiguity", async () => {
  const records = await listOpenLiveEvalInputRequests(
    contextFor([
      { input_request_id: requestId, status: "open" },
      { id: "legacy-request", status: "open" },
      { id: requestId, input_request_id: requestId, status: "open" },
      { id: "different", input_request_id: requestId, status: "open" },
      { input_request_id: "", status: "open" },
      { input_request_id: " padded ", status: "open" },
      { input_request_id: 42, status: "open" },
      { input_request_id: requestId, status: "submitted" },
      { status: "open" },
      null,
    ]),
    { conversationId: "conversation", requestTimeoutMs: 1000 },
  );
  assertEquals(records, [
    { id: requestId, status: "open" },
    { id: "legacy-request", status: "open" },
    { id: requestId, status: "open" },
  ]);
});
