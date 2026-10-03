import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

describe("agent stop acknowledgement", () => {
  it("retires failed setup without admitting a phantom producer", async () => {
    const sessions = new AgentRunSessionManager();
    const runtimeAgent = agent({
      id: "setup-stop",
      system: "Test producer settlement",
      model: "anthropic/setup-stop",
      skills: false,
    });
    const input = {
      runId: "run_setup_stop",
      threadId: crypto.randomUUID(),
      messages: [],
      tools: [],
      context: [],
    };
    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(input, runtimeAgent, {
          sessionManager: sessions,
          createRuntime: () => {
            throw new Error("setup rejected");
          },
        }),
      Error,
      "setup rejected",
    );
    assertEquals(sessions.stopRegistry.requestStop(input.runId), { accepted: true, stopped: true });
    const duplicateId = "run_duplicate_stop";
    sessions.startRun({ runId: duplicateId, threadId: crypto.randomUUID() });
    await assertRejects(() =>
      createRuntimeAgentStreamResponse({ ...input, runId: duplicateId }, runtimeAgent, {
        sessionManager: sessions,
      })
    );
    assertEquals(sessions.stopRegistry.requestStop(duplicateId), {
      accepted: false,
      stopped: false,
    });
    sessions.cancelRun(duplicateId);
  });

  it("waits for non-cooperative producer work after output cancellation", async () => {
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const work = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = scriptedModel([{ toolCalls: [{ id: "slow-1", name: "slow", input: "{}" }] }], {
      provider: "anthropic",
      modelId: "anthropic/stop-settlement",
      only: "stream",
    });
    const runtimeAgent = agent({
      id: "stop-settlement",
      model: "anthropic/stop-settlement",
      system: "Run the slow tool.",
      skills: false,
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      tools: {
        slow: tool({
          id: "slow",
          description: "Slow test work",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => {
            start();
            await work;
            return "settled";
          },
        }),
      },
    });
    const sessions = new AgentRunSessionManager();
    const runId = "run_producer_stop_settlement";
    const response = await createRuntimeAgentStreamResponse(
      {
        runId,
        threadId: crypto.randomUUID(),
        messages: [{ id: "user-1", role: "user", content: "Run it" }],
        tools: [],
        context: [],
      },
      runtimeAgent,
      { sessionManager: sessions },
    );
    const reading = response.text();
    try {
      await started;
      assertEquals(sessions.stopRegistry.requestStop(runId), { accepted: true, stopped: false });
      await reading;
      assertEquals(sessions.stopRegistry.requestStop(runId).stopped, false);
    } finally {
      release();
    }
    // The producer promise and sandbox cleanup independently settle on microtasks.
    for (
      let attempt = 0;
      attempt < 100 && !sessions.stopRegistry.requestStop(runId).stopped;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assertEquals(sessions.stopRegistry.requestStop(runId).stopped, true);
  });
});
