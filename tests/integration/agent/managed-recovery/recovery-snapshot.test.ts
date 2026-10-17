import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  parseRecoverySnapshot,
  validateRecoverySnapshotForRestore,
} from "#veryfront/internal-agents/recovery-snapshot.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";
import { readAttachedProviderMetadata } from "#veryfront/agent/runtime/provider-metadata.ts";

function fixture() {
  const identity = {
    projectId: "11111111-1111-4111-8111-111111111111",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    publicRunId: "snapshot-proof",
    sourceHash: "a".repeat(64),
  };
  const result = {
    type: "tool-result",
    toolCallId: "call-1",
    toolName: "ledger",
    result: { receiptId: "effect-1" },
  };
  return {
    version: 1,
    binding: {
      identity,
      generation: {
        workerId: "worker-a",
        dispatchNonce: "66666666-6666-4666-8666-666666666666",
        transportRecoveryAttempt: 0,
      },
      sourceBinding: {
        projectId: identity.projectId,
        environmentId: "33333333-3333-4333-8333-333333333333",
        releaseId: "44444444-4444-4444-8444-444444444444",
      },
    },
    acknowledgedEventId: 42,
    acknowledgedExternalSequence: 2,
    messages: [
      {
        id: "model-1",
        role: "assistant",
        parts: [{
          type: "tool-ledger",
          toolCallId: "call-1",
          toolName: "ledger",
          args: { value: "synthetic" },
        }],
      },
      { id: "result-1", role: "tool", parts: [result] },
    ],
    modelTurns: [{
      messageId: "model-1",
      acknowledgedExternalSequence: 1,
      providerReplayCheckpoint: {
        version: 1,
        messageId: "model-1",
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "tool_use", id: "call-1", name: "ledger", input: { value: "synthetic" } },
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      },
    }],
    toolExposureCheckpoint: { version: 2, loadedToolNames: ["ledger"] },
    toolBoundaries: [{
      kind: "acknowledged-receipt",
      modelMessageId: "model-1",
      toolName: "ledger",
      admissionReceipt: {
        occurrenceId: "55555555-5555-4555-8555-555555555555",
        admissionEventId: "admit-1",
        startEventId: "start-1",
        toolCallId: "call-1",
        publicToolCallId: "canonical-call-1",
        projectId: identity.projectId,
        runId: identity.canonicalRunId,
      },
      input: { value: "synthetic" },
      result,
      resultEventId: "result-event-1",
      acknowledgedExternalSequence: 2,
    }],
  };
}

