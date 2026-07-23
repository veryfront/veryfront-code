import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";

describe("agent runtime invalid tool calls in stream mode", () => {
  it("emits a terminal tool error without executing the tool", async () => {
    let executions = 0;
    const dangerousTool = tool({
      id: "dangerous_tool",
      description: "Must only execute with validated input",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: () => {
        executions += 1;
        return { executed: true };
      },
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/invalid-tool-stream",
      async doGenerate() {
        throw new Error("not used");
      },
      async doStream() {
        return {
          stream: ReadableStream.from([
            {
              type: "tool-call",
              toolCallId: "invalid-tool-stream-1",
              toolName: "dangerous_tool",
              input: "not-json",
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };
    const assistant = agent({
      model: "hosted/invalid-tool-stream",
      system: "Validate every tool call.",
      tools: { dangerous_tool: dangerousTool },
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({ input: "Use the tool" })).toDataStreamResponse();
    const streamBody = await response.text();

    assertEquals(executions, 0);
    assertStringIncludes(streamBody, '"type":"tool-output-error"');
    assertStringIncludes(streamBody, "Invalid input for tool dangerous_tool");
    assertEquals(streamBody.includes('"type":"tool-output-available"'), false);
  });
});
