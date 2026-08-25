import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { agent } from "../index.ts";
import type { MemoryConfig } from "../schemas/index.ts";
import { inspectAgent } from "./inspector.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";

function stubModel(modelId: string): ModelRuntime {
  return {
    provider: "hosted",
    modelId,
    doGenerate() {
      return Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "finish", finishReason: "stop" });
            controller.close();
          },
        }),
      });
    },
  } as ModelRuntime;
}

function inspectableAgent(id: string, memory?: MemoryConfig) {
  return agent({
    id,
    model: `hosted/${id}`,
    system: "test",
    maxSteps: 1,
    ...(memory ? { memory } : {}),
    resolveModelTransport: () => Promise.resolve({ model: stubModel(`hosted/${id}`) }),
  });
}

describe("inspectAgent memoryType reporting", () => {
  it("reports 'none' for a stateless (unconfigured) agent", async () => {
    const report = await inspectAgent(inspectableAgent("inspect-stateless"), "hi");
    assertEquals(report.agent.memoryType, "none");
  });

  it("reports 'none' when memory is explicitly disabled", async () => {
    const report = await inspectAgent(
      inspectableAgent("inspect-disabled", { type: "conversation", enabled: false }),
      "hi",
    );
    assertEquals(report.agent.memoryType, "none");
  });

  it("reports the configured store type for a stateful agent", async () => {
    const report = await inspectAgent(
      inspectableAgent("inspect-buffer", { type: "buffer", maxMessages: 10 }),
      "hi",
    );
    assertEquals(report.agent.memoryType, "buffer");
  });
});

describe("inspectAgent report body", () => {
  it("carries the execution, tool and memory sections of the report", async () => {
    const inspected = inspectableAgent("inspect-report-body", {
      type: "buffer",
      maxMessages: 10,
    });
    const report = await inspectAgent(inspected, "hi");

    assertEquals(report.execution.output, "ok", "the report carries the agent's generated text");
    assertEquals(report.execution.status, "completed", "the report carries the run status");
    assertEquals(report.execution.steps, 1, "a response with no tool calls is one step");
    assertEquals(report.agent.maxSteps, 1, "the report carries the configured step budget");
    assertEquals(report.tools.called, [], "a run without tool calls reports none");
    assertEquals(
      report.memory.messagesCount,
      2,
      "the buffer store holds the prompt and the reply after one turn",
    );
    assertEquals(report.usage, {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    }, "the report carries the model's reported token usage");
  });

  it("lists the agent's configured tools", async () => {
    const echo = tool({
      id: "inspector_echo",
      description: "Echo the input back",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => "echoed",
    });
    const inspected = agent({
      id: "inspect-with-tools",
      model: "hosted/inspect-with-tools",
      system: "test",
      maxSteps: 1,
      tools: { inspector_echo: echo },
      resolveModelTransport: () =>
        Promise.resolve({ model: stubModel("hosted/inspect-with-tools") }),
    });

    const report = await inspectAgent(inspected, "hi");

    assertEquals(
      report.tools.available,
      ["inspector_echo"],
      "the report lists the agent's configured tools",
    );
  });
});
