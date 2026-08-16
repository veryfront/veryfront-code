import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DurableRunEventPersistenceError,
  isPrivateConversationRunEvent,
} from "./private-run-event.ts";

describe("agent/conversation/private-run-event", () => {
  it("recognizes only well-shaped private model-call context events", () => {
    assertEquals(
      isPrivateConversationRunEvent({
        type: "AGENT_RUN_MODEL_CALL_CONTEXT",
        messages: [],
      }),
      true,
    );
    assertEquals(
      isPrivateConversationRunEvent({
        type: "AGENT_RUN_MODEL_CALL_CONTEXT",
        model: { id: "veryfront-cloud/anthropic/claude-sonnet-4-6", modelProvider: "anthropic" },
        request: { maxOutputTokens: 4096, reasoning: { enabled: true, budgetTokens: 2048 } },
        messages: [],
        tools: [],
        elapsedMs: 42,
        emittedAt: 1_786_866_357_364,
      }),
      true,
    );

    for (
      const value of [
        [],
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT" },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: {} },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: [], tools: {} },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: [], model: { id: 1 } },
        {
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
          model: { id: "x", provider: "anthropic" },
        },
        {
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
          request: { reasoning: { arbitrary: true } },
        },
        {
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [{
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: undefined,
            }],
          }],
        },
        {
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [{
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "lookup",
              output: { type: "json", value: undefined },
            }],
          }],
        },
        {
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
          tools: [{
            type: "function",
            name: "lookup",
            inputSchema: undefined,
          }],
        },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: [], emittedAt: 1.5 },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: [], contextId: "legacy" },
        { type: "TEXT_MESSAGE_CONTENT", messages: [] },
      ]
    ) {
      assertEquals(isPrivateConversationRunEvent(value), false);
    }
  });

  it("does not invoke accessors while checking private event shape", () => {
    let reads = 0;
    const event = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
    };
    Object.defineProperty(event, "tools", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });

    assertEquals(isPrivateConversationRunEvent(event), false);
    assertEquals(reads, 0);
  });

  it("requires reasoning effort to be a literal allowed string", () => {
    let coercions = 0;
    const effort = {
      toString() {
        coercions += 1;
        return "high";
      },
    };

    assertEquals(
      isPrivateConversationRunEvent({
        type: "AGENT_RUN_MODEL_CALL_CONTEXT",
        messages: [],
        request: { reasoning: { effort } },
      }),
      false,
    );
    assertEquals(coercions, 0);
  });

  it("uses the registered VeryfrontError slug for persistence failures", () => {
    const error = new DurableRunEventPersistenceError("mirror unavailable");

    assertInstanceOf(error, DurableRunEventPersistenceError);
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "durable-run-event-persistence-failed");
    assertEquals(error.category, "AGENT");
    assertEquals(error.detail, "mirror unavailable");
  });
});
