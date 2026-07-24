import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { Memory } from "../memory/memory-interface.ts";
import type { Message } from "../types.ts";
import { AgentRuntime } from "./index.ts";

describe("agent runtime generate cancellation", () => {
  it("does not start tools when cancellation occurs during assistant memory persistence", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled while saving memory");
    let toolCalls = 0;
    const configuredTool = tool({
      id: "configured_tool",
      description: "Must not run after cancellation",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        toolCalls++;
        return { ok: true };
      },
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/generate-cancel-memory",
      async doGenerate() {
        return {
          content: [{
            type: "tool-call" as const,
            toolCallId: "configured-1",
            toolName: "configured_tool",
            input: "{}",
          }],
          finishReason: "tool-calls" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const runtime = new AgentRuntime("cancel-memory", {
      model: "hosted/generate-cancel-memory",
      system: "Cancellation test",
      tools: { configured_tool: configuredTool },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });
    const memory: Memory<Message> = {
      add(message) {
        if (message.role === "assistant") controller.abort(reason);
        return Promise.resolve();
      },
      getMessages: () => Promise.resolve([]),
      clear: () => Promise.resolve(),
      getStats: () => Promise.resolve({ totalMessages: 0, estimatedTokens: 0, type: "test" }),
    };
    (runtime as unknown as { memory: Memory<Message> }).memory = memory;

    await assertRejects(
      () => runtime.generate("run", undefined, undefined, undefined, controller.signal),
      Error,
      reason.message,
    );
    assertEquals(toolCalls, 0);
  });

  it("does not start later tool calls after an earlier tool aborts the run", async () => {
    const controller = new AbortController();
    const reason = new Error("workflow cancelled");
    let secondToolCalls = 0;

    const firstTool = tool({
      id: "first_tool",
      description: "Abort the active run",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        controller.abort(reason);
        throw reason;
      },
    });
    const secondTool = tool({
      id: "second_tool",
      description: "Must not run after cancellation",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        secondToolCalls++;
        return { ok: true };
      },
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/generate-cancel-tools",
      async doGenerate() {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "first-1",
              toolName: "first_tool",
              input: "{}",
            },
            {
              type: "tool-call" as const,
              toolCallId: "second-1",
              toolName: "second_tool",
              input: "{}",
            },
          ],
          finishReason: "tool-calls" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const assistant = agent({
      model: "hosted/generate-cancel-tools",
      system: "Cancellation test",
      tools: { first_tool: firstTool, second_tool: secondTool },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    await assertRejects(
      () => assistant.generate({ input: "run", abortSignal: controller.signal }),
      Error,
      reason.message,
    );
    assertEquals(secondToolCalls, 0);
  });
});
