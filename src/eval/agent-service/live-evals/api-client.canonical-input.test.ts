import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { cancelLiveEvalInputRequest, submitLiveEvalInputResponse } from "./api-client.ts";

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
  assertEquals(JSON.parse(calls[0].body!), { values: { answer: "yes" } });
});
