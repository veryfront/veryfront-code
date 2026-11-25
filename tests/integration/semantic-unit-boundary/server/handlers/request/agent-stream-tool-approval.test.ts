// Answers the approval ask from a local HTTP server and points the host API URL at it, so it runs
// in the semantic integration suite rather than as a unit.
import "#veryfront/schemas/_test-setup.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  INGRESS_RUN_TERMINAL_TOKEN_HEADER,
  sealIngressCredentials,
} from "#veryfront/security/http/ingress-credentials.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolApprovalGate } from "#veryfront/tool/approval.ts";
import { AgentStreamHandler } from "#veryfront/server/handlers/request/agent-stream.handler.ts";
import {
  createAgent,
  createControlPlaneSignature,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  createAgentStreamRequestBody,
  createSourceCapableAgentStreamContext as createCtx,
} from "#veryfront/server/handlers/request/agent-stream.handler.test-helpers.ts";

const runId = "run_1";
const canonicalRunId = "22222222-2222-4222-8222-222222222222";
const projectId = "10000000-1000-4000-8000-100000000005";
const terminalToken = `header.${
  btoa(JSON.stringify({
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    runId,
    canonicalRunId,
    dispatchNonce: "dispatch-1",
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}.signature`;

/** The gate the handler hands a verified run that carries a runtime token. */
async function boundRunGate(): Promise<ToolApprovalGate> {
  const contexts: Array<Record<string, unknown> | undefined> = [];
  const handler = new AgentStreamHandler({
    loadAgentSourceEnvironment: () => Promise.resolve({}),
    ensureProjectDiscovery: () => Promise.resolve(createEmptyDiscoveryResult()),
    getAgent: () => createAgent("assistant-1"),
    getAllAgentIds: () => ["assistant-1"],
    sessionManager: new AgentRunSessionManager(),
    verifyRunTerminalToken: () => Promise.resolve(true),
    createRuntime: () => ({
      stream: (_messages, context) => {
        contexts.push(context);
        return Promise.resolve(new ReadableStream<Uint8Array>({ start: (c) => c.close() }));
      },
    }),
  });
  const body = createAgentStreamRequestBody();
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    requestId: runId,
    projectId,
  });
  const result = await handler.handle(
    sealIngressCredentials(
      new Request(`https://example.com/api/control-plane/runs/${runId}/stream`, {
        method: "POST",
        headers: {
          "x-veryfront-control-plane-jws": jws,
          [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: terminalToken,
        },
        body,
      }),
    ),
    { ...createCtx(publicKeyPem), projectId, proxyToken: "runtime-token" },
  );
  assertExists(result.response);
  assertEquals(result.response.status, 200, await result.response.clone().text());
  await result.response.text();
  assertEquals(contexts.length, 1);
  return contexts[0]?.requestToolApproval as ToolApprovalGate;
}

describe("agent stream tool approval", () => {
  it("asks on the verified canonical run's input requests with the runtime token", async () => {
    const asks: Array<{ method: string; path: string; authorization: string | null }> = [];
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (req) => {
      asks.push({
        method: req.method,
        path: new URL(req.url).pathname,
        authorization: req.headers.get("authorization"),
      });
      return Response.json({
        input_request_id: "ir-1",
        status: "submitted",
        response: { values: { decision: "approve" }, actor: { type: "user", id: "checker" } },
      }, { status: 201 });
    });
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    Deno.env.set("VERYFRONT_API_BASE_URL", `http://127.0.0.1:${server.addr.port}`);
    try {
      const gate = await boundRunGate();
      assertEquals(typeof gate, "function");
      const decision = await gate({
        toolName: "transfer-payment",
        toolCallId: "call-1",
        input: { amount: 1 },
        policy: { expiresInSeconds: 60 },
      });
      assertEquals(decision.approved, true);
      assertEquals(asks, [{
        method: "POST",
        path: `/runs/${canonicalRunId}/input-requests`,
        authorization: "Bearer runtime-token",
      }]);
    } finally {
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      await server.shutdown();
    }
  });
});
