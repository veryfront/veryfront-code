import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "#veryfront/agent/service/auth.ts";
import { createAgUiResumeHandler } from "#veryfront/agent/ag-ui/run-control.ts";
import { RunResumeSessionManager } from "#veryfront/agent/runtime/resume-session.ts";
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

  // End to end through the resume handler with the run-scoped contract, the
  // shape an installed agent's run carries.
  const auth = createHostedServiceAuth({ getConfig });
  const runId = apiRunResumeContract.runScoped.payload.runId;
  const token = signContract(apiRunResumeContract.runScoped.payload);
  const manager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
  manager.startRun({ runId, threadId: "thread" });
  const settled = manager.waitForSignal(runId, "tool_1").catch(() => undefined);
  const handler = createAgUiResumeHandler({
    sessionManager: manager,
    authorizeRunControl: (control) =>
      auth.verifyRunResumeToken({ token, runId: control.runId }),
  });

  try {
    // The same bearer aimed at a run it does not name is refused, and the
    // targeted run keeps waiting.
    manager.startRun({ runId: "run_other", threadId: "other-thread" });
    assertEquals((await handler(resumeRequest("run_other", token))).status, 403);
    assertEquals(manager.getRunStatus("run_other"), "running");

    const accepted = await handler(resumeRequest(runId, token));
    assertEquals(accepted.status, 200);
    assertEquals(await accepted.json(), { accepted: true });
    await settled;
  } finally {
    manager.reset();
  }
});
