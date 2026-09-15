import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "./auth.ts";
import { createAgUiResumeHandler } from "../ag-ui/run-control.ts";
import { RunResumeSessionManager } from "../runtime/resume-session.ts";
import type { TokenPayload } from "#veryfront/extensions/auth/index.ts";
import apiRunResumeContract from "../../../tests/fixtures/contracts/api-run-resume-jwt-payload.json" with {
  type: "json",
};

// Both accepted shapes come from the producer contract fixture, captured by
// running `resumeRuntimeAgentRun` against the real signer and decoding the
// bearer it sent. A hand-written positive fixture is how the cancellation
// verifier came to reject the `tokenUse` the API stamps on every project-bound
// bearer: the test agreed with the bug and CI stayed green.
const CONTRACT_EXPIRY_SECONDS = 4_000_000_000;
const runId = apiRunResumeContract.projectScoped.payload.runId;
const serverId = apiRunResumeContract.projectScoped.payload.serviceAccountId;
const projectClaims = {
  ...apiRunResumeContract.projectScoped.payload,
  exp: CONTRACT_EXPIRY_SECONDS,
};
// The run-scoped shape is the actor's own credential, minted only against a
// live agent access grant. It is what an authorized collaborator's run carries.
const collaboratorClaims = {
  ...apiRunResumeContract.runScoped.payload,
  exp: CONTRACT_EXPIRY_SECONDS,
};

// The v1 digests, pinned independently of the fixture and identical to the
// producer pins in veryfront-api. Comparing a payload only with its adjacent,
// equally editable hash lets a producer change be absorbed by regenerating both
// in one repo while the other keeps the old payload under the same contract id.
const EXPECTED_PAYLOAD_DIGESTS = {
  projectScoped: "8141244b70fe35ac57d038b6a8cf438680fb5d3f281bf8f802677f42e8c6ecd5",
  runScoped: "42c52da39f013575a7e8f58992fc58c55147f4a7fee96c5bc83e64d31ba5e0b3",
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// The contract payloads are the API's real claim sets, which carry no `sub`,
// so they are typed as plain records and cast at the AuthProvider boundary. The
// verifier reads own data properties rather than trusting the declared type.
type ResumeClaims = Record<string, unknown>;

function asClaims(claims: ResumeClaims): TokenPayload {
  return claims as TokenPayload;
}

function authForClaims(claims: ResumeClaims) {
  return createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: "test-public-key",
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
    }),
    authProvider: { verifyWithPublicKey: () => Promise.resolve(asClaims(claims)) },
  });
}

function verify(claims: ResumeClaims, targetRunId = runId): Promise<boolean> {
  return authForClaims(claims).verifyRunResumeToken({
    token: "signed-resume-token",
    runId: targetRunId,
  });
}

