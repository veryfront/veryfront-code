import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createOpenAIResponsesRuntime } from "./openai-provider.ts";

describe("ext-llm-openai/native-tool-search", () => {
  it("normalizes search call/output blocks and cache-write usage", async () => {
    const runtime = createOpenAIResponsesRuntime({
      apiKey: "test",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              output: [
                {
                  type: "tool_search_call",
                  execution: "server",
                  call_id: null,
                  status: "completed",
                  arguments: { goal: "Find release tools" },
                  provider_trace: { shard: "a" },
                },
                {
                  type: "tool_search_output",
                  execution: "server",
                  call_id: null,
                  status: "completed",
                  tools: [{
                    type: "function",
                    name: "get_release",
                    defer_loading: true,
                    parameters: { type: "object" },
                  }],
                  provider_trace: { shard: "b" },
                },
              ],
              status: "completed",
              usage: {
                input_tokens: 10,
                output_tokens: 2,
                input_tokens_details: {
                  cached_tokens: 3,
                  cache_write_tokens: 4,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "gpt-5.4");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Find a tool" }] }],
    });

    assertEquals(result.content, [
      {
        type: "provider-block",
        provider: "openai-responses",
        block: {
          type: "tool_search_call",
          execution: "server",
          call_id: null,
          status: "completed",
          arguments: { goal: "Find release tools" },
          provider_trace: { shard: "a" },
        },
      },
      {
        type: "provider-block",
        provider: "openai-responses",
        block: {
          type: "tool_search_output",
          execution: "server",
          call_id: null,
          status: "completed",
          tools: [{
            type: "function",
            name: "get_release",
            defer_loading: true,
            parameters: { type: "object" },
          }],
          provider_trace: { shard: "b" },
        },
      },
    ]);
    assertEquals(result.usage, {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 4,
    });
  });
});
