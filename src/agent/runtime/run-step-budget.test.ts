import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { AgentRuntime } from "./index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

/**
 * A hosted run spans several executions: each tool result or auth resume starts
 * a new one. `runStepsUsed` carries the model steps earlier executions used, so
 * the agent's `maxSteps` limits the whole run.
 */
describe("run-wide step budget", () => {
  function createRuntime(input: {
    maxSteps: number;
    runStepsUsed?: number;
    resumeToolCall?: boolean;
    model: ReturnType<typeof scriptedModel>;
    onEffect?: () => void;
  }) {
    return new AgentRuntime("run-step-budget", {
      model: input.model.modelId,
      system: "Short system",
      maxSteps: input.maxSteps,
      skills: false,
      memory: { type: "buffer", maxMessages: 20 },
      tools: {
        record_effect: tool({
          id: "record_effect",
          description: "Record an effect",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            input.onEffect?.();
            return { receipt: "effect-recorded" };
          },
        }),
      },
      resolveModelTransport: () => ({ model: input.model }),
    }, {
      ...(input.runStepsUsed === undefined ? {} : { runStepsUsed: input.runStepsUsed }),
      ...(input.resumeToolCall
        ? { resumeToolCall: { id: "parked-effect", name: "record_effect", input: {} } }
        : {}),
    });
  }

  const userMessage = [{
    id: "user-input",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Record the effect." }],
  }];

  function alwaysCallsTool() {
    let call = 0;
    return scriptedModel([() => ({
      toolCalls: [{ id: `call-${++call}`, name: "record_effect", input: {} }],
    })], { only: "stream", repeatLastTurn: true });
  }

  it("gives an execution only the steps the run has left", async () => {
    const model = alwaysCallsTool();
    const runtime = createRuntime({ maxSteps: 3, runStepsUsed: 2, model });

    const wire = await new Response(await runtime.stream(userMessage)).text();

    assertEquals(model.callCount, 1, wire);
  });

  it("keeps the agent's full budget when no earlier steps are reported", async () => {
    const model = alwaysCallsTool();
    const runtime = createRuntime({ maxSteps: 2, model });

    await new Response(await runtime.stream(userMessage)).text();

    assertEquals(model.callCount, 2);
  });

  it("finishes with max_steps and no model call once the run used its budget", async () => {
    const model = alwaysCallsTool();
    const runtime = createRuntime({ maxSteps: 2, runStepsUsed: 2, model });

    const wire = await new Response(await runtime.stream(userMessage)).text();

    assertEquals(model.callCount, 0, wire);
    assert(wire.includes('"finishReason":"max_steps"'), wire);
  });

  it("runs only the owed resume call when the run used its budget", async () => {
    let effects = 0;
    const model = alwaysCallsTool();
    const runtime = createRuntime({
      maxSteps: 1,
      runStepsUsed: 1,
      resumeToolCall: true,
      model,
      onEffect: () => effects++,
    });

    const wire = await new Response(await runtime.stream(userMessage)).text();

    assertEquals(effects, 1, wire);
    assertEquals(model.callCount, 0, wire);
    assert(wire.includes("effect-recorded"), wire);
    assert(wire.includes('"finishReason":"max_steps"'), wire);
  });
});
