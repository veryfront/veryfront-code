import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  cancelLiveEvalInputRequest,
  listOpenLiveEvalInputRequests,
  submitLiveEvalInputResponse,
  waitForOpenLiveEvalInputRequest,
} from "./api-client.ts";

const CANONICAL_INPUT_REQUEST_ID = "00000000-0000-4000-8000-000000000101";
const LEGACY_INPUT_REQUEST_ID = "00000000-0000-4000-8000-000000000102";

function createApiContext(data: unknown) {
  return {
    apiUrl: "https://api.example.test",
    authToken: "test-token",
    projectId: null,
    fetch: () => Promise.resolve(Response.json({ data })),
  };
}

Deno.test("live eval responses use the global input resource and a mutation idempotency key", async () => {
  const calls: { url: string; headers: Headers; body: string | undefined }[] = [];
  const context = {
    apiUrl: "https://api.example.test",
    authToken: "test-token",
    projectId: null,
    fetch: (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: init?.body as string | undefined,
      });
      return Promise.resolve(Response.json({ id: "request-id", status: "submitted" }));
    },
  };
  await submitLiveEvalInputResponse(context, {
    conversationId: "conversation",
    inputRequestId: "request-id",
    values: { answer: "yes" },
    requestTimeoutMs: 1000,
  });
  await cancelLiveEvalInputRequest(context, {
    conversationId: "conversation",
    inputRequestId: "request-id",
    requestTimeoutMs: 1000,
  });
  assertEquals(calls.map((call) => new URL(call.url).pathname), [
    "/input-requests/request-id/responses",
    "/input-requests/request-id/cancel",
  ]);
  for (const call of calls) assert(call.headers.get("Idempotency-Key"));
  assert(calls[0]);
  assert(calls[0].body);
  assertEquals(JSON.parse(calls[0].body), { values: { answer: "yes" } });
});

Deno.test("live eval input request polling accepts canonical input_request_id records", async () => {
  const context = createApiContext([
    { input_request_id: CANONICAL_INPUT_REQUEST_ID, status: "open" },
  ]);
  const inputRequestId = await waitForOpenLiveEvalInputRequest(context, {
    conversationId: "conversation",
    requestTimeoutMs: 1000,
    timeoutMs: 100,
    pollIntervalMs: 0,
    abortSignal: new AbortController().signal,
  });

  assertEquals(inputRequestId, CANONICAL_INPUT_REQUEST_ID);
});

Deno.test("live eval input request listing keeps canonical and legacy open records", async () => {
  const context = createApiContext([
    { input_request_id: CANONICAL_INPUT_REQUEST_ID, status: "open" },
    { id: LEGACY_INPUT_REQUEST_ID, status: "open" },
    { input_request_id: "not-a-uuid", status: "open" },
    { input_request_id: "00000000-0000-4000-8000-000000000103", status: "submitted" },
    {
      id: "00000000-0000-4000-8000-000000000104",
      input_request_id: "00000000-0000-4000-8000-000000000105",
      status: "open",
    },
  ]);
  const inputRequests = await listOpenLiveEvalInputRequests(context, {
    conversationId: "conversation",
    requestTimeoutMs: 1000,
  });

  assertEquals(inputRequests, [
    { id: CANONICAL_INPUT_REQUEST_ID, status: "open" },
    { id: LEGACY_INPUT_REQUEST_ID, status: "open" },
  ]);
});

Deno.test("live eval input request polling rejects malformed canonical records", async () => {
  const context = createApiContext([
    { input_request_id: "not-a-uuid", status: "open" },
  ]);
  await assertRejects(
    () =>
      waitForOpenLiveEvalInputRequest(context, {
        conversationId: "conversation",
        requestTimeoutMs: 1000,
        timeoutMs: 1,
        pollIntervalMs: 0,
        abortSignal: new AbortController().signal,
      }),
    Error,
    "Timed out while waiting for an open input request",
  );
});