it("actual provider and tool checkpoint schemas survive disk roundtrip and attach replay privately", async () => {
  const value = fixture();
  const parsed = parseRecoverySnapshot(value);
  const directory = await Deno.makeTempDir();
  try {
    const home = await DurableRunHome.open({ directory, identity: parsed.binding.identity });
    await home.append({ sequence: 1, value: parsed });
    const reopened = await DurableRunHome.open({ directory, identity: parsed.binding.identity });
    const restored = validateRecoverySnapshotForRestore(
      (await reopened.read())[0]?.value,
      parsed.binding,
    );
    assertEquals(JSON.stringify(restored), JSON.stringify(parsed));
    assertEquals(readAttachedProviderMetadata(restored.messages[0]!) !== undefined, true);
    assertEquals(restored.toolBoundaries[0]?.kind, "acknowledged-receipt");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("admission proof is distinct from an acknowledged effect and ambiguous intent cannot restore", () => {
  const value = fixture();
  const original = value.toolBoundaries[0]!;
  const pending = {
    ...value,
    messages: [value.messages[0]],
    toolBoundaries: [{
      kind: "admitted-intent",
      modelMessageId: original.modelMessageId,
      toolName: original.toolName,
      admissionReceipt: original.admissionReceipt,
      input: original.input,
    }],
  };
  const parsed = parseRecoverySnapshot(pending);
  assertEquals(parsed.toolBoundaries[0]?.kind, "admitted-intent");
  assertThrows(() => validateRecoverySnapshotForRestore(pending, parsed.binding));
});

it("source release and full generation must match the expected snapshot binding", () => {
  const value = fixture();
  const binding = parseRecoverySnapshot(value).binding;
  for (
    const expected of [
      { ...binding, identity: { ...binding.identity, sourceHash: "b".repeat(64) } },
      {
        ...binding,
        sourceBinding: {
          ...binding.sourceBinding,
          releaseId: "77777777-7777-4777-8777-777777777777",
        },
      },
      {
        ...binding,
        generation: {
          ...binding.generation,
          dispatchNonce: "77777777-7777-4777-8777-777777777777",
        },
      },
    ]
  ) assertThrows(() => validateRecoverySnapshotForRestore(value, expected));
});

it("real provider semantic validation and transcript reconstruction fail closed", () => {
  const mismatchedProvider = fixture();
  mismatchedProvider.modelTurns[0]!.providerReplayCheckpoint.providerBlocks[0]!.provider =
    "openai-responses";
  assertThrows(() => parseRecoverySnapshot(mismatchedProvider));
  const sparse = fixture();
  sparse.modelTurns[0]!.providerReplayCheckpoint.totalPartCount = 2;
  const sparseParsed = parseRecoverySnapshot(sparse);
  assertThrows(() => validateRecoverySnapshotForRestore(sparse, sparseParsed.binding));
  const alteredTranscript = fixture();
  alteredTranscript.modelTurns[0]!.providerReplayCheckpoint.providerBlocks[0]!.block.input.value =
    "different";
  const alteredParsed = parseRecoverySnapshot(alteredTranscript);
  assertThrows(() => validateRecoverySnapshotForRestore(alteredTranscript, alteredParsed.binding));
  const duplicateTools = fixture();
  duplicateTools.toolExposureCheckpoint.loadedToolNames.push("ledger");
  assertThrows(() => parseRecoverySnapshot(duplicateTools));
});

it("untracked calls, duplicate occurrences, mismatched receipts and unacknowledged sequence fail closed", () => {
  const missing = fixture();
  missing.toolBoundaries = [];
  assertThrows(() => parseRecoverySnapshot(missing));
  const duplicate = fixture();
  duplicate.toolBoundaries.push(duplicate.toolBoundaries[0]!);
  assertThrows(() => parseRecoverySnapshot(duplicate));
  const foreign = fixture();
  foreign.toolBoundaries[0]!.admissionReceipt.runId = "77777777-7777-4777-8777-777777777777";
  assertThrows(() => parseRecoverySnapshot(foreign));
  const future = fixture();
  future.toolBoundaries[0]!.acknowledgedExternalSequence = 3;
  assertThrows(() => parseRecoverySnapshot(future));
  const reusedAdmission = fixture();
  reusedAdmission.toolBoundaries[0]!.resultEventId =
    reusedAdmission.toolBoundaries[0]!.admissionReceipt.admissionEventId;
  assertThrows(() => parseRecoverySnapshot(reusedAdmission));
  const prematureResult = fixture();
  prematureResult.toolBoundaries[0]!.acknowledgedExternalSequence = 1;
  assertThrows(() => parseRecoverySnapshot(prematureResult));
  const wrongInput = fixture();
  wrongInput.toolBoundaries[0]!.input.value = "different";
  assertThrows(() => parseRecoverySnapshot(wrongInput));
  const wrongResult = fixture();
  wrongResult.toolBoundaries[0]!.result = {
    ...wrongResult.toolBoundaries[0]!.result,
    result: { receiptId: "different" },
  };
  assertThrows(() => parseRecoverySnapshot(wrongResult));
});

it("snapshots reject credential envelopes, executable values and oversized data", () => {
  assertThrows(() =>
    parseRecoverySnapshot({ ...fixture(), credentials: { authToken: "synthetic" } })
  );
  assertThrows(() => parseRecoverySnapshot({ ...fixture(), resume: () => {} }));
  const oversized = fixture();
  oversized.toolBoundaries[0]!.input.value = "x".repeat(1024 * 1024);
  assertThrows(() => parseRecoverySnapshot(oversized));
});

it("snapshots require an actual positive safe database acknowledgement independent of external sequence", () => {
  const value = fixture();
  assertEquals(parseRecoverySnapshot(value).acknowledgedEventId, 42);
  assertEquals(parseRecoverySnapshot(value).acknowledgedExternalSequence, 2);
  for (const acknowledgedEventId of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(() => parseRecoverySnapshot({ ...value, acknowledgedEventId }));
  }
  const { acknowledgedEventId: _omitted, ...missing } = value;
  assertThrows(() => parseRecoverySnapshot(missing));
});
