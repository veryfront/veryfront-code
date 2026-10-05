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

  it("settles a runtime override only through the producer completion it reports", async () => {
    const sessions = new AgentRunSessionManager();
    const runtimeAgent = agent({
      id: "override-stop",
      system: "Test override settlement",
      model: "anthropic/override-stop",
      skills: false,
    });
    let finish!: () => void;
    const producer = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const emptyStream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    const input = (runId: string) => ({
      runId,
      threadId: crypto.randomUUID(),
      messages: [],
      tools: [],
      context: [],
    });
    const settle = async (runId: string, stopped: boolean) => {
      for (
        let attempt = 0;
        attempt < 100 && sessions.stopRegistry.requestStop(runId).stopped !== stopped;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    const reported = await createRuntimeAgentStreamResponse(
      input("run_override_reported"),
      runtimeAgent,
      {
        sessionManager: sessions,
        createRuntime: () => ({
          stream: (_messages, _context, callbacks) => {
            callbacks?.onStreamCompletion?.(producer);
            return Promise.resolve(emptyStream());
          },
        }),
      },
    );
    await reported.text();
    assertEquals(sessions.stopRegistry.requestStop("run_override_reported"), {
      accepted: true,
      stopped: false,
    });
    finish();
    await settle("run_override_reported", true);
    assertEquals(sessions.stopRegistry.requestStop("run_override_reported").stopped, true);

    const silent = await createRuntimeAgentStreamResponse(
      input("run_override_silent"),
      runtimeAgent,
      {
        sessionManager: sessions,
        createRuntime: () => ({ stream: () => Promise.resolve(emptyStream()) }),
      },
    );
    await silent.text();
    // Sandbox cleanup settles on later ticks; no stop request may race it.
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(sessions.stopRegistry.requestStop("run_override_silent"), {
      accepted: false,
      stopped: false,
    });
  });
});
