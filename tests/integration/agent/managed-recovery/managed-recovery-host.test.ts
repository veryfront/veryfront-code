import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";

const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
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

import { createManagedRecoveryHostFactory } from "#veryfront/internal-agents/managed-recovery-host.ts";
import { createRecoverySourceManifest } from "#veryfront/internal-agents/recovery-source-manifest.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";

it("trusted immutable host admits a distinct execution project using its exact live receipt", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  const files = [{ path: "agents/proof.ts", entityType: "function", content: "synthetic" }];
  const value = admission();
  value.identity = {
    ...identity,
    projectId: "77777777-7777-4777-8777-777777777777",
    sourceHash: createRecoverySourceManifest(files).hash,
  };
  let ownership = receipt(value);
  let listedBinding = value.sourceBinding;
  let listedFiles: unknown = files;
  const factory = createManagedRecoveryHostFactory({
    sourceBinding: value.sourceBinding,
    durableDirectory: directory,
    listImmutableReleaseFiles: async () => ({ sourceBinding: listedBinding, files: listedFiles }),
    validateCurrentOwnership: async () => ownership,
    loadAcknowledgedSnapshot: async () => undefined,
  });
  const manager = new AgentRunSessionManager({ recoveryOwnerFactory: factory });
  try {
    const claims = await signed(value);
    assertEquals(
      getVerifiedControlPlaneRecoveryAdmission(claims)?.identity.projectId,
      value.identity.projectId,
    );
    // A source-project credential cannot satisfy execution-project ownership.
    ownership = receipt({ ...value, identity });
    await assertRejects(() =>
      manager.startManagedRecoveryRun({ runId: identity.publicRunId, threadId: "thread", claims })
    );
    ownership = receipt(value);
    listedBinding = { ...value.sourceBinding, releaseId: "88888888-8888-4888-8888-888888888888" };
    await assertRejects(() =>
      manager.startManagedRecoveryRun({ runId: identity.publicRunId, threadId: "thread", claims })
    );
    listedBinding = value.sourceBinding;
    listedFiles = [{ ...files[0], content: "tampered" }];
    await assertRejects(() =>
      manager.startManagedRecoveryRun({ runId: identity.publicRunId, threadId: "thread", claims })
    );
    listedFiles = files;
    const started = await manager.startManagedRecoveryRun({
      runId: identity.publicRunId,
      threadId: "thread",
      claims,
    });
    assertEquals(started.signal.aborted, false);
    manager.completeRun(identity.publicRunId, started.signal);
    started.settle();
  } finally {
    manager.reset();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("foreign source host and wrong served release are rejected before any ownership I/O", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    const claims = await signed(value);
    for (
      const sourceBinding of [
        { ...value.sourceBinding, projectId: "99999999-9999-4999-8999-999999999999" },
        { ...value.sourceBinding, releaseId: "88888888-8888-4888-8888-888888888888" },
      ]
    ) {
      let calls = 0;
      const manager = new AgentRunSessionManager({
        recoveryOwnerFactory: createManagedRecoveryHostFactory({
          sourceBinding,
          durableDirectory: directory,
          listImmutableReleaseFiles: async () => {
            calls++;
            return { sourceBinding, files: [] };
          },
          validateCurrentOwnership: async () => {
            calls++;
            return receipt(value);
          },
          loadAcknowledgedSnapshot: async () => undefined,
        }),
      });
      await assertRejects(() =>
        manager.startManagedRecoveryRun({ runId: identity.publicRunId, threadId: "thread", claims })
      );
      assertEquals(calls, 0);
      manager.reset();
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});
