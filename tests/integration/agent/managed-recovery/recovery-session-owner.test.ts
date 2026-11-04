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

it("real signed admission cannot be copied into a forged recovery capability", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const value = admission();
    const claims = await signed(value);
    assertEquals(getVerifiedControlPlaneRecoveryAdmission(claims), value);
    assertEquals(getVerifiedControlPlaneRecoveryAdmission({ ...claims }), undefined);
    assertEquals(
      Object.isFrozen(getVerifiedControlPlaneRecoveryAdmission(claims)?.generation),
      true,
    );
    const directory = await makeTempDir();
    try {
      await assertRejects(() =>
        RecoverySessionOwner.acquire({
          claims: { ...claims },
          directory,
          validateCurrentOwnership: async () => receipt(value),
          awaitRetiredPreviousOwner: async () => {},
        })
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("disk ownership permits only a newer signed live generation and never persists credentials", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const first = admission();
    const claims = await signed(first);
    let validations = 0;
    await RecoverySessionOwner.acquire({
      claims,
      directory,
      validateCurrentOwnership: async () => {
        validations++;
        return receipt(first);
      },
      awaitRetiredPreviousOwner: async () => {
        assertEquals(validations, 2);
      },
    });
    assertEquals(validations, 3);
    let duplicateRetirements = 0;
    await assertRejects(() =>
      RecoverySessionOwner.acquire({
        claims,
        directory,
        validateCurrentOwnership: async () => receipt(first),
        awaitRetiredPreviousOwner: async () => {
          duplicateRetirements++;
        },
      })
    );
    assertEquals(duplicateRetirements, 0);
    const next = admission(1);
    const second = await RecoverySessionOwner.acquire({
      claims: await signed(next),
      directory,
      validateCurrentOwnership: async () => receipt(next),
      awaitRetiredPreviousOwner: async () => {},
    });
    assertEquals((await second.assertCurrentOwnership()).generation, next.generation);
    const home = await DurableRunHome.open({ directory, identity });
    assertEquals((await home.read()).length, 2);
    for await (const file of Deno.readDir(directory)) {
      if (file.isFile) {
        assertEquals(
          (await Deno.readTextFile(`${directory}/${file.name}`)).includes(
            "NEVER_PERSIST_TEST_CREDENTIAL",
          ),
          false,
        );
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("current ownership rejects mismatched generations, regressed cursors and elapsed lease budgets", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = { ...admission(), acknowledgedExternalSequence: 4 };
    const claims = await signed(value);
    let current = receipt(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory,
      validateCurrentOwnership: async () => current,
      awaitRetiredPreviousOwner: async () => {},
    });
    current = { ...receipt(value), generation: admission(1).generation };
    await assertRejects(() => owner.assertCurrentOwnership());
    current = { ...receipt(value), acknowledgedExternalSequence: 3 };
    await assertRejects(() => owner.assertCurrentOwnership());
    const replacementClaims = await signed(admission(2));
    await assertRejects(() =>
      RecoverySessionOwner.acquire({
        claims: replacementClaims,
        directory,
        validateCurrentOwnership: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ...receipt(admission(2)), leaseRemainingMs: 1 };
        },
        awaitRetiredPreviousOwner: async () => {},
      })
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("adapter signatures and out-of-scope or credential-bearing admissions cannot grant recovery", async () => {
  const previous = Deno.env.get(envKey);
  try {
    await signed();
    const body = JSON.stringify({ managedRecoveryAdmission: admission() });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      projectId: identity.projectId,
      requestId: identity.publicRunId,
    });
    const ctx = createCtx(publicKeyPem);
    ctx.projectId = identity.projectId;
    await assertRejects(() =>
      verifyControlPlaneRequest(
        new Request(
          `https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`,
          {
            method: "POST",
            headers: { "x-veryfront-control-plane-jws": jws },
          },
        ),
        ctx,
        body,
      )
    );
    await assertRejects(() =>
      signed({
        ...admission(),
        sourceBinding: {
          ...admission().sourceBinding,
          projectId: "55555555-5555-4555-8555-555555555555",
        },
      })
    );
    const credentialBearing = { ...admission(), authToken: "DO_NOT_ACCEPT" };
    await assertRejects(() => signed(credentialBearing));
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("older and concurrent duplicate admissions never retire the replacement owner", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const original = admission();
    const originalClaims = await signed(original);
    await RecoverySessionOwner.acquire({
      claims: originalClaims,
      directory,
      validateCurrentOwnership: async () => receipt(original),
      awaitRetiredPreviousOwner: async () => {
        throw new Error("No predecessor exists");
      },
    });
    const replacement = admission(1);
    const replacementClaims = await signed(replacement);
    let retirements = 0;
    const attempts = await Promise.allSettled([1, 2].map(() =>
      RecoverySessionOwner.acquire({
        claims: replacementClaims,
        directory,
        validateCurrentOwnership: async () => receipt(replacement),
        awaitRetiredPreviousOwner: async (target) => {
          retirements++;
          assertEquals(target, original.generation);
        },
      })
    ));
    assertEquals(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assertEquals(retirements, 1);
    await assertRejects(() =>
      RecoverySessionOwner.acquire({
        claims: originalClaims,
        directory,
        validateCurrentOwnership: async () => receipt(original),
        awaitRetiredPreviousOwner: async () => {
          retirements++;
        },
      })
    );
    assertEquals(retirements, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("failed acquisition can recover through a freshly issued nonce at the same transport attempt", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const original = admission();
    await RecoverySessionOwner.acquire({
      claims: await signed(original),
      directory,
      validateCurrentOwnership: async () => receipt(original),
      awaitRetiredPreviousOwner: async () => {
        throw new Error("No predecessor exists");
      },
    });
    const failed = {
      ...admission(),
      generation: { ...original.generation, dispatchNonce: "88888888-8888-4888-8888-888888888888" },
    };
    const claims = await signed(failed);
    await assertRejects(() =>
      RecoverySessionOwner.acquire({
        claims,
        directory,
        validateCurrentOwnership: async () => receipt(failed),
        awaitRetiredPreviousOwner: async () => {
          throw new Error("transient retirement failure");
        },
      })
    );
    let duplicateRetirements = 0;
    await assertRejects(() =>
      RecoverySessionOwner.acquire({
        claims,
        directory,
        validateCurrentOwnership: async () => receipt(failed),
        awaitRetiredPreviousOwner: async () => {
          duplicateRetirements++;
        },
      })
    );
    assertEquals(duplicateRetirements, 0);
    const fresh = {
      ...admission(),
      generation: { ...failed.generation, dispatchNonce: "77777777-7777-4777-8777-777777777777" },
    };
    const retiredTargets: typeof original.generation[] = [];
    const owner = await RecoverySessionOwner.acquire({
      claims: await signed(fresh),
      directory,
      validateCurrentOwnership: async () => receipt(fresh),
      awaitRetiredPreviousOwner: async (target) => {
        retiredTargets.push(target);
      },
    });
    assertEquals((await owner.assertCurrentOwnership()).generation, fresh.generation);
    assertEquals(retiredTargets, [original.generation, failed.generation]);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("dispatch expiry gates acquisition while continuing ownership requires fresh API validation", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-sys",
      "--deny-net",
      new URL("./recovery-owner-expiry-subprocess.ts", import.meta.url).pathname,
    ],
    env: { DENO_TESTING: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), {
    afterDispatchExpiry: true,
    expiredInitial: true,
    expiredDuringAcquisition: true,
    expiredCredentials: true,
    supersededOwner: true,
  });
});

it("poisoned some cannot grant a snapshot an unadmitted predecessor generation", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  const originalSome = Array.prototype.some;
  try {
    const first = admission();
    await RecoverySessionOwner.acquire({
      claims: await signed(first),
      directory,
      validateCurrentOwnership: async () => receipt(first),
      awaitRetiredPreviousOwner: async () => {},
    });
    const next = admission(1);
    const owner = await RecoverySessionOwner.acquire({
      claims: await signed(next),
      directory,
      validateCurrentOwnership: async () => ({ ...receipt(next), acknowledgedEventId: 10 }),
      awaitRetiredPreviousOwner: async () => {},
    });
    const snapshot = {
      version: 1,
      binding: { identity, sourceBinding: next.sourceBinding, generation: admission(9).generation },
      acknowledgedEventId: 1,
      acknowledgedExternalSequence: 0,
      messages: [],
      modelTurns: [],
      toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
      toolBoundaries: [],
    };
    Array.prototype.some = () => true;
    await assertRejects(
      () => owner.validatePredecessorSnapshot(snapshot),
      Error,
      "not from an admitted predecessor",
    );
  } finally {
    Array.prototype.some = originalSome;
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});
