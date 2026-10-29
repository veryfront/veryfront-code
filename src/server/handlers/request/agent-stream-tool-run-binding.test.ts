import "#veryfront/schemas/_test-setup.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  INGRESS_RUN_TERMINAL_TOKEN_HEADER,
  sealIngressCredentials,
} from "#veryfront/security/http/ingress-credentials.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentStreamHandler, bindsAuthoredToolRun } from "./agent-stream.handler.ts";
import { createAgent, createControlPlaneSignature } from "./internal-agent-run.test-helpers.ts";
import {
  createAgentStreamRequestBody,
  createSourceCapableAgentStreamContext as createCtx,
} from "./agent-stream.handler.test-helpers.ts";

const runId = "run_1";
const projectId = "10000000-1000-4000-8000-100000000005";
const encoded = btoa(JSON.stringify({
  tokenUse: "run_event_writer",
  writerPurpose: "current_run_terminal",
  runId,
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  dispatchNonce: "dispatch-1",
})).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const token = `header.${encoded}.signature`;

type Verification = "valid" | "rejected" | "throws";

async function streamedToolContext(
  verification: Verification,
  options: { token?: string | null; body?: string } = {},
): Promise<Record<string, unknown>> {
  const contexts: Array<Record<string, unknown> | undefined> = [];
  const handler = new AgentStreamHandler({
    loadAgentSourceEnvironment: () => Promise.resolve({}),
    ensureProjectDiscovery: () => Promise.resolve(createEmptyDiscoveryResult()),
    getAgent: () => createAgent("assistant-1"),
    getAllAgentIds: () => ["assistant-1"],
    sessionManager: new AgentRunSessionManager(),
    verifyRunTerminalToken: () => {
      if (verification === "throws") throw new Error("Verifier unavailable");
      return Promise.resolve(verification === "valid");
    },
    createRuntime: () => ({
      stream: (_messages, context) => {
        contexts.push(context);
        return Promise.resolve(new ReadableStream<Uint8Array>({ start: (c) => c.close() }));
      },
    }),
  });
  const body = options.body ?? createAgentStreamRequestBody();
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    requestId: runId,
    projectId,
  });
  const headers: Record<string, string> = { "x-veryfront-control-plane-jws": jws };
  const terminal = options.token === undefined ? token : options.token;
  if (terminal !== null) headers[INGRESS_RUN_TERMINAL_TOKEN_HEADER] = terminal;
  const result = await handler.handle(
    sealIngressCredentials(
      new Request(`https://example.com/api/control-plane/runs/${runId}/stream`, {
        method: "POST",
        headers,
        body,
      }),
    ),
    { ...createCtx(publicKeyPem), projectId },
  );
  assertExists(result.response);
  assertEquals(result.response.status, 200, await result.response.clone().text());
  await result.response.text();
  assertEquals(contexts.length, 1);
  assertExists(contexts[0]);
  return contexts[0];
}

describe("agent stream authored tool run binding", () => {
  it("binds the verified run for the sandbox project", async () => {
    const context = await streamedToolContext("valid");
    assertEquals(context.projectId, projectId);
    assertEquals(context.runIdBindsToolAuthorization, true);
  });

  for (const verification of ["rejected", "throws"] as const) {
    it(`leaves the run unbound when terminal verification ${verification}`, async () => {
      const context = await streamedToolContext(verification);
      assertEquals(Object.hasOwn(context, "runIdBindsToolAuthorization"), false);
    });
  }

  it("leaves the run unbound without a terminal token", async () => {
    const context = await streamedToolContext("valid", { token: null });
    assertEquals(Object.hasOwn(context, "runIdBindsToolAuthorization"), false);
  });

  it("ignores a binding supplied in the signed request body", async () => {
    const context = await streamedToolContext("rejected", {
      body: createAgentStreamRequestBody({
        runIdBindsToolAuthorization: true,
        forwardedProps: { runIdBindsToolAuthorization: true },
        context: [{ type: "json", title: "binding", data: { runIdBindsToolAuthorization: true } }],
      }),
    });
    assertEquals(Object.hasOwn(context, "runIdBindsToolAuthorization"), false);
  });

  it("requires the verified project to be the sandbox project", () => {
    const verified = { currentRunId: "22222222-2222-4222-8222-222222222222" };
    assertEquals(
      bindsAuthoredToolRun({ ...verified, terminalProjectId: "a", sandboxProjectId: "a" }),
      true,
    );
    assertEquals(
      bindsAuthoredToolRun({ ...verified, terminalProjectId: "a", sandboxProjectId: "b" }),
      false,
    );
    assertEquals(
      bindsAuthoredToolRun({ ...verified, terminalProjectId: undefined, sandboxProjectId: null }),
      false,
    );
    assertEquals(
      bindsAuthoredToolRun({
        currentRunId: undefined,
        terminalProjectId: "a",
        sandboxProjectId: "a",
      }),
      false,
    );
  });
});
