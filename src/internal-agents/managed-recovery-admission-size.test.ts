import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertManagedRecoveryAdmissionSize } from "./managed-recovery-admission-size.ts";
import { normalizeAgUiRuntimeMessages } from "#veryfront/agent/ag-ui/runtime-support.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { recoveryHistoryMessageDigest } from "./recovery-history.ts";
import {
  getRecoveryCheckpointSidecarSchema,
  MAX_RECOVERY_CHECKPOINT_BYTES,
} from "./recovery-checkpoint-contract.ts";
import { toRuntimeRunAgentInput } from "./schema.ts";
import { getRecoveryAdmissionSchema } from "./recovery-admission-schema.ts";
import { getInternalAgentStreamRequestSchema } from "./schema.ts";

const uuid = "10000000-1000-4000-8000-100000000001";
const admission = getRecoveryAdmissionSchema().parse({
  version: 1,
  identity: {
    projectId: uuid,
    canonicalRunId: uuid,
    publicRunId: "run_1",
    agentId: "agent_1",
    threadId: uuid,
    sourceHash: "a".repeat(64),
  },
  generation: { workerId: "worker", dispatchNonce: uuid, transportRecoveryAttempt: 0 },
  eventPersistence: "runtime-owned-v1",
  acknowledgedExternalSequence: 0,
  leaseRemainingMs: 1000,
  sourceBinding: { projectId: uuid, environmentId: uuid, releaseId: uuid },
  expiresAt: 1000,
});
function request(content: string) {
  return getInternalAgentStreamRequestSchema().parse({
    agentId: "agent_1",
    threadId: uuid,
    runId: "run_1",
    runtimeTargetKind: "environment",
    runtimeTargetEnvironmentId: uuid,
    agentSource: { type: "release", releaseId: uuid },
    messages: [{ id: uuid, role: "user", content }],
  });
}

describe("managed recovery admission size", () => {
  it("admits bounded normalized history and rejects large history accepted by ordinary requests", () => {
    assertManagedRecoveryAdmissionSize(request("x".repeat(40 * 1024)), admission);
    const ordinary = request("x".repeat(240 * 1024));
    assertEquals(ordinary.messages.length, 1);
    assertThrows(
      () => assertManagedRecoveryAdmissionSize(ordinary, admission),
      Error,
      "Managed recovery history exceeds its checkpoint size limit",
    );
  });

  it("keeps admitted initial history inside the actual sidecar serializer bound", () => {
    const input = request("x".repeat(40 * 1024));
    assertManagedRecoveryAdmissionSize(input, admission);
    const messages = normalizeAgUiRuntimeMessages(toRuntimeRunAgentInput(input).messages);
    const checkpoint = getRecoveryCheckpointSidecarSchema().parse({
      snapshot_event_index: 0,
      pending_model_turn_message_ids: [],
      snapshot: {
        version: 1,
        binding: {
          identity: admission.identity,
          generation: admission.generation,
          sourceBinding: admission.sourceBinding,
        },
        messages,
        initialHistoryMessageIds: messages.map((message) => message.id),
        initialHistoryMessageDigests: messages.map(recoveryHistoryMessageDigest),
        initialHistoryProviderReplayCheckpoints: [],
        modelTurns: [],
        toolBoundaries: [],
        toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
        runtimeContinuation: {
          version: 1,
          nextStep: 0,
          messages,
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latestAssistantText: "",
          completed: false,
          recoveredEmptyResponse: false,
          startupSkillLoaded: true,
          recoveredInterruptedLocalToolBatch: false,
          hasSubmittedFormInput: false,
          resumeToolCallExecuted: false,
          agentWriteFinalResponseToolGuardEnabled: false,
          providerMetadata: [],
          runtimeGeneratedMessageIds: [],
        },
      },
    });
    assert(utf8ByteLength(privateJsonStringify(checkpoint)) <= MAX_RECOVERY_CHECKPOINT_BYTES);
  });

  it("counts JSON escaping and UTF-8 bytes rather than string length", () => {
    assertManagedRecoveryAdmissionSize(request("x".repeat(20 * 1024)), admission);
    for (const text of ["\u0000".repeat(20 * 1024), "😀".repeat(20 * 1024)]) {
      assertThrows(() => assertManagedRecoveryAdmissionSize(request(text), admission));
    }
  });

  it("counts original compatibility parts even when normalization discards them", () => {
    const input = request("small");
    const compatibility = getInternalAgentStreamRequestSchema().parse({
      ...input,
      messages: [{
        id: uuid,
        role: "user",
        parts: [{ type: "custom", data: "x".repeat(180 * 1024) }],
      }],
    });
    assertThrows(() => assertManagedRecoveryAdmissionSize(compatibility, admission));
  });

  it("counts replay input and many short message identities", () => {
    assertThrows(() =>
      assertManagedRecoveryAdmissionSize({
        ...request("small"),
        serverResolvedProviderReplayCheckpoints: [{ data: "x".repeat(100 * 1024) }],
      }, admission)
    );
    const input = request("small");
    assertThrows(() =>
      assertManagedRecoveryAdmissionSize({
        ...input,
        messages: Array.from({ length: 300 }, (_, index) => ({
          ...input.messages[0]!,
          id: `message-${index}`,
        })),
      }, admission)
    );
  });
});
