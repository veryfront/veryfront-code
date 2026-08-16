import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  AgentRunModelCallContextEvent,
  ModelCallMessage,
  ModelCallTool,
} from "./model-call-context.ts";
import { createTimedAgentRunEventSink } from "./model-call-context.ts";

describe("model-call-context", () => {
  it("describes only the direct provider-agnostic event", () => {
    const messages: ModelCallMessage[] = [{
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "search",
        input: { query: "Veryfront" },
      }],
    }];
    const tools: ModelCallTool[] = [{
      type: "provider",
      name: "web_search",
      id: "anthropic.web_search_20250305",
      args: { maxUses: 3 },
    }];
    const event: AgentRunModelCallContextEvent = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      model: { id: "anthropic/claude-sonnet-4-6", modelProvider: "anthropic" },
      request: { maxOutputTokens: 4096, reasoning: { enabled: true, budgetTokens: 2048 } },
      messages,
      tools,
    };
    assertEquals(event, {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      model: { id: "anthropic/claude-sonnet-4-6", modelProvider: "anthropic" },
      request: { maxOutputTokens: 4096, reasoning: { enabled: true, budgetTokens: 2048 } },
      messages,
      tools,
    });

    const eventWithExtraField: AgentRunModelCallContextEvent = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages,
      // @ts-expect-error model-call context events do not accept chunk metadata
      contextId: "context-1",
    };
    assertEquals(eventWithExtraField.type, "AGENT_RUN_MODEL_CALL_CONTEXT");

    const providerPrivateReasoning: ModelCallMessage = {
      role: "assistant",
      content: [
        // @ts-expect-error signed provider reasoning is not part of ModelCallMessage
        { type: "reasoning", text: "private", signature: "signed" },
      ],
    };
    assertEquals(providerPrivateReasoning.role, "assistant");
  });

  it("rounds generated timing and preserves valid producer timing", () => {
    const events: AgentRunModelCallContextEvent[] = [];
    let now = 100;
    const sink = createTimedAgentRunEventSink(
      (event) => {
        events.push(event);
      },
      { nowMs: () => now, epochMs: () => 1_786_866_357_364.4, startedMs: 100 },
    );
    now = 142.6;
    sink({ type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: [] });
    sink({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
      elapsedMs: 7,
      emittedAt: 8,
    });
    sink({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
      elapsedMs: -1,
      emittedAt: 1.5,
    });
    assertEquals(events.map(({ elapsedMs, emittedAt }) => ({ elapsedMs, emittedAt })), [
      { elapsedMs: 43, emittedAt: 1_786_866_357_364 },
      { elapsedMs: 7, emittedAt: 8 },
      { elapsedMs: 43, emittedAt: 1_786_866_357_364 },
    ]);
  });
});
