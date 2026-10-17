import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";

const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  agentId: "proof-agent",
  threadId: "77777777-7777-4777-8777-777777777777",
  sourceHash: "a".repeat(64),
};
function admission(attempt = 0) {
  return {
    version: 1,
    identity,
    generation: {
      workerId: `worker-${attempt}`,
      dispatchNonce: `66666666-6666-4666-8666-${String(attempt).padStart(12, "0")}`,
      transportRecoveryAttempt: attempt,
    },
    acknowledgedExternalSequence: 0,
    leaseRemainingMs: 10_000,
    sourceBinding: {
      projectId: identity.projectId,
      environmentId: "33333333-3333-4333-8333-333333333333",
      releaseId: "44444444-4444-4444-8444-444444444444",
    },
    eventPersistence: "runtime-owned-v1" as const,
    expiresAt: Math.floor(Date.now() / 1000) + 30,
  };
}
function receipt(value = admission()) {
  return {
    version: 1,
    identity: {
      projectId: value.identity.projectId,
      canonicalRunId: value.identity.canonicalRunId,
      publicRunId: value.identity.publicRunId,
      agentId: value.identity.agentId,
      threadId: value.identity.threadId,
    },
    generation: value.generation,
    acknowledgedEventId: 0,
    acknowledgedExternalSequence: value.acknowledgedExternalSequence,
    leaseRemainingMs: value.leaseRemainingMs,
  };
}
async function signed(value = admission()) {
  const body = JSON.stringify({
    managedRecoveryAdmission: value,
    credentials: { authToken: "NEVER_PERSIST_TEST_CREDENTIAL" },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    projectId: value.sourceBinding.projectId,
    requestId: identity.publicRunId,
  });
  Deno.env.set(envKey, publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = value.sourceBinding.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`, {
      method: "POST",
      headers: { "x-veryfront-control-plane-jws": jws },
    }),
    ctx,
    body,
  );
}

import { createManagedRecoveryWriter } from "#veryfront/internal-agents/managed-recovery-writer.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";

import { AgentRuntime, type RuntimeToolFilterConfig } from "#veryfront/agent/runtime/index.ts";
import { parseRecoverySnapshot } from "#veryfront/internal-agents/recovery-snapshot.ts";

it("preserves historical Anthropic replay separately from current managed model turns", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let sequence = 0;
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async (_event, _occurrence, checkpoint) => {
        sequence++;
        return {
          eventId: sequence + 100,
          externalSequence: sequence,
          toolAdmissions: [],
          ...(checkpoint
            ? {
              recoveryCheckpoint: {
                snapshot_event_id: sequence + 100,
                snapshot_external_sequence: sequence,
                checkpoint_event_id: sequence + 10000,
              },
            }
            : {}),
        };
      },
    });
    writer.bindSignal(new AbortController().signal);
    const config: RuntimeToolFilterConfig = {
      model: "veryfront-cloud/anthropic/synthetic",
      system: "Synthetic",
      maxSteps: 1,
      __vfProviderReplayCheckpoints: [{
        version: 1,
        messageId: "prior-assistant",
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "text", text: "Prior answer" },
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      }],
    };
    const model = scriptedModel([{ text: "New answer" }], {
      only: "stream",
      provider: "anthropic",
    });
    const runtime = new AgentRuntime("proof-agent", config, {
      resolveModelRuntime: () => model,
      persistRecoveryBoundary: writer.persistBoundary,
    });
    const result = await runtime.stream([{
      id: "prior-user",
      role: "user",
      parts: [{ type: "text", text: "Prior question" }],
    }, {
      id: "prior-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "Prior answer" }],
    }, { id: "new-user", role: "user", parts: [{ type: "text", text: "New question" }] }]);
    await new Response(result).text();
    assertEquals(model.calls.length, 1);
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    const records = await home.read();
    const snapshot = parseRecoverySnapshot(records.at(-1)?.value);
    assertEquals(snapshot.modelTurns.some((turn) => turn.messageId === "prior-assistant"), false);
    assertEquals(
      snapshot.runtimeContinuation?.providerMetadata?.some((entry) =>
        entry.messageId === "prior-assistant"
      ),
      true,
    );
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
    await Deno.remove(directory, { recursive: true });
  }
});
