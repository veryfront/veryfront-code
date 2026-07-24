import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStreamState } from "./chat-stream-handler.ts";
import { createStreamLifecycleShadow } from "./stream-lifecycle-shadow.ts";

describe("stream lifecycle shadow", () => {
  it("reports only bounded divergence categories", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: ["create_file"],
      providerExecutedToolNames: [],
    });
    shadow.observePart({ type: "text-delta", text: "shadow secret" });
    const report = shadow.compareLegacySnapshot({
      ...createStreamState(),
      accumulatedText: "different secret",
    });
    assertEquals(report, { count: 1, categories: ["text"] });
    assertEquals(JSON.stringify(report).includes("secret"), false);
  });

  it("reports no divergence when legacy and shadow agree", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: ["create_file"],
      providerExecutedToolNames: [],
    });
    shadow.observePart({ type: "text-delta", text: "hello" });
    shadow.observePart({ type: "finish", finishReason: "stop" });
    const report = shadow.compareLegacySnapshot({
      ...createStreamState(),
      accumulatedText: "hello",
      finishReason: "stop",
    });
    assertEquals(report, { count: 0, categories: [] });
  });

  it("compares provider tool result semantics, not only IDs", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: ["web_search"],
      providerExecutedToolNames: ["web_search"],
    });
    shadow.observePart({
      type: "tool-input-start",
      id: "tool-1",
      toolName: "web_search",
    });
    shadow.observePart({
      type: "tool-input-available",
      id: "tool-1",
      toolName: "web_search",
      input: { query: "jobs" },
      providerExecuted: true,
    });
    shadow.observePart({
      type: "tool-result",
      toolCallId: "tool-1",
      toolName: "web_search",
      output: { count: 2, entries: ["a", "b"] },
      providerExecuted: true,
      preliminary: false,
    });

    assertEquals(
      shadow.compareLegacySnapshot({
        ...createStreamState(),
        toolCalls: new Map([[
          "tool-1",
          {
            id: "tool-1",
            name: "web_search",
            arguments: '{"query":"jobs"}',
            providerExecuted: true,
            inputAvailable: true,
          },
        ]]),
        toolResults: [{
          toolCallId: "tool-1",
          toolName: "web_search",
          output: { count: 2, entries: ["a", "b"] },
          providerExecuted: true,
          preliminary: false,
        }],
      }),
      { count: 0, categories: [] },
    );

    assertEquals(
      shadow.compareLegacySnapshot({
        ...createStreamState(),
        toolCalls: new Map([[
          "tool-1",
          {
            id: "tool-1",
            name: "web_search",
            arguments: '{"query":"jobs"}',
            providerExecuted: true,
            inputAvailable: true,
          },
        ]]),
        toolResults: [{
          toolCallId: "tool-1",
          toolName: "web_lookup",
          error: { count: 2, entries: ["a", "b"] },
          providerExecuted: true,
          preliminary: true,
        }],
      }),
      { count: 1, categories: ["tool_result"] },
    );
  });

  it("never reads from the provider", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: [],
      providerExecutedToolNames: [],
    });
    assertEquals("next" in shadow, false);
    assertEquals("open" in shadow, false);
  });
});
