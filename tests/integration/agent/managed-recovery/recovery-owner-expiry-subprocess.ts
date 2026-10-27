// Capture a controlled host clock before framework import, without adding a production clock seam.
let now = 1_800_000_000_000;
Date.now = () => now;
const encoder = new TextEncoder();
const encode = (value: unknown) => base64urlEncodeBytes(encoder.encode(JSON.stringify(value)));
const key = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
if (!("privateKey" in key)) throw new Error("Expected signing key pair");
const signingKey = key.privateKey;
const der = new Uint8Array(await crypto.subtle.exportKey("spki", key.publicKey));
const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${
  btoa(String.fromCodePoint(...der))
}\n-----END PUBLIC KEY-----`;
Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
await import("#veryfront/schemas/_test-setup.ts");
const { assertEquals, assertRejects } = await import("#veryfront/testing/assert.ts");
const { createCtx } = await import(
  "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts"
);
const { verifyControlPlaneRequest } = await import(
  "#veryfront/internal-agents/control-plane-auth.ts"
);
const { RecoverySessionOwner } = await import(
  "#veryfront/internal-agents/recovery-session-owner.ts"
);
const { base64urlEncodeBytes } = await import("#veryfront/utils/base64url.ts");

const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "expiry-proof",
  agentId: "proof-agent",
  threadId: "77777777-7777-4777-8777-777777777777",
  sourceHash: "a".repeat(64),
};
const generation = {
  workerId: "worker-original",
  dispatchNonce: "66666666-6666-4666-8666-666666666666",
  transportRecoveryAttempt: 0,
};
const receipt = {
  version: 1,
  identity: {
    projectId: identity.projectId,
    canonicalRunId: identity.canonicalRunId,
    publicRunId: identity.publicRunId,
    agentId: identity.agentId,
    threadId: identity.threadId,
  },
  generation,
  leaseRemainingMs: 10_000,
  acknowledgedEventId: 0,
  acknowledgedExternalSequence: 0,
};
async function signedClaims() {
  const issuedAt = Math.floor(now / 1000);
  const rawBody = JSON.stringify({
    managedRecoveryAdmission: {
      version: 1,
      identity,
      generation,
      acknowledgedExternalSequence: 0,
      leaseRemainingMs: 10_000,
      sourceBinding: {
        projectId: identity.projectId,
        environmentId: "33333333-3333-4333-8333-333333333333",
        releaseId: "44444444-4444-4444-8444-444444444444",
      },
      eventPersistence: "runtime-owned-v1" as const,
      expiresAt: issuedAt + 300,
    },
  });
  const path = `/api/control-plane/runs/${identity.publicRunId}/stream`;
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(rawBody));
  const header = encode({ alg: "EdDSA", typ: "JWT" });
  const payload = encode({
    iss: "veryfront-api",
    aud: "demo-project",
    sub: identity.publicRunId,
    surface: "studio",
    project_id: identity.projectId,
    request_hash: base64urlEncodeBytes(new Uint8Array(hash)),
    request_method: "POST",
    request_path: path,
    iat: issuedAt,
    exp: issuedAt + 300,
  });
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("Ed25519", signingKey, encoder.encode(input));
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = identity.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test${path}`, {
      method: "POST",
      headers: {
        "x-veryfront-control-plane-jws": `${input}.${
          base64urlEncodeBytes(new Uint8Array(signature))
        }`,
      },
    }),
    ctx,
    rawBody,
  );
}
const directory = await Deno.makeTempDir();
try {
  const claims = await signedClaims();
  let state: "valid" | "expired-credentials" | "superseded" = "valid";
  const owner = await RecoverySessionOwner.acquire({
    claims,
    directory: `${directory}/ongoing`,
    validateCurrentOwnership: async () => {
      // This boundary models the API adapter's rejection; API tests independently
      // establish actual paired-token expiry and transactional generation fencing.
      if (state === "expired-credentials") throw new Error("Paired credentials expired");
      return state === "superseded"
        ? {
          ...receipt,
          generation: { ...generation, dispatchNonce: "77777777-7777-4777-8777-777777777777" },
        }
        : receipt;
    },
    awaitRetiredPreviousOwner: async () => {
      throw new Error("No predecessor exists");
    },
  });
  now += 301_000;
  assertEquals((await owner.assertCurrentOwnership()).generation, generation);
  let initialValidations = 0;
  await assertRejects(() =>
    RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/expired-initial`,
      validateCurrentOwnership: async () => {
        initialValidations++;
        return receipt;
      },
      awaitRetiredPreviousOwner: async () => {},
    })
  );
  assertEquals(initialValidations, 0);
  state = "expired-credentials";
  await assertRejects(() => owner.assertCurrentOwnership());
  state = "superseded";
  await assertRejects(() => owner.assertCurrentOwnership());
  const freshClaims = await signedClaims();
  let acquisitionValidations = 0;
  await assertRejects(() =>
    RecoverySessionOwner.acquire({
      claims: freshClaims,
      directory: `${directory}/expired-return`,
      validateCurrentOwnership: async () => {
        if (++acquisitionValidations === 3) now += 301_000;
        return receipt;
      },
      awaitRetiredPreviousOwner: async () => {},
    })
  );
  assertEquals(acquisitionValidations, 3);
  console.log(
    JSON.stringify({
      afterDispatchExpiry: true,
      expiredInitial: true,
      expiredDuringAcquisition: true,
      expiredCredentials: true,
      supersededOwner: true,
    }),
  );
} finally {
  await Deno.remove(directory, { recursive: true });
}
