import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "#veryfront/agent/service/auth.ts";
import { createAgentServiceRuntime } from "#veryfront/agent/service/runtime.ts";
import apiRunResumeContract from "../../fixtures/contracts/api-run-resume-jwt-payload.json" with {
  type: "json",
};

function resumeRequest(runId: string, token: string): Request {
  return new Request(`https://runtime.example.test/api/runs/${runId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "tool_result", toolCallId: "tool_1", result: { ok: true } }),
  });
}

it("accepts both API-minted resume contracts under real RS256 verification", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const signContract = (payload: Record<string, unknown>) => {
    const body = `${header}.${encode({ ...payload, exp: Math.floor(Date.now() / 1000) + 900 })}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  };
  const getConfig = () => ({
    VERYFRONT_API_URL: "https://api.example.test",
    OAUTH_PUBLIC_KEY: publicKeyPem,
    SERVICE_ACCOUNT_VERYFRONT_SERVER_ID:
      apiRunResumeContract.projectScoped.payload.serviceAccountId,
    NODE_ENV: "production",
  });

  for (const shape of ["projectScoped", "runScoped"] as const) {
    const { payload } = apiRunResumeContract[shape];
    const auth = createHostedServiceAuth({ getConfig });
    const token = signContract(payload);
    assertEquals(
      await auth.verifyRunResumeToken({ token, runId: payload.runId }),
      true,
      `${shape} resume contract must be accepted`,
    );
    assertEquals(
      await auth.verifyRunResumeToken({ token, runId: "run_other" }),
      false,
      `${shape} resume contract must stay bound to its own run`,
    );
    // A forged run id over the original signature must not verify either.
    const [signedHeader, _payload, signature] = token.split(".");
    const forged = `${signedHeader}.${encode({ ...payload, runId: "run_other" })}.${signature}`;
    assertEquals(
      await auth.verifyRunResumeToken({ token: forged, runId: "run_other" }),
      false,
      `${shape} resume contract must not survive claim tampering`,
    );
  }

  for (const shape of ["projectScoped", "runScoped"] as const) {
    for (const prefix of ["/api/runs/", "/api/control-plane/runs/"]) {
      const payload = apiRunResumeContract[shape].payload;
      const runId = payload.runId;
      const token = signContract(payload);
      const bundle = createAgentServiceRuntime({
        serviceName: "resume-contract-fixture",
        getConfig: () => ({ ...getConfig(), PORT: 0, ALLOWED_ORIGINS: [] }),
        getAgentConfig: () => ({
          id: "fixture",
          name: "Fixture",
          description: "",
          instructions: "Test fixture",
        }),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        prepareExecution: async () => ({}),
        streamExecutionToAgUiResponse: () => new Response("unused"),
        startDetachedExecution: async () => {},
      });
      const manager = bundle.tracker.sessionManager;
      const request = (target: string, credential: string) => {
        const original = resumeRequest(target, credential);
        return new Request(`https://runtime.example.test${prefix}${target}/resume`, original);
      };
      try {
        const beforeStart = await bundle.runtime.request(request(runId, token));
        assertEquals(
          beforeStart.status,
          410,
          `${shape} ${prefix} valid authority reaches mounted handler`,
        );
        manager.startRun({ runId, threadId: "thread" });
        const settled = manager.waitForSignal(runId, "tool_1").catch(() => undefined);
        manager.startRun({ runId: "run_other", threadId: "other-thread" });
        assertEquals((await bundle.runtime.request(request("run_other", token))).status, 403);
        assertEquals((await bundle.runtime.request(request(runId, "invalid"))).status, 401);
        assertEquals(manager.getRunStatus(runId), "waiting");
        const accepted = await bundle.runtime.request(request(runId, token));
        assertEquals(accepted.status, 200, `${shape} ${prefix} accepts producer bearer`);
        assertEquals(await accepted.json(), { accepted: true });
        assertEquals(await settled, { result: { ok: true }, isError: false });
      } finally {
        manager.reset();
      }
    }
  }
});

it("does not expose credentialed resume requests to a replaced clone method", async () => {
  const { createAgUiResumeHandler } = await import("#veryfront/agent/ag-ui/run-control.ts");
  const { RunResumeSessionManager } = await import("#veryfront/agent/runtime/resume-session.ts");
  const manager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
  const handler = createAgUiResumeHandler({
    sessionManager: manager,
    authorizeRunControl: () => false,
  });
  const nativeClone = Request.prototype.clone;
  const nativeBody = Object.getOwnPropertyDescriptor(Request.prototype, "body")!;
  const apply = Reflect.apply;
  let observed = false;
  const request = resumeRequest("run-private", "synthetic-resume-credential");
  let status: number | undefined;
  try {
    Request.prototype.clone = function () {
      observed ||= this.headers.get("authorization") === "Bearer synthetic-resume-credential";
      return apply(nativeClone, this, []);
    };
    Object.defineProperty(Request.prototype, "body", {
      ...nativeBody,
      get() {
        observed ||= this.headers.get("authorization") === "Bearer synthetic-resume-credential";
        return apply(nativeBody.get!, this, []);
      },
    });
    status = (await handler(request)).status;
  } finally {
    Request.prototype.clone = nativeClone;
    Object.defineProperty(Request.prototype, "body", nativeBody);
    manager.reset();
  }
  assertEquals(status, 403);
  assertEquals(observed, false);
});
