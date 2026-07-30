import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAnthropicModelRuntime } from "./anthropic-provider.ts";

describe("ext-llm-anthropic/native-tool-search", () => {
  it("normalizes server search blocks losslessly without a client tool call", async () => {
    const runtime = createAnthropicModelRuntime({
      apiKey: "test",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [
                {
                  type: "server_tool_use",
                  id: "srvtoolu_search_1",
                  name: "tool_search_tool_regex",
                  input: { query: "release" },
                  caller: { type: "direct" },
                },
                {
                  type: "tool_search_tool_result",
                  tool_use_id: "srvtoolu_search_1",
                  content: {
                    type: "tool_search_tool_result_error",
                    error_code: "invalid_pattern",
                  },
                  provider_trace: { region: "test" },
                },
              ],
              stop_reason: "end_turn",
              usage: { input_tokens: 2, output_tokens: 3 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    }, "claude-opus-4-6");

    const result = await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Find a tool" }] }],
    });

    assertEquals(result.content, [
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "server_tool_use",
          id: "srvtoolu_search_1",
          name: "tool_search_tool_regex",
          input: { query: "release" },
          caller: { type: "direct" },
        },
      },
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "tool_search_tool_result",
          tool_use_id: "srvtoolu_search_1",
          content: {
            type: "tool_search_tool_result_error",
            error_code: "invalid_pattern",
          },
          provider_trace: { region: "test" },
        },
      },
    ]);
  });
});
