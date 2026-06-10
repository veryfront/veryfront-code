import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { agent } from "../index.ts";
import type { MemoryConfig } from "../schemas/index.ts";
import { inspectAgent } from "./inspector.ts";

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
