import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ModelRuntime } from "#veryfront/provider";
import type { RuntimeGenerateTextResult } from "../runtime/runtime-tool-types.ts";
import { createVeryfrontCloudContextSummaryGenerator } from "./context-summary-generator.ts";

function createModel(): ModelRuntime {
  return {
    provider: "test",
    modelId: "test-model",
    doGenerate: () => Promise.resolve({ content: [] }),
    doStream: () => Promise.resolve({ stream: new ReadableStream<unknown>() }),
  };
}

Deno.test("createVeryfrontCloudContextSummaryGenerator rolls oversized history through bounded summaries", async () => {
  const prompts: string[] = [];
  const generator = createVeryfrontCloudContextSummaryGenerator({
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    projectId: "project-1",
    model: "openai/gpt-5.2",
    maxOutputTokens: 500,
    maxInputTokens: 40,
    resolveModel: (modelId) => {
      assertEquals(modelId, "veryfront-cloud/openai/gpt-5.2");
      return createModel();
    },
    generateText: (options): PromiseLike<RuntimeGenerateTextResult> => {
      const message = options.messages.find((candidate) => candidate.role === "user");
      prompts.push(typeof message?.content === "string" ? message.content : "");
      return Promise.resolve({
        text: `summary-${prompts.length}`,
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "stop",
      });
    },
  });

  const result = await generator({
    messagesToSummarize: [
      {
        id: "message-1",
        role: "user",
        timestamp: 1,
        parts: [{ type: "text", text: "First older request ".repeat(20) }],
      },
      {
        id: "message-2",
        role: "assistant",
        timestamp: 2,
        parts: [{ type: "text", text: "First older response ".repeat(20) }],
      },
      {
        id: "message-3",
        role: "user",
        timestamp: 3,
        parts: [{ type: "text", text: "Second older request ".repeat(20) }],
      },
    ],
    retainedMessages: [
      {
        id: "message-4",
        role: "user",
        timestamp: 4,
        parts: [{ type: "text", text: "Latest request" }],
      },
    ],
    customInstructions: "Keep project constraints.",
  });

  assertEquals(result, { text: "summary-3" });
  assertEquals(prompts.length, 3);
  assertEquals(prompts[1]?.includes("Existing summary to update:\nsummary-1"), true);
  assertEquals(prompts[2]?.includes("Existing summary to update:\nsummary-2"), true);
  assertEquals(prompts[0]?.includes("Keep project constraints."), true);
});
