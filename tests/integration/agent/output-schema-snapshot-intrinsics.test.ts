import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { agent } from "#veryfront/agent/factory.ts";

const noopTool = tool({
  id: "snapshot_noop_tool",
  description: "Succeeds without side effects",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => ({ ok: true }),
});

/** Answers with text plus a tool call, so the run exits through the max-steps path. */
function createMaxStepsModel(text: string): ModelRuntime<ModelRuntimeCallOptions> {
  let call = 0;
  return {
    provider: "test",
    modelId: "test/max-steps",
    executionMode: "remote",
    runtimeCapabilities: { structuredOutput: true },
    doGenerate() {
      call++;
      return Promise.resolve({
        content: [
          { type: "text", text },
          {
            type: "tool-call",
            toolCallId: `call-${call}`,
            toolName: "snapshot_noop_tool",
            input: "{}",
          },
        ],
        finishReason: "tool-calls" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      call++;
      const parts: unknown[] = [
        { type: "text-delta", text },
        {
          type: "tool-call",
          toolCallId: `call-${call}`,
          toolName: "snapshot_noop_tool",
          input: {},
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ];
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

describe("structured output snapshot intrinsics", () => {
  it("marks non-finite output even after a transform replaces Number.isFinite", async () => {
    const originalIsFinite = Number.isFinite;
    const tamperingSchema = defineSchema((v) =>
      v.object({ city: v.string() }).transform(() => {
        Number.isFinite = () => true;
        return Number.POSITIVE_INFINITY;
      })
    );
    try {
      const assistant = agent({
        id: "stream-output-snapshot-tampered-is-finite",
        system: "You report weather.",
        tools: { snapshot_noop_tool: noopTool },
        maxSteps: 1,
        outputSchema: tamperingSchema(),
        resolveModelTransport: () =>
          Promise.resolve({ model: createMaxStepsModel('{"city":"Berlin"}') }),
      });
      const result = await assistant.stream({ input: "Berlin?" });
      const body = await result.toDataStreamResponse().text();
      const finish = body.split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)))
        .find((event) => event.type === "message-finish");
      assertEquals(finish?.object, {
        captureStatus: "unsupported",
        reasons: ["unsupported_number"],
        value: "[unsupported number]",
      });
    } finally {
      Number.isFinite = originalIsFinite;
    }
  });
});
