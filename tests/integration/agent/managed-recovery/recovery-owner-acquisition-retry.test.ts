import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";

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
    agentId: value.identity.agentId,
    threadId: value.identity.threadId,
    credentials: { authToken: "NEVER_PERSIST_TEST_CREDENTIAL" },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    projectId: identity.projectId,
    requestId: identity.publicRunId,
  });
  Deno.env.set(envKey, publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = identity.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`, {
      method: "POST",
      headers: { "x-veryfront-control-plane-jws": jws },
    }),
    ctx,
    body,
  );
}

it("failed pre-execution acquisition does not require a nonexistent snapshot on fresh dispatch", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const original = admission();
    await RecoverySessionOwner.acquire({
      claims: await signed(original),
      directory,
      validateCurrentOwnership: async () => receipt(original),
      awaitRetiredPreviousOwner: async () => {},
    });
    const failed = admission(1);
    await assertRejects(async () =>
      RecoverySessionOwner.acquire({
        claims: await signed(failed),
        directory,
        validateCurrentOwnership: async () => receipt(failed),
        awaitRetiredPreviousOwner: async () => {
          throw new Error("retirement interrupted");
        },
      })
    );
    const fresh = admission(2);
    const owner = await RecoverySessionOwner.acquire({
      claims: await signed(fresh),
      directory,
      validateCurrentOwnership: async () => receipt(fresh),
      awaitRetiredPreviousOwner: async () => {},
    });
    assertEquals(owner.requiresRestoredSnapshot, false);
    const redispatched = {
      ...fresh,
      generation: { ...fresh.generation, dispatchNonce: "88888888-8888-4888-8888-888888888888" },
    };
    const sameAttempt = await RecoverySessionOwner.acquire({
      claims: await signed(redispatched),
      directory,
      validateCurrentOwnership: async () => receipt(redispatched),
      awaitRetiredPreviousOwner: async () => {},
    });
    assertEquals(sameAttempt.requiresRestoredSnapshot, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("acknowledged execution requires restore even when local acquisition has no predecessor", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const original = { ...admission(1), acknowledgedExternalSequence: 1 };
    const owner = await RecoverySessionOwner.acquire({
      claims: await signed(original),
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(original),
      awaitRetiredPreviousOwner: async () => {},
    });
    assertEquals(owner.requiresRestoredSnapshot, true);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("live ownership cannot switch the admitted agent or thread", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const original = admission();
    const claims = await signed(original);
    for (
      const identityPatch of [
        { agentId: "other-agent" },
        { threadId: "99999999-9999-4999-8999-999999999999" },
      ]
    ) {
      await assertRejects(
        () =>
          RecoverySessionOwner.acquire({
            claims,
            directory,
            validateCurrentOwnership: async () => ({
              ...receipt(original),
              identity: { ...receipt(original).identity, ...identityPatch },
            }),
            awaitRetiredPreviousOwner: async () => {},
          }),
        Error,
        "Managed recovery ownership is no longer current",
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("retirement completes before the authoritative restore cursor is observed", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const original = admission();
    await RecoverySessionOwner.acquire({
      claims: await signed(original),
      directory,
      validateCurrentOwnership: async () => receipt(original),
      awaitRetiredPreviousOwner: async () => {},
    });
    const replacement = admission(1);
    let acknowledged = 0;
    const owner = await RecoverySessionOwner.acquire({
      claims: await signed(replacement),
      directory,
      validateCurrentOwnership: async () => ({
        ...receipt(replacement),
        acknowledgedExternalSequence: acknowledged,
      }),
      awaitRetiredPreviousOwner: async () => {
        acknowledged = 1;
      },
    });
    assertEquals(owner.requiresRestoredSnapshot, true);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});
