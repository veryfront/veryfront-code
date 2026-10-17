import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { parseManagedRecoverySnapshotV1 } from "#veryfront/runtime/managed-recovery-snapshot.ts";

const vector = {
  version: 1,
  binding: {
    identity: {
      projectId: "11111111-1111-4111-8111-111111111111",
      canonicalRunId: "22222222-2222-4222-8222-222222222222",
      publicRunId: "run-abi-proof",
      agentId: "proof-agent",
      threadId: "77777777-7777-4777-8777-777777777777",
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

it("native recovery ABI validates assembled actual server cursors without granting authority", () => {
  const { acknowledgedEventId: _database, acknowledgedExternalSequence: _external, ...sidecar } =
    vector;
  assertThrows(() => parseManagedRecoverySnapshotV1(sidecar));
  const assembled = parseManagedRecoverySnapshotV1({
    ...sidecar,
    acknowledgedEventId: 91,
    acknowledgedExternalSequence: 17,
  });
  assertEquals<unknown>(assembled, vector);
  assertThrows(() =>
    parseManagedRecoverySnapshotV1({ ...vector, credentials: { token: "synthetic" } })
  );
  assertThrows(() => parseManagedRecoverySnapshotV1({ ...vector, version: 2 }));
  assertThrows(() =>
    parseManagedRecoverySnapshotV1({
      ...vector,
      runtimeContinuation: {
        ...vector.runtimeContinuation,
        messages: [{ id: "foreign", role: "user", parts: [] }],
      },
    })
  );
});
