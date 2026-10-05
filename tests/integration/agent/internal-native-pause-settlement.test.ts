import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { agent } from "#veryfront/agent";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { createRunBoundAgentManualPause } from "#veryfront/agent/hosted/manual-pause-credential.ts";
import type { AgentServiceSandboxToolsResult } from "#veryfront/sandbox";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  registerRuntimeManualPause,
} from "#veryfront/internal-agents/run-stream.ts";

describe("internal native pause settlement", () => {
  for (
    const outcome of [
      "before-step",
      "after-tool",
      "cancel",
      "cancel-cleanup",
      "stop-cleanup",
    ] as const
  ) {
    it(`confirms ${outcome} only after the original producer and session retire`, async () => {
      const toolName = `slow_${outcome.replaceAll("-", "_")}`;
      const agentId = `internal-pause-${outcome}`;
      const sessions = new AgentRunSessionManager();
      const started = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      const confirmed = Promise.withResolvers<void>();
      const cleanupEntered = Promise.withResolvers<void>();
      const cleanupRelease = Promise.withResolvers<void>();
      let toolStarted = false;
      let toolEnded = false;
      let settlements = 0;
      const input: Parameters<typeof createRuntimeAgentStreamResponse>[0] = {
        runId: `run_internal_pause_${outcome}`,
        threadId: crypto.randomUUID(),
        messages: [{ id: "user-1", role: "user", content: "Run the tool" }],
        tools: [],
        context: [],
      };
      await withMockFetch((_url, init) => {
        if (init?.body === '{"settled":true}') {
          settlements++;
          assertEquals(sessions.getRunStatus(input.runId), null);
          assertEquals(outcome === "before-step" || toolEnded, true);
          // A resume may reuse the id immediately after this receipt commits.
          sessions.startRun({ runId: input.runId, threadId: input.threadId });
          sessions.completeRun(input.runId);
          confirmed.resolve();
          return Promise.resolve(Response.json({ stop: true }));
        }
        return Promise.resolve(
          Response.json(
            init?.body ? { stop: true } : {
              checkpoint: null,
              stop: false,
              pauseRequested: outcome === "before-step" || toolStarted,
            },
          ),
        );
      }, async () => {
        const capability = createRunBoundAgentManualPause({
          apiUrl: "https://api.example.test",
          runId: input.runId,
          token: "internal-pause-token",
          signal: new AbortController().signal,
        });
        registerRuntimeManualPause(input, capability);
        const model = scriptedModel([
          { toolCalls: [{ id: "slow-1", name: toolName, input: "{}" }] },
          { text: "Done" },
        ], { provider: "anthropic", modelId: `anthropic/${agentId}`, only: "stream" });
        const runtimeAgent = agent({
          id: agentId,
          model: `anthropic/${agentId}`,
          system: "Run the slow tool once.",
          skills: false,
          maxSteps: 3,
          resolveModelTransport: () => ({ model }),
          tools: {
            ...(outcome.endsWith("cleanup") ? { bash: true } : {}),
            [toolName]: tool({
              id: toolName,
              description: "Hold original work",
              inputSchema: defineSchema((v) => v.object({}))(),
              execute: async () => {
                toolStarted = true;
                started.resolve();
                await released.promise;
                toolEnded = true;
                return "settled";
              },
            }),
          },
        });
        const response = await createRuntimeAgentStreamResponse(input, runtimeAgent, {
          sessionManager: sessions,
          ...(outcome.endsWith("cleanup")
            ? {
              createBashTool: () =>
                Promise.reject(new Error("Unused provider factory must not run")),
              createAgentServiceSandboxTools: async () => ({
                sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
                tools: {
                  bash: {
                    description: "Fixture bash",
                    inputSchemaJson: { type: "object", properties: {} },
                    execute: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
                  },
                },
                closeSandbox: async () => {
                  cleanupEntered.resolve();
                  await cleanupRelease.promise;
                },
              }),
            }
            : {}),
        });
        const reader = outcome.endsWith("cleanup") ? response.body!.getReader() : undefined;
        const reading = reader
          ? (async () => {
            let body = "";
            const decoder = new TextDecoder();
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) return body;
              body += decoder.decode(chunk.value, { stream: true });
            }
          })()
          : response.text();
        if (outcome !== "before-step") {
          await Promise.race([
            started.promise,
            reading.then((body) => {
              throw new Error(
                `Producer ended before tool start; calls=${model.callCount}; body=${
                  body.slice(-1200)
                }`,
              );
            }),
          ]);
          assertEquals(settlements, 0);
          if (outcome === "cancel") sessions.cancelRun(input.runId);
          released.resolve();
        }
        if (outcome.endsWith("cleanup")) {
          await cleanupEntered.promise;
          assertEquals(sessions.getRunStatus(input.runId), null);
          if (outcome === "stop-cleanup") {
            assertEquals(sessions.stopRegistry.requestStop(input.runId), {
              accepted: true,
              stopped: false,
            });
            cleanupRelease.resolve();
          } else {
            const cancellation = reader!.cancel("client detached during cleanup");
            cleanupRelease.resolve();
            await cancellation;
          }
        }
        await reading;
        for (let tick = 0; tick < 100 && settlements === 0; tick++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        assertEquals(
          settlements,
          (outcome.startsWith("cancel") || outcome === "stop-cleanup") ? 0 : 1,
        );
        if (!(outcome.startsWith("cancel") || outcome === "stop-cleanup")) await confirmed.promise;
        if (outcome === "stop-cleanup") {
          assertEquals(sessions.stopRegistry.requestStop(input.runId).stopped, true);
        }
        assertEquals(model.callCount, outcome === "before-step" ? 0 : 1);
      });
    });
  }
});
