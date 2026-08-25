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

    const legacyToolCalls = () =>
      new Map([[
        "tool-1",
        {
          id: "tool-1",
          name: "web_search",
          arguments: '{"query":"jobs"}',
          providerExecuted: true,
          inputAvailable: true,
        },
      ]]);

    assertEquals(
      shadow.compareLegacySnapshot({
        ...createStreamState(),
        toolCalls: legacyToolCalls(),
        toolResults: [{
          toolCallId: "tool-1",
          toolName: "web_search",
          output: { count: 2, entries: ["a", "b"] },
          providerExecuted: true,
          preliminary: true,
        }],
      }),
      { count: 1, categories: ["tool_result"] },
      "preliminary divergence must be reported on its own",
    );

    assertEquals(
      shadow.compareLegacySnapshot({
        ...createStreamState(),
        toolCalls: legacyToolCalls(),
        toolResults: [{
          toolCallId: "tool-1",
          toolName: "web_search",
          error: { count: 2, entries: ["a", "b"] },
          providerExecuted: true,
          preliminary: false,
        }],
      }),
      { count: 1, categories: ["tool_result"] },
      "error-instead-of-output divergence must be reported on its own",
    );

    assertEquals(
      shadow.compareLegacySnapshot({
        ...createStreamState(),
        toolCalls: legacyToolCalls(),
        toolResults: [{
          toolCallId: "tool-1",
          toolName: "web_search",
          output: { count: 2, entries: ["a", "b"] },
          providerExecuted: true,
          preliminary: false,
          dynamic: true,
        }],
      }),
      { count: 1, categories: ["tool_result"] },
      "dynamic divergence must be reported on its own",
    );
  });

  it("reports a decoder crash as shadow_error instead of claiming agreement", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: [],
      providerExecutedToolNames: [],
    });
    shadow.observePart({
      type: "text-delta",
      get text(): string {
        throw new Error("decoder crash");
      },
    });
    const report = shadow.compareLegacySnapshot(createStreamState());
    assertEquals(
      report.categories.includes("shadow_error"),
      true,
      "a decoder crash must be reported as shadow_error",
    );
    assertEquals(report.count >= 1, true, "a crashed shadow must never report zero divergence");
  });

  it("reports tool input divergence", () => {
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
    const report = shadow.compareLegacySnapshot({
      ...createStreamState(),
      toolCalls: new Map([[
        "tool-1",
        {
          id: "tool-1",
          name: "web_search",
          arguments: '{"query":"cats"}',
          providerExecuted: true,
          inputAvailable: true,
        },
      ]]),
    });
    assertEquals(
      report.categories.includes("tool_input"),
      true,
      "differing tool arguments must be reported as tool_input",
    );
    assertEquals(
      JSON.stringify(report).includes("cats"),
      false,
      "reports must not leak input text",
    );
  });

  it("reports reasoning divergence", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: [],
      providerExecutedToolNames: [],
    });
    shadow.observePart({ type: "reasoning-start", id: "r-1" });
    shadow.observePart({ type: "reasoning-delta", id: "r-1", delta: "shadow secret" });
    const report = shadow.compareLegacySnapshot({
      ...createStreamState(),
      reasoningParts: [{ id: "r-1", text: "different secret" }],
    });
    assertEquals(
      report.categories.includes("reasoning"),
      true,
      "differing reasoning text must be reported as reasoning",
    );
    assertEquals(
      JSON.stringify(report).includes("secret"),
      false,
      "reports must not leak reasoning text",
    );
    assertEquals(
      shadow.compareLegacySnapshot({
        ...createStreamState(),
        reasoningParts: [{ id: "r-1", text: "shadow secret" }],
      }),
      { count: 0, categories: [] },
      "matching reasoning text must not be reported",
    );
  });

  it("detects divergence in cost and charge usage fields", () => {
    const shadow = createStreamLifecycleShadow({
      availableToolNames: [],
      providerExecutedToolNames: [],
    });
    shadow.observePart({
      type: "finish",
      finishReason: "stop",
      totalUsage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        providerCostUsd: 0.5,
        veryfrontChargeUsd: 0.6,
      },
    });
    const agreeing = shadow.compareLegacySnapshot({
      ...createStreamState(),
      finishReason: "stop",
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        providerCostUsd: 0.5,
        veryfrontChargeUsd: 0.6,
      },
    });
    assertEquals(agreeing, { count: 0, categories: [] });

    const diverging = shadow.compareLegacySnapshot({
      ...createStreamState(),
      finishReason: "stop",
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        providerCostUsd: 0.75,
        veryfrontChargeUsd: 0.6,
      },
    });
    assertEquals(diverging, { count: 1, categories: ["usage"] });
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
