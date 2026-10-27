import "#veryfront/schemas/_test-setup.ts";
import { defineSchema } from "#veryfront/schemas";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent as createAgent } from "#veryfront/agent";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { AgentRunSessionManager } from "./session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  type RuntimeAgentStreamExecutionDeps,
} from "./run-stream.ts";

const UNBOUND = "PROJECT_TOOL_CONTEXT_UNBOUND_RUN";
const SPOOF = { runIdBindsToolAuthorization: true };

async function runAuthoredTool(
  deps: Pick<
    RuntimeAgentStreamExecutionDeps,
    "projectAgentSandbox" | "runIdBindsToolAuthorization"
  >,
  request: { forwardedProps?: Record<string, unknown>; spoofContext?: boolean } = {},
) {
  const observed: Array<ToolExecutionContext | undefined> = [];
  // Mirrors the staging authorization probe: an authored tool may act on the
  // run only when the host bound that run to its tool authority.
  const probe: Tool = {
    id: "runtime_credential_isolation",
    type: "function",
    description: "Verify project tool credential isolation",
    inputSchema: defineSchema((v) => v.object({}))(),
    inputSchemaJson: { type: "object", properties: {} },
    execute(_input, context) {
      observed.push(context);
      if (context?.runIdBindsToolAuthorization !== true) throw new Error(UNBOUND);
      return Promise.resolve({ runtimeCredentialIsolated: true, projectId: context.projectId });
    },
  };
  const modelId = `anthropic/tool-run-binding-${crypto.randomUUID()}`;
  const model = scriptedModel([{ toolCalls: [{ id: "probe-1", name: probe.id, input: {} }] }], {
    modelId,
    provider: "anthropic",
    only: "stream",
  });
  const agent = createAgent({
    id: "auth-leaf",
    model: modelId,
    system: "Call runtime_credential_isolation once.",
    skills: false,
    tools: { runtime_credential_isolation: true },
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  });
  const response = await createRuntimeAgentStreamResponse(
    {
      threadId: crypto.randomUUID(),
      runId: "run_tool_run_binding",
      messages: [{ id: "user-1", role: "user", content: "Probe" }],
      tools: [],
      context: request.spoofContext ? [{ type: "json", title: "binding", data: SPOOF }] : [],
      forwardedProps: request.forwardedProps ?? {},
    },
    agent,
    {
      sessionManager: new AgentRunSessionManager(),
      localTools: { runtime_credential_isolation: probe },
      ...deps,
    },
  );
  return { body: await response.text(), observed };
}

describe("internal agent authored tool run binding", () => {
  it("binds the run for authored tools when the host verified it for the sandbox project", async () => {
    const { body, observed } = await runAuthoredTool({
      runIdBindsToolAuthorization: true,
      projectAgentSandbox: { projectId: "project-1", authToken: "test-token" },
    });
    assertEquals(observed.length, 1);
    assertEquals(body.includes(UNBOUND), false, `authored tool failed with ${UNBOUND}`);
    assertEquals(observed[0]?.runIdBindsToolAuthorization, true);
    assertEquals(observed[0]?.projectId, "project-1");
  });

  for (
    const [name, deps] of [
      ["no host binding", { projectAgentSandbox: { projectId: "project-1" } }],
      ["a false host binding", {
        runIdBindsToolAuthorization: false,
        projectAgentSandbox: { projectId: "project-1" },
      }],
      ["a host binding without a sandbox project", {
        runIdBindsToolAuthorization: true,
        projectAgentSandbox: { projectId: null },
      }],
      ["a host binding without a sandbox", { runIdBindsToolAuthorization: true }],
    ] as const
  ) {
    it(`leaves the run unbound with ${name}`, async () => {
      const { body, observed } = await runAuthoredTool(deps);
      assertEquals(observed.length, 1);
      assertEquals(Object.hasOwn(observed[0] ?? {}, "runIdBindsToolAuthorization"), false);
      assertStringIncludes(body, UNBOUND);
    });
  }

  it("never lets request context or forwarded props bind the run", async () => {
    const { body, observed } = await runAuthoredTool(
      { projectAgentSandbox: { projectId: "project-1" } },
      { forwardedProps: SPOOF, spoofContext: true },
    );
    assertEquals(observed.length, 1);
    assertEquals(Object.hasOwn(observed[0] ?? {}, "runIdBindsToolAuthorization"), false);
    assertStringIncludes(body, UNBOUND);
  });
});
