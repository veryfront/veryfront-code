import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";

describe("agent runtime invalid tool calls in generate mode", () => {
  it("records a terminal validation error without executing the tool", async () => {
    let executions = 0;
    let modelCalls = 0;
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
      modelId: "hosted/invalid-tool-generate",
      async doGenerate() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "invalid-tool-1",
              toolName: "dangerous_tool",
              input: "not-json",
            }],
            finishReason: "tool-calls",
          };
        }

        return {
          content: [{ type: "text", text: "The tool input was invalid." }],
          finishReason: "stop",
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const assistant = agent({
      model: "hosted/invalid-tool-generate",
      system: "Validate every tool call.",
      tools: { dangerous_tool: dangerousTool },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({ input: "Use the tool" });

    assertEquals(modelCalls, 2);
    assertEquals(executions, 0);
    assertEquals(result.toolCalls[0]?.status, "error");
    assertStringIncludes(result.toolCalls[0]?.error ?? "", "Invalid input for tool dangerous_tool");
    assertEquals(result.text, "The tool input was invalid.");
  });
});