function resumeRequest(targetRunId: string): Request {
  return new Request(`https://runtime.example.test/api/runs/${targetRunId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "tool_result", toolCallId: "tool_1", result: { ok: true } }),
  });
}

function resumeHandler(
  manager: RunResumeSessionManager<{ result: unknown; isError: boolean }>,
  claims: ResumeClaims,
) {
  return createAgUiResumeHandler({
    sessionManager: manager,
    authorizeRunControl: (control) =>
      authForClaims(claims).verifyRunResumeToken({
        token: "signed-resume-token",
        runId: control.runId,
      }),
  });
}

function waitingManager(activeRunId: string) {
  const manager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
  manager.startRun({ runId: activeRunId, threadId: crypto.randomUUID() });
  const settled = manager.waitForSignal(activeRunId, "tool_1").catch(() => undefined);
  return { manager, settled };
}

describe("hosted resume token authorization", () => {
  it("pins the cross-repo resume claim contract", async () => {
    assertEquals(apiRunResumeContract.contractId, "veryfront.run-resume.jwt-payload.v1");
    assertEquals(
      apiRunResumeContract.producer,
      "veryfront-api/src/usecases/agents/runtime-agent-run-client.ts",
    );
    assertEquals(apiRunResumeContract.serviceIdentity, "veryfront-server");
    for (const shape of ["projectScoped", "runScoped"] as const) {
      assertEquals(
        apiRunResumeContract[shape].payloadSha256,
        EXPECTED_PAYLOAD_DIGESTS[shape],
        `${shape} contract digest was redefined under an unchanged contract id`,
      );
      assertEquals(
        await sha256Hex(JSON.stringify(apiRunResumeContract[shape].payload)),
        apiRunResumeContract[shape].payloadSha256,
        `${shape} contract payload changed without its recorded digest`,
      );
    }
  });

  it("accepts both shapes the API actually signs for resume", async () => {
    assertEquals(
      apiRunResumeContract.projectScoped.payload.tokenUse,
      "project_scoped_service_account",
    );
    assertEquals(apiRunResumeContract.runScoped.payload.tokenUse, "run_scoped_service_account");
    assertEquals(await verify(projectClaims), true);
    assertEquals(await verify(collaboratorClaims), true);
  });

  it("accepts the same scope set in either order the two mints emit", async () => {
    // The project-scoped mint sorts the requested scopes and the run-scoped mint
    // passes them through unchanged, so an order-sensitive comparison would
    // accept one production shape and 403 the other.
    assertEquals(
      [...apiRunResumeContract.projectScoped.payload.scope].sort(),
      [...apiRunResumeContract.runScoped.payload.scope].sort(),
    );
    assertEquals(
      apiRunResumeContract.projectScoped.payload.scope.join(",") ===
        apiRunResumeContract.runScoped.payload.scope.join(","),
      false,
      "the fixture must keep both orderings so this stays a real test",
    );
  });

  it("fails loudly if the API's resume scope list drifts", async () => {
    for (
      const scope of [
        ["projects:read"],
        [...apiRunResumeContract.projectScoped.payload.scope, "runs:write"],
        apiRunResumeContract.projectScoped.payload.scope.slice(1),
      ]
    ) {
      assertEquals(await verify({ ...projectClaims, scope }), false);
    }
  });

  it("rejects every other token use on an otherwise valid resume bearer", async () => {
    for (
      const tokenUse of [
        "run_event_writer",
        "project_scoped_inference",
        "run_scoped_inference",
        undefined,
      ]
    ) {
      assertEquals(await verify({ ...projectClaims, tokenUse }), false);
      assertEquals(await verify({ ...collaboratorClaims, tokenUse }), false);
    }
  });

  it("rejects a run-scoped bearer whose grant claim is missing", async () => {
    const { grantId: _grantId, ...withoutGrant } = collaboratorClaims;
    assertEquals(await verify(withoutGrant), false);
  });

  it("rejects a project-scoped bearer from an account that is not this server", async () => {
    assertEquals(
      await verify({
        ...projectClaims,
        userId: "55555555-5555-4555-8555-555555555555",
        serviceAccountId: "55555555-5555-4555-8555-555555555555",
      }),
      false,
    );
  });

  it("rejects a projectless resume bearer", async () => {
    // `resumeRuntimeAgentRun` refuses a projectless run before it mints, so a
    // projectless resume bearer is not a shape production ever produces.
    const { projectId: _projectId, ...withoutProject } = projectClaims;
    assertEquals(await verify(withoutProject), false);
  });

  it("rejects an expired resume bearer", async () => {
    assertEquals(await verify({ ...projectClaims, exp: 1 }), false);
  });

  it("fails closed without a configured verifier or public key", async () => {
    for (
      const getConfig of [
        () => ({ VERYFRONT_API_URL: "https://api.example.test" }),
        () => ({
          VERYFRONT_API_URL: "https://api.example.test",
          OAUTH_PUBLIC_KEY: "",
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
        }),
      ]
    ) {
      const auth = createHostedServiceAuth({
        getConfig,
        authProvider: { verifyWithPublicKey: () => Promise.resolve(asClaims(projectClaims)) },
      });
      assertEquals(
        await auth.verifyRunResumeToken({ token: "signed-resume-token", runId }),
        false,
      );
    }
  });

  for (
    const [shape, claims] of [
      ["project-scoped", projectClaims],
      ["run-scoped", collaboratorClaims],
    ] as const
  ) {
    it(`rejects another user's own valid ${shape} resume authority`, async () => {
      const foreignRunId = "run_user_b";
      const foreignClaims = {
        ...claims,
        runId: foreignRunId,
        projectId: "66666666-6666-4666-8666-666666666666",
      };
      // The credential is genuine authority over user B's own run.
      assertEquals(await verify(foreignClaims, foreignRunId), true);
      // The same credential is not authority over user A's run.
      assertEquals(await verify(foreignClaims, runId), false);
    });
  }

  it("keeps an authorized collaborator's resume working when the caller is not the run creator", async () => {
    // The run-scoped bearer names the actor service account and its grant, not
    // the requester. Accepting it is what preserves the API's collaborator
    // policy instead of substituting a creator-only rule here.
    assertEquals(
      apiRunResumeContract.runScoped.payload.userId ===
        apiRunResumeContract.projectScoped.payload.userId,
      false,
    );
    const { manager, settled } = waitingManager(runId);
    const response = await resumeHandler(manager, collaboratorClaims)(resumeRequest(runId));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { accepted: true });
    await settled;
    manager.reset();
  });

  it("refuses a resume for an unknown run id and for another caller's run", async () => {
    const { manager, settled } = waitingManager(runId);
    const handler = resumeHandler(manager, projectClaims);

    assertEquals((await handler(resumeRequest("run_unknown"))).status, 403);
    assertEquals((await handler(resumeRequest("run_user_b"))).status, 403);
    assertEquals(manager.getRunStatus(runId), "waiting");

    assertEquals((await handler(resumeRequest(runId))).status, 200);
    await settled;
    manager.reset();
  });
});
