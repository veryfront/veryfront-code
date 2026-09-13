import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "#veryfront/agent/service/auth.ts";
import { createAgentServiceRuntime } from "#veryfront/agent/service/runtime.ts";
import apiRunCancellationContract from "../../fixtures/contracts/api-run-cancellation-jwt-payload.json" with {
  type: "json",
};

it("accepts both API-minted cancellation contracts under real RS256 verification", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const signContract = (payload: Record<string, unknown>) => {
    const body = `${header}.${encode({ ...payload, exp: Math.floor(Date.now() / 1000) + 900 })}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  };

  for (const shape of ["projectScoped", "projectless"] as const) {
    const { payload } = apiRunCancellationContract[shape];
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.example.test",
        OAUTH_PUBLIC_KEY: publicKeyPem,
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID:
          apiRunCancellationContract.projectScoped.payload.serviceAccountId,
        NODE_ENV: "production",
      }),
    });
    const token = signContract(payload);
    assertEquals(
      await auth.verifyRunCancellationToken({ token, runId: payload.runId }),
      true,
      `${shape} cancellation contract must be accepted`,
    );
    assertEquals(
      await auth.verifyRunCancellationToken({ token, runId: "run_other" }),
      false,
      `${shape} cancellation contract must stay bound to its own run`,
    );
  }

  // End to end through the hosted route with the project contract, the shape
  // the API mints for every run that has a projectId.
  const bundle = createAgentServiceRuntime({
    serviceName: "test-service",
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: publicKeyPem,
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID:
        apiRunCancellationContract.projectScoped.payload.serviceAccountId,
      NODE_ENV: "production",
      PORT: 3000,
      ALLOWED_ORIGINS: [],
    }),
    getAgentConfig: () => ({ id: "test", name: "Test", instructions: "Test", description: "Test" }),
    logger: { info() {}, error() {} },
    prepareExecution: () => Promise.reject(new Error("Unexpected preparation")),
    streamExecutionToAgUiResponse: () => new Response(),
    startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
  });
  const projectRunId = apiRunCancellationContract.projectScoped.payload.runId;
  const running = bundle.tracker.sessionManager.startRun({
    runId: projectRunId,
    threadId: "thread",
  });
  try {
    const response = await bundle.runtime.request(`/api/runs/${projectRunId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${signContract(apiRunCancellationContract.projectScoped.payload)}`,
      },
    });
    assertEquals(response.status, 202);
    assertEquals(running.aborted, true);
  } finally {
    bundle.tracker.reset();
  }
});

it("verifies cancellation signatures and exact run binding with the real JWT provider", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claims = {
    userId: "synthetic-user",
    runId: "run-owned",
    scope: ["read", "write", "delete"],
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const body = `${header}.${encode(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url");
  const token = `${body}.${signature}`;
  const auth = createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
      NODE_ENV: "production",
    }),
  });
  assertEquals(await auth.verifyRunCancellationToken({ token, runId: "run-owned" }), true);
  assertEquals(await auth.verifyRunCancellationToken({ token, runId: "run-other" }), false);
  const forged = `${header}.${encode({ ...claims, runId: "run-other" })}.${signature}`;
  assertEquals(await auth.verifyRunCancellationToken({ token: forged, runId: "run-other" }), false);

  const bundle = createAgentServiceRuntime({
    serviceName: "test-service",
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
      NODE_ENV: "production",
      PORT: 3000,
      ALLOWED_ORIGINS: [],
    }),
    getAgentConfig: () => ({ id: "test", name: "Test", instructions: "Test", description: "Test" }),
    logger: { info() {}, error() {} },
    prepareExecution: () => Promise.reject(new Error("Unexpected preparation")),
    streamExecutionToAgUiResponse: () => new Response(),
    startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
  });
  const owned = bundle.tracker.sessionManager.startRun({ runId: "run-owned", threadId: "thread" });
  const other = bundle.tracker.sessionManager.startRun({
    runId: "run-other",
    threadId: "other-thread",
  });
  try {
    const denied = await bundle.runtime.request("/api/runs/run-other", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assertEquals(denied.status, 403);
    assertEquals(other.aborted, false);
    const accepted = await bundle.runtime.request("/api/runs/run-owned", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assertEquals(accepted.status, 202);
    assertEquals(owned.aborted, true);
    assertEquals(other.aborted, false);
  } finally {
    bundle.tracker.reset();
  }
});
