import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type Tool, tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

it("suppresses an OpenAI streamed tool call dropped by provider tool conversion", async () => {
  const toolExecutions: Record<string, number> = {};
  const tools: Record<string, Tool> = Object.fromEntries(
    Array.from({ length: 150 }, (_, index) => {
      const id = `tool_${index}`;
      const definition = tool({
        id,
        description: `Tool ${index}`,
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => {
          toolExecutions[id] = (toolExecutions[id] ?? 0) + 1;
          return { ok: true, id };
        },
      });
      return [id, definition];
    }),
  );
  const model = scriptedModel([
    { toolCalls: [{ id: "dropped-tool-call", name: "tool_128", input: {} }] },
    { text: "Recovered without executing the dropped tool." },
  ], { provider: "openai", modelId: "veryfront-cloud/openai/gpt-5.2", only: "stream" });

  const assistant = agent({
    id: "openai-stream-tool-authority-agent",
    model: "veryfront-cloud/openai/gpt-5.2",
    system: "Use available tools only.",
    tools,
    maxSteps: 2,
    resolveModelTransport: async () => ({ model }),
  });

  const response = await assistant.stream({ input: "Call the dropped tool" });
  const streamBody = await response.toDataStreamResponse().text();

  assertEquals(model.callCount, 2);
  assertEquals(model.toolNames(0).length, 128);
  assertEquals(model.toolNames(0).includes("tool_127"), true);
  assertEquals(model.toolNames(0).includes("tool_128"), false);
  assertEquals(
    JSON.stringify(model.calls[1]?.prompt).includes("ignored unavailable tool call(s): tool_128"),
    true,
  );
  assertEquals(toolExecutions.tool_128 ?? 0, 0);
  assertEquals(streamBody.includes('"toolName":"tool_128"'), false);
});
