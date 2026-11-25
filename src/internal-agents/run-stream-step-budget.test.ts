import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent as createAgent } from "#veryfront/agent";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

/**
 * The control plane resumes a run in a new execution after each parked tool,
 * and reports the model steps the run already used as
 * `forwardedProps.runStepsUsed`. An agent's `maxSteps` limits the whole run.
 */
describe("internal-agents/run-stream run-wide step budget", () => {
  function setup(maxSteps: number | undefined) {
    let call = 0;
    const model = scriptedModel([() => ({
      toolCalls: [{ id: `call-${++call}`, name: "record_effect", input: {} }],
    })], {
      modelId: "anthropic/step-budget",
      provider: "anthropic",
      only: "stream",
      repeatLastTurn: true,
    });
    const runtimeAgent = createAgent({
      id: "step-budget-agent",
      model: "anthropic/step-budget",
      system: "Record effects.",
      skills: false,
      ...(maxSteps === undefined ? {} : { maxSteps }),
      tools: {
        record_effect: tool({
          id: "record_effect",
          description: "Record an effect",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ receipt: "effect-recorded" }),
        }),
      },
      resolveModelTransport: () => ({ model }),
    });
    return { model, runtimeAgent };
  }

  async function run(
    runtimeAgent: ReturnType<typeof createAgent>,
    forwardedProps: Record<string, unknown>,
  ): Promise<string> {
    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: `run_${crypto.randomUUID()}`,
        messageId: crypto.randomUUID(),
        messages: [{ id: "user-1", role: "user", content: "Record effects" }],
        tools: [],
        context: [],
        forwardedProps,
      },
      runtimeAgent,
      { sessionManager: new AgentRunSessionManager() },
    );
    return await response.text();
  }

  it("gives a resumed execution only the steps the run has left", async () => {
    const { model, runtimeAgent } = setup(3);

    await run(runtimeAgent, { runStepsUsed: 2 });

    assertEquals(model.callCount, 1);
  });

  it("finishes with max_steps and no model call once the run used its budget", async () => {
    const { model, runtimeAgent } = setup(2);

    const body = await run(runtimeAgent, { runStepsUsed: 2 });

    assertEquals(model.callCount, 0, body);
    assert(body.includes("event: RunFinished"), body);
    assert(!body.includes("event: RunError"), body);
    assert(body.includes('"finishReason":"max_steps"'), body);
  });

  it("keeps the per-execution default for an agent without its own maxSteps", async () => {
    const { model, runtimeAgent } = setup(undefined);
    const limited = setup(2);

    await run(limited.runtimeAgent, {});
    const unlimitedBody = await run(runtimeAgent, { runStepsUsed: 2 });

    assertEquals(limited.model.callCount, 2);
    assert(model.callCount > 2, unlimitedBody);
  });
});
