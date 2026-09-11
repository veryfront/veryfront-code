// CI-only security probe. Do not execute native/prototype tampering locally.
import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "#veryfront/agent/service/auth.ts";
import type { HostedServiceJwtVerifier } from "#veryfront/agent/service/auth.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";

it("rejects a real ordinary JWT when the shared prototype supplies a victim run ID", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const runId = "synthetic-victim-run";
  const ordinaryClaims = {
    userId: "synthetic-user",
    scope: ["read", "write", "delete"],
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const tokenFor = (claims: object) => {
    const body = `${header}.${encode(claims)}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  };
  const ordinary = { token: tokenFor(ordinaryClaims), runId };
  const authorized = { token: tokenFor({ ...ordinaryClaims, runId }), runId };
  const auth = createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
      NODE_ENV: "production",
    }),
  });
  assertEquals(await auth.verifyRunCancellationToken(ordinary), false);
  assertEquals(await auth.verifyRunCancellationToken(authorized), true);

  const defineProperty = Object.defineProperty;
  const deleteProperty = Reflect.deleteProperty;
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "runId");
  let control: unknown;
  let denied: boolean | undefined;
  let allowed: boolean | undefined;
  try {
    defineProperty(Object.prototype, "runId", { value: runId, configurable: true, writable: true });
    // Demonstrate that ordinary property lookup sees the active inherited value.
    control = Reflect.get(ordinaryClaims, "runId");
    denied = await auth.verifyRunCancellationToken(ordinary);
    allowed = await auth.verifyRunCancellationToken(authorized);
  } finally {
    if (original) defineProperty(Object.prototype, "runId", original);
    else deleteProperty(Object.prototype, "runId");
  }
  assertEquals(control, runId);
  assertEquals(denied, false);
  assertEquals(allowed, true);
});

it("rejects inherited thenables before JWT verification or cancellation authentication", async () => {
  const { createAuthProvider } = await importFirstPartyExtensionModule<{
    createAuthProvider(config: Record<string, never>): HostedServiceJwtVerifier;
  }>("ext-auth-jwt", "@veryfront/ext-auth-jwt");
  const provider = createAuthProvider({});
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey.export({ type: "spki", format: "pem" }).toString();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const runId = "synthetic-thenable-victim";
  const claims = {
    sub: "synthetic-user",
    userId: "synthetic-user",
    scope: ["read", "write", "delete"],
    exp: Math.floor(Date.now() / 1000) + 120,
  };
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`;
  const token = `${body}.${
    sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")
  }`;
  // Warm key import and prove that the signed token contains no run authority.
  assertEquals(
    (await provider.verifyWithPublicKey(token, key, { algorithms: ["RS256"] })).runId,
    undefined,
  );
  let guardedVerifications = 0;
  let authentications = 0;
  const auth = createHostedServiceAuth({
    getConfig: () => ({ VERYFRONT_API_URL: "https://api.example.test", OAUTH_PUBLIC_KEY: key }),
    authProvider: {
      verifyWithPublicKey(...args) {
        guardedVerifications++;
        return provider.verifyWithPublicKey(...args);
      },
    },
  });
  const tracker = createDetachedRunTracker<AgUiResumeValue>();
  const routes = createHostedAgentServiceRouteSet({
    tracker,
    authenticateRequest(request) {
      authentications++;
      return auth.authenticateRequest(request);
    },
    verifyRunCancellationToken: auth.verifyRunCancellationToken,
    verifyProjectAccess: () => Promise.resolve({ success: true }),
    prepareExecution: () => Promise.reject(new Error("Unexpected preparation")),
    streamExecutionToAgUiResponse: () => new Response(),
    startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
  });
  const request = new Request(`https://agent.example.test/api/runs/${runId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  const descriptor = Object.getOwnPropertyDescriptor;
  const defineProperty = Object.defineProperty;
  const deleteProperty = Reflect.deleteProperty;
  const original = descriptor(Object.prototype, "then");
  const forged = Object.assign(Object.create(null), { ...claims, runId });
  let substitutions = 0;
  let legacyRunId: unknown;
  let permitted: boolean | undefined;
  let status: number | undefined;
  try {
    defineProperty(Object.prototype, "then", {
      configurable: true,
      get(this: object) {
        const payload: unknown = descriptor(this, "payload")?.value;
        const protectedHeader: unknown = descriptor(this, "protectedHeader")?.value;
        if (
          !payload || typeof payload !== "object" || !descriptor(payload, "userId") ||
          !protectedHeader
        ) {
          return undefined;
        }
        return (resolve: (value: unknown) => void) => {
          substitutions++;
          resolve(Object.assign(Object.create(null), { payload: forged, protectedHeader }));
        };
      },
    });
    // Positive control: jose's asynchronous plain-object result is replaceable.
    legacyRunId = (await provider.verifyWithPublicKey(token, key, { algorithms: ["RS256"] })).runId;
    permitted = await auth.verifyRunCancellationToken({ token, runId });
    status = (await routes.handleDurableChatRunCancelRequest({ request, runId })).status;
  } finally {
    if (original) defineProperty(Object.prototype, "then", original);
    else deleteProperty(Object.prototype, "then");
  }
  try {
    assertEquals(substitutions > 0, true);
    assertEquals(legacyRunId, runId);
    assertEquals(permitted, false);
    assertEquals(status, 403);
    assertEquals(guardedVerifications, 0);
    assertEquals(authentications, 0);
    // No delayed-start tombstone was created by the denied request.
    assertEquals(tracker.sessionManager.startRun({ runId, threadId: "thread" }).aborted, false);
  } finally {
    tracker.reset();
  }
});
