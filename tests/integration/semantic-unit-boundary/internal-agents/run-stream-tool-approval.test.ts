// Answers the approval ask from a local HTTP server, so it runs in the semantic integration
// suite rather than as a unit.
import "#veryfront/schemas/_test-setup.ts";
import { defineSchema } from "#veryfront/schemas";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent as createAgent } from "#veryfront/agent";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { tool } from "#veryfront/tool";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  type RuntimeAgentStreamExecutionDeps,
} from "#veryfront/internal-agents/run-stream.ts";

const NO_CHANNEL = "this runtime has no approval channel";

interface ApprovalAsk {
  path: string;
  authorization: string | null;
  body: { tool_call_id: string; tool_call: { name: string; arguments: unknown } };
}

/** Run an agent whose one tool needs approval, against a local API that approves every ask. */
async function runGatedTool(
  deps: (apiUrl: string) => Pick<
    RuntimeAgentStreamExecutionDeps,
    "projectAgentSandbox" | "runIdBindsToolAuthorization"
  >,
) {
  const asks: ApprovalAsk[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (req) => {
    asks.push({
      path: new URL(req.url).pathname,
      authorization: req.headers.get("authorization"),
      body: await req.json(),
    });
    return Response.json({
      input_request_id: "ir-1",
      status: "submitted",
      response: { values: { decision: "approve" }, actor: { type: "user", id: "checker" } },
    }, { status: 201 });
  });
  let transfers = 0;
  const transfer = tool({
    id: "transfer-payment",
    description: "Move money",
    approval: { expiresInSeconds: 3600 },
    inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
    execute: () => {
      transfers += 1;
      return { transferred: true };
    },
  });
  const modelId = `anthropic/tool-approval-${crypto.randomUUID()}`;
  const model = scriptedModel(
    [{ toolCalls: [{ id: "call-1", name: "transfer-payment", input: { amount: 2_000_000 } }] }],
    { modelId, provider: "anthropic", only: "stream" },
  );
  const agent = createAgent({
    id: "payments",
    model: modelId,
    system: "Call transfer-payment once.",
    skills: false,
    tools: { "transfer-payment": true },
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  });
  try {
    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run-approval-1",
        messages: [{ id: "user-1", role: "user", content: "Pay Orion LLC" }],
        tools: [],
        context: [],
        forwardedProps: {},
      },
      agent,
      {
        sessionManager: new AgentRunSessionManager(),
        localTools: { "transfer-payment": transfer },
        ...deps(`http://127.0.0.1:${server.addr.port}`),
      },
    );
    return { body: await response.text(), asks, transfers };
  } finally {
    await server.shutdown();
  }
}

describe("internal agent tool approval", () => {
  it("asks a checker through the run's input requests and runs the call once approved", async () => {
    const { body, asks, transfers } = await runGatedTool((apiUrl) => ({
      runIdBindsToolAuthorization: true,
      projectAgentSandbox: { projectId: "project-1", apiUrl, authToken: "run-token" },
    }));
    assertEquals(body.includes(NO_CHANNEL), false, `gated tool failed with "${NO_CHANNEL}"`);
    assertEquals(asks.length, 1);
    assertEquals(asks[0]!.path, "/runs/run-approval-1/input-requests");
    assertEquals(asks[0]!.authorization, "Bearer run-token");
    assertEquals(asks[0]!.body.tool_call_id, "call-1");
    assertEquals(asks[0]!.body.tool_call, {
      name: "transfer-payment",
      arguments: { amount: 2_000_000 },
    });
    assertEquals(transfers, 1);
  });

  for (
    const [name, deps] of [
      ["the run is not bound to the project", (apiUrl: string) => ({
        projectAgentSandbox: { projectId: "project-1", apiUrl, authToken: "run-token" },
      })],
      ["no run credential", (apiUrl: string) => ({
        runIdBindsToolAuthorization: true,
        projectAgentSandbox: { projectId: "project-1", apiUrl },
      })],
      ["no API URL", (_apiUrl: string) => ({
        runIdBindsToolAuthorization: true,
        projectAgentSandbox: { projectId: "project-1", authToken: "run-token" },
      })],
    ] as const
  ) {
    it(`still fails closed when ${name}`, async () => {
      const { body, asks, transfers } = await runGatedTool(deps);
      assertStringIncludes(body, NO_CHANNEL);
      assertEquals(asks.length, 0);
      assertEquals(transfers, 0);
    });
  }
});
