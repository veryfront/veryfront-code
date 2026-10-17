import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { getRecoveryCheckpointSidecarSchema } from "#veryfront/internal-agents/recovery-checkpoint-contract.ts";
const vector = {
  version: 1,
  binding: {
    identity: {
      projectId: "11111111-1111-4111-8111-111111111111",
      canonicalRunId: "22222222-2222-4222-8222-222222222222",
      publicRunId: "run-abi-proof",
      sourceHash: "a".repeat(64),
    },
    generation: {
      workerId: "worker-a",
      dispatchNonce: "66666666-6666-4666-8666-000000000001",
      transportRecoveryAttempt: 1,
    },
    sourceBinding: {
      projectId: "11111111-1111-4111-8111-111111111111",
      environmentId: "33333333-3333-4333-8333-333333333333",
      releaseId: "44444444-4444-4444-8444-444444444444",
    },
  },
  acknowledgedEventId: 91,
  acknowledgedExternalSequence: 17,
  messages: [],
  modelTurns: [],
  toolBoundaries: [],
  toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
  runtimeContinuation: {
    version: 1,
    nextStep: 3,
    messages: [],
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    latestAssistantText: "",
    completed: false,
    recoveredEmptyResponse: false,
    recoveredInterruptedLocalToolBatch: false,
  },
};

function sidecar() {
  const { acknowledgedEventId: _database, acknowledgedExternalSequence: _external, ...snapshot } =
    vector;
  return { snapshot_event_index: 0, pending_model_turn_message_ids: [], snapshot };
}

it("atomic checkpoint accepts the last bounded batch position and rejects overflow", () => {
  const schema = getRecoveryCheckpointSidecarSchema();
  assertEquals(schema.parse({ ...sidecar(), snapshot_event_index: 99 }).snapshot_event_index, 99);
  for (const snapshot_event_index of [-1, 100, 0.5]) {
    assertThrows(() => schema.parse({ ...sidecar(), snapshot_event_index }));
  }
});

it("atomic checkpoint rejects duplicate pending model message identities", () => {
  const schema = getRecoveryCheckpointSidecarSchema();
  assertThrows(() =>
    schema.parse({ ...sidecar(), pending_model_turn_message_ids: ["model-1", "model-1"] })
  );
  assertEquals(
    schema.parse({ ...sidecar(), pending_model_turn_message_ids: ["model-1", "model-2"] })
      .pending_model_turn_message_ids,
    ["model-1", "model-2"],
  );
});

it("atomic checkpoint continuation excludes enumerable message metadata", () => {
  const value = sidecar();
  assertThrows(() =>
    getRecoveryCheckpointSidecarSchema().parse({
      ...value,
      snapshot: {
        ...value.snapshot,
        runtimeContinuation: {
          ...value.snapshot.runtimeContinuation,
          messages: [{ id: "user-1", role: "user", parts: [], metadata: { token: "synthetic" } }],
        },
      },
    })
  );
});
