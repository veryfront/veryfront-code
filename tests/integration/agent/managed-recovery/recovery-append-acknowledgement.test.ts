import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { readRecoveryAppendAcknowledgement } from "#veryfront/internal-agents/recovery-append-acknowledgement.ts";

const runId = "24ce3538-5ff2-4364-90af-1f174709ae78";
const ack = {
  run_id: runId,
  latest_event_id: 309,
  latest_external_event_sequence: 7,
  appended_count: 1,
};
it("recovery uses the actual external append cursor, never the database cursor", async () => {
  assertEquals(await readRecoveryAppendAcknowledgement(Response.json(ack), runId), ack);
  await assertRejects(() =>
    readRecoveryAppendAcknowledgement(
      Response.json({
        ...ack,
        latest_external_event_sequence: undefined,
      }),
      runId,
    )
  );
  await assertRejects(() =>
    readRecoveryAppendAcknowledgement(Response.json(ack), "94b3ac6f-26b0-4993-9c35-98f6406fae23")
  );
});
it("recovery append acknowledgements reject malformed, excessive and failed responses", async () => {
  for (
    const response of [
      Response.json({ ...ack, unexpected: true }),
      Response.json({ ...ack, latest_external_event_sequence: -1 }),
      Response.json({ ...ack, acknowledged_event_ids: [0] }),
      Response.json({ ...ack, acknowledged_event_ids: [Number.MAX_SAFE_INTEGER + 1] }),
      Response.json({ ...ack, acknowledged_event_ids: Array.from({ length: 101 }, () => 1) }),
      new Response("not-json"),
      new Response("x".repeat(65_537)),
      Response.json(ack, { status: 503 }),
    ]
  ) {
    await assertRejects(() => readRecoveryAppendAcknowledgement(response, runId));
  }
});

it("original checkpoint persister waits for the actual canonical append receipt", async () => {
  const { createRunScopedProviderReplayCheckpointPersister } = await import(
    "#veryfront/internal-agents/provider-replay-checkpoint-persister.ts"
  );
  const checkpoint = {
    version: 1 as const,
    messageId: "assistant-boundary",
    provider: "anthropic" as const,
    providerBlocks: [{
      type: "provider-block" as const,
      provider: "anthropic" as const,
      block: { type: "thinking", thinking: "synthetic", signature: "synthetic" },
    }],
    providerBlockPositions: [0],
    providerMessageBlockCounts: [1],
    totalPartCount: 1,
  };
  let acknowledgements = 0;
  let response: unknown = ack;
  const persist = createRunScopedProviderReplayCheckpointPersister({
    apiUrl: "https://api.veryfront.com",
    runId,
    runEventAppendToken: "synthetic-writer",
    fetch: () => Promise.resolve(Response.json(response)),
    onAcknowledged: (observed, receipt) => {
      assertEquals(observed, checkpoint);
      assertEquals(receipt.latest_external_event_sequence, 7);
      acknowledgements++;
      return Promise.resolve();
    },
  })!;
  await persist(checkpoint);
  assertEquals(acknowledgements, 1);
  response = { ...ack, latest_external_event_sequence: undefined };
  await assertRejects(() => persist(checkpoint));
  assertEquals(acknowledgements, 1);
});

it("replayed acknowledgements retain exact original row IDs independently of latest global cursor", async () => {
  const replay = { ...ack, appended_count: 0, acknowledged_event_ids: [41] };
  const observed = await readRecoveryAppendAcknowledgement(Response.json(replay), runId);
  assertEquals(observed.acknowledged_event_ids, [41]);
  assertEquals(observed.latest_event_id, 309);
  assertEquals(observed.latest_external_event_sequence, 7);
});
