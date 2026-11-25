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
    runStepsFinished?: number;
    resumeToolCall?: boolean;
    recoveryNextStep?: number;
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
      ...(input.runStepsFinished === undefined ? {} : { runStepsFinished: input.runStepsFinished }),
      ...(input.recoveryNextStep === undefined ? {} : {
        recoveryContinuation: {
          version: 1,
          nextStep: input.recoveryNextStep,
          messages: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latestAssistantText: "",
          completed: false,
          recoveredEmptyResponse: false,
          recoveredInterruptedLocalToolBatch: false,
          startupSkillLoaded: true,
        },
      }),
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

  it("runs an owed resume call in a recovered execution that already used the run's budget", async () => {
    let effects = 0;
    const model = alwaysCallsTool();
    const runtime = createRuntime({
      maxSteps: 2,
      runStepsUsed: 1,
      recoveryNextStep: 1,
      resumeToolCall: true,
      model,
      onEffect: () => effects++,
    });

    const wire = await new Response(await runtime.stream(userMessage)).text();

    assertEquals(effects, 1, wire);
    assertEquals(model.callCount, 0, wire);
    assert(wire.includes('"finishReason":"max_steps"'), wire);
  });

  it("gives a recovered execution the rest of the run's remainder", async () => {
    const model = alwaysCallsTool();
    // 1 step before this execution, 1 taken by it before recovery: 2 of 4 remain.
    const runtime = createRuntime({ maxSteps: 4, runStepsUsed: 1, recoveryNextStep: 1, model });

    await new Response(await runtime.stream(userMessage)).text();

    assertEquals(model.callCount, 2);
  });

  it("runs an owed resume call when a first execution's recovery reached maxSteps", async () => {
    let effects = 0;
    const model = alwaysCallsTool();
    const runtime = createRuntime({
      maxSteps: 2,
      recoveryNextStep: 2,
      resumeToolCall: true,
      model,
      onEffect: () => effects++,
    });

    const wire = await new Response(await runtime.stream(userMessage)).text();

    assertEquals(effects, 1, wire);
    assertEquals(model.callCount, 0, wire);
    assert(wire.includes('"finishReason":"max_steps"'), wire);
  });

  it("derives a recovered execution's earlier run steps from the run's finished steps", async () => {
    const model = alwaysCallsTool();
    // 3 finished in all, 1 of them by this execution before it recovered: 2 earlier, 1 of 4 left.
    const runtime = createRuntime({ maxSteps: 4, runStepsFinished: 3, recoveryNextStep: 1, model });

    await new Response(await runtime.stream(userMessage)).text();

    assertEquals(model.callCount, 1);
  });

  it("finishes a recovered execution with max_steps once the run finished its budget", async () => {
    const model = alwaysCallsTool();
    const runtime = createRuntime({ maxSteps: 2, runStepsFinished: 2, model });

    const wire = await new Response(await runtime.stream(userMessage)).text();

    assertEquals(model.callCount, 0, wire);
    assert(wire.includes('"finishReason":"max_steps"'), wire);
  });
});
