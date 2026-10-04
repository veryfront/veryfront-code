import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createExternalAgentWorkerClient } from "./external-worker-client.ts";
const id = "11111111-1111-4111-8111-111111111111";
const publicId = "worker-original";
const terminal = `header.${
  btoa(
    JSON.stringify({
      runId: publicId,
      canonicalRunId: id,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "generation",
    }),
  )
}.signature`;
const run = {
  run_id: publicId,
  conversation_id: id,
  message_id: id,
  project_id: id,
  agent_id: "worker",
  status: "running",
  request_snapshot: null,
  latest_event_id: 2,
  latest_external_event_sequence: 1,
  lease_owner: id,
  lease_expires_at: null,
  worker_session: null,
};
it("privately retains server-issued claim authority for canonical append and finalize", async () => {
  const calls: Request[] = [];
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    fetch: (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Promise.resolve(Response.json(
        request.url.endsWith("/claim")
          ? {
            run,
            credentials: {
              auth_token: "invocation",
              run_event_token: "writer",
              run_terminal_token: terminal,
            },
          }
          : { id, status: "completed" },
      ));
    },
  });
  const claimed = await client.claimRun({ workerId: id, leaseDurationSeconds: 30 });
  assertEquals(claimed, run);
  assertEquals(JSON.stringify(claimed).includes(terminal), false);
  await client.appendRunEvents({ runId: publicId, conversationId: id, events: [] });
  await client.completeRun({ runId: publicId, status: "completed" });
  assert(calls[1] && calls[2]);
  assertEquals(calls[1].url, `https://api.example.test/runs/${id}/events`);
  assertEquals(calls[1].headers.get("Authorization"), "Bearer writer");
  assertEquals(calls[2].url, `https://api.example.test/runs/${id}/finalize`);
  assertEquals(calls[2].headers.get("Authorization"), "Bearer invocation");
  assertEquals(calls[2].headers.get("X-Veryfront-Run-Terminal-Token"), terminal);
  assertEquals(await calls[2].json(), { status: "completed", output: null });
  await assertRejects(
    () => client.completeRun({ runId: publicId, status: "completed" }),
    Error,
    "claim authority",
  );
  await assertRejects(
    () => client.completeRun({ runId: "foreign", status: "completed" }),
    Error,
    "claim authority",
  );
});
