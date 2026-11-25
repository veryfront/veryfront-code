import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent as createAgent } from "#veryfront/agent";
import { AgentRunSessionManager } from "./session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  type RuntimeAgentStreamExecutionDeps,
} from "./run-stream.ts";

type GateDeps = Pick<
  RuntimeAgentStreamExecutionDeps,
  "projectAgentSandbox" | "runIdBindsToolAuthorization" | "verifiedRunId"
>;

const sandbox = { projectId: "project-1", apiUrl: "https://api.invalid", authToken: "run-token" };
const bound = { runIdBindsToolAuthorization: true, verifiedRunId: "canonical-run-1" } as const;

/** The context the run hands its runtime; the HTTP path of the gate is an integration test. */
async function runtimeContext(deps: GateDeps): Promise<Record<string, unknown>> {
  const contexts: Array<Record<string, unknown> | undefined> = [];
  const response = await createRuntimeAgentStreamResponse(
    {
      threadId: crypto.randomUUID(),
      runId: "run-approval-1",
      messages: [{ id: "user-1", role: "user", content: "Pay Orion LLC" }],
      tools: [],
      context: [],
      forwardedProps: {},
    },
    createAgent({
      id: "payments",
      model: "anthropic/claude-sonnet-4-5",
      system: "Answer.",
      skills: false,
    }),
    {
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: (_messages, context) => {
          contexts.push(context);
          return Promise.resolve(new ReadableStream<Uint8Array>({ start: (c) => c.close() }));
        },
      }),
      ...deps,
    },
  );
  await response.text();
  assertEquals(contexts.length, 1);
  return contexts[0] ?? {};
}

describe("internal agent tool approval gate", () => {
  it("gives a run bound to its project an approval gate", async () => {
    const context = await runtimeContext({ ...bound, projectAgentSandbox: sandbox });
    assertEquals(typeof context.requestToolApproval, "function");
  });

  for (
    const [name, deps] of [
      ["the run is not bound", { verifiedRunId: "canonical-run-1", projectAgentSandbox: sandbox }],
      ["the binding is not exactly true", {
        ...bound,
        runIdBindsToolAuthorization: "true" as unknown as boolean,
        projectAgentSandbox: sandbox,
      }],
      ["the host verified no run ID", {
        runIdBindsToolAuthorization: true,
        projectAgentSandbox: sandbox,
      }],
      ["there is no sandbox", bound],
      ["the sandbox has no project", {
        ...bound,
        projectAgentSandbox: { ...sandbox, projectId: null },
      }],
      ["the sandbox has no API URL", {
        ...bound,
        projectAgentSandbox: { ...sandbox, apiUrl: "" },
      }],
      ["the sandbox has no run credential", {
        ...bound,
        projectAgentSandbox: { ...sandbox, authToken: undefined },
      }],
    ] as const satisfies ReadonlyArray<readonly [string, GateDeps]>
  ) {
    it(`gives no approval gate when ${name}`, async () => {
      const context = await runtimeContext(deps);
      assertEquals(Object.hasOwn(context, "requestToolApproval"), false);
    });
  }
});
