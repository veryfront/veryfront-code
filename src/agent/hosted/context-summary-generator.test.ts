import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { getCurrentVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
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
  const projectSlugs: Array<string | undefined> = [];
  const generator = createVeryfrontCloudContextSummaryGenerator({
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    projectSlug: "demo-project",
    model: "openai/gpt-5.2",
    maxOutputTokens: 500,
    maxInputTokens: 40,
    resolveModel: (modelId) => {
      assertEquals(modelId, "veryfront-cloud/openai/gpt-5.2");
      return createModel();
    },
    generateText: (options): PromiseLike<RuntimeGenerateTextResult> => {
      projectSlugs.push(getCurrentVeryfrontCloudContext()?.projectSlug);
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
  assertEquals(projectSlugs, ["demo-project", "demo-project", "demo-project"]);
});

Deno.test("createVeryfrontCloudContextSummaryGenerator redacts sensitive tool data before summarization", async () => {
  let prompt = "";
  const generator = createVeryfrontCloudContextSummaryGenerator({
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    model: "openai/gpt-5.2",
    maxOutputTokens: 500,
    maxInputTokens: 1_000,
    resolveModel: () => createModel(),
    generateText: (options): PromiseLike<RuntimeGenerateTextResult> => {
      const message = options.messages.find((candidate) => candidate.role === "user");
      prompt = typeof message?.content === "string" ? message.content : "";
      return Promise.resolve({
        text: "safe summary",
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "stop",
      });
    },
  });

  await generator({
    messagesToSummarize: [
      {
        id: "message-1",
        role: "assistant",
        timestamp: 1,
        parts: [
          {
            type: "tool-call",
            toolName: "call_api",
            toolCallId: "tool-1",
            args: {
              authorization: "Bearer secret-token",
              query: "status",
              url: "https://api.example.test/path?access_token=query-secret",
            },
          },
          {
            type: "tool-result",
            toolName: "call_api",
            toolCallId: "tool-1",
            result: {
              ok: true,
              access_token: "secret-access-token",
              output: "Fetched postgres://user:password@db.example.test:5432/app",
            },
          },
        ],
      },
    ],
    retainedMessages: [],
  });

  assertEquals(prompt.includes("secret-token"), false);
  assertEquals(prompt.includes("secret-access-token"), false);
  assertEquals(prompt.includes("query-secret"), false);
  assertEquals(prompt.includes("password"), false);
  assertEquals(prompt.includes("[REDACTED]"), true);
  assertEquals(prompt.includes("access_token=[REDACTED]"), true);
  assertEquals(prompt.includes("postgres://user:[REDACTED]@db.example.test:5432/app"), true);
  assertEquals(prompt.includes('"query":"status"'), true);
});
