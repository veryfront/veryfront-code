import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCanonicalBrokerAuthorizer } from "./canonical-broker-authorization.ts";
import { parseBrokerRuntimeAgentIngress } from "./broker-ingress.ts";
import { invocation, options, projectId, signedRequest } from "./broker-ingress.test-helpers.ts";

async function fixture(rejection?: "jwt" | "writer" | "terminal" | "throw") {
  const sourceId = "00000000-0000-4000-8000-000000000099";
  const base = invocation();
  const signed = await signedRequest(
    invocation({
      run: { ...base.run, project: { ...base.run.project, runtimeTargetBranchName: "main" } },
      sourceProject: {
        projectId: sourceId,
        projectSlug: "private-source",
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "00000000-0000-4000-8000-000000000098",
        runtimeTargetEnvironmentName: "Production",
      },
    }),
    { projectId: sourceId, audience: "private-source" },
  );
  signed.request.headers.set("x-veryfront-run-terminal-token", "terminal-token");
  const calls: unknown[] = [];
  const writer = { verified: rejection !== "writer" };
  const authorizeScope = createCanonicalBrokerAuthorizer({
    verifyJwt(token) {
      calls.push(["jwt", token]);
      if (rejection === "throw") return Promise.reject(new Error("private verifier failure"));
      return Promise.resolve(
        rejection === "jwt"
          ? {
            success: false as const,
            error: { statusCode: 401, errorCode: "UNAUTHENTICATED" as const, message: "Denied" },
          }
          : { success: true as const, userId: "transport-principal", email: "", token },
      );
    },
    verifyRunEventAppendToken(input) {
      calls.push(["writer", input]);
      return Promise.resolve(writer);
    },
    verifyRunTerminalToken(input) {
      calls.push(["terminal", input]);
      return Promise.resolve(rejection !== "terminal");
    },
  });
  return {
    request: signed.request,
    calls,
    writer,
    parse: () =>
      parseBrokerRuntimeAgentIngress(signed.request, {
        ...options(signed.publicKeyPem),
        projectId: sourceId,
        audience: "private-source",
        expectedOwner: { scopeKind: "project", projectId: sourceId },
        authorizeScope,
      }),
  };
}

describe("canonical broker credential authorization", () => {
  it("verifies independent credentials against the consuming run and retains writer provenance", async () => {
    const f = await fixture();
    const admitted = await f.parse();
    assertEquals(f.calls, [
      ["jwt", "broker-token"],
      ["writer", { projectId, runId: "run-1", agentId: "builder", token: "run-event-token" }],
      ["terminal", { projectId, runId: "run-1", token: "terminal-token" }],
    ]);
    assertEquals(admitted.privateAuthority.authorization?.runEventWriter === f.writer, true);
    assertEquals(admitted.executor.run.project.projectId, projectId);
  });
  for (const rejection of ["jwt", "writer", "terminal"] as const) {
    it(`denies a rejected ${rejection} credential without fallback`, async () => {
      const f = await fixture(rejection);
      await assertRejects(f.parse, Error, "BROKER_INGRESS_SCOPE_DENIED");
      assertEquals(f.calls.length, { jwt: 1, writer: 2, terminal: 3 }[rejection]);
    });
  }
  it("does not turn verifier failure into admission", async () => {
    const f = await fixture("throw");
    await assertRejects(f.parse, Error, "BROKER_INGRESS_SCOPE_FAILED");
    assertEquals(f.calls.length, 1);
  });
  it("does not borrow an execution credential for missing terminal authority", async () => {
    const f = await fixture();
    f.request.headers.delete("x-veryfront-run-terminal-token");
    await assertRejects(f.parse, Error, "BROKER_INGRESS_SCOPE_DENIED");
    assertEquals(f.calls, []);
  });
  it("does not substitute the signed API credential for a malformed transport bearer", async () => {
    const f = await fixture();
    f.request.headers.set("authorization", "Basic broker-token");
    await assertRejects(f.parse, Error, "BROKER_INGRESS_SCOPE_DENIED");
    assertEquals(f.calls, []);
  });
});
