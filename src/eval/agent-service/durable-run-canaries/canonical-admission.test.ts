import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { createDurableRunCanaryApiClient } from "./runner.ts";
Deno.test("durable canary admits once and reads canonical identity with the real snapshot cursor", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const conversation = "22222222-2222-4222-8222-222222222222";
  const message = "33333333-3333-4333-8333-333333333333";
  const calls: Array<{ path: string; body?: Record<string, unknown>; headers: Headers }> = [];
  const client = createDurableRunCanaryApiClient({
    apiUrl: "https://api.example.test",
    authToken: "fixture",
    projectId: id,
    agentId: "agent",
    requestTimeoutMs: 1000,
    fetch: (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(
        Response.json(
          path.endsWith("/snapshot") ? { after_event_id: 7, events: [] } : {
            id,
            conversation_id: conversation,
            output_message_id: message,
            status: "completed",
          },
        ),
      );
    },
  });
  await client.startDurableRun({
    conversationId: conversation,
    runId: "canary-key",
    messageId: "",
    prompt: "prove output",
    userMessageId: message,
  });
  const summary = await client.getRunSummary({ conversationId: conversation, runId: "canary-key" });
  assertEquals(calls.map((x) => x.path), ["/runs", `/runs/${id}`, `/runs/${id}/snapshot`]);
  assert(calls[0]);
  assertEquals(calls[0].body?.target, { type: "agent", id: "agent" });
  assertEquals(calls[0].body?.config, {
    agent_admission: { mode: "hosted", input_message_id: message, client_run_id: "canary-key" },
  });
  assert(calls[0].headers.get("Idempotency-Key"));
  assertEquals(summary.latestEventId, 7);
  assertEquals(summary.latestExternalEventSequence, null);
  assertEquals(summary.messageId, message);
});
