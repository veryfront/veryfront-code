import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type Tool, tool } from "#veryfront/tool";
import { agent } from "../index.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function getRuntimeToolNames(options: unknown): string[] {
  const rawTools = (options as { tools?: unknown }).tools;
  return Array.isArray(rawTools)
    ? rawTools.map((entry) =>
      (entry as { name?: string; id?: string }).name ??
        (entry as { name?: string; id?: string }).id ?? ""
    )
    : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
}

it("suppresses an OpenAI streamed tool call dropped by provider tool conversion", async () => {
  const toolExecutions: Record<string, number> = {};
  const runtimeToolNamesByStep: string[][] = [];
  const promptsByStep: unknown[] = [];
  let streamCalls = 0;
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
  const model: ModelRuntime = {
    provider: "openai",
    modelId: "veryfront-cloud/openai/gpt-5.2",
    async doGenerate() {
      return {
        content: [{ type: "text", text: "unused" }],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
    async doStream(options) {
      streamCalls++;
      runtimeToolNamesByStep.push(getRuntimeToolNames(options));
      promptsByStep.push((options as { prompt?: unknown }).prompt);

      if (streamCalls === 1) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "dropped-tool-call",
              toolName: "tool_128",
              input: {},
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      }

      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "Recovered without executing the dropped tool." },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ]),
      };
    },
  };

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

  assertEquals(streamCalls, 2);
  assertEquals(runtimeToolNamesByStep[0]?.length, 128);
  assertEquals(runtimeToolNamesByStep[0]?.includes("tool_127"), true);
  assertEquals(runtimeToolNamesByStep[0]?.includes("tool_128"), false);
  assertEquals(
    JSON.stringify(promptsByStep[1]).includes("ignored unavailable tool call(s): tool_128"),
    true,
  );
  assertEquals(toolExecutions.tool_128 ?? 0, 0);
  assertEquals(streamBody.includes('"toolName":"tool_128"'), false);
});
