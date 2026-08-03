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
        messages: [],
        tools: [],
      }),
      true,
    );

    for (
      const value of [
        [],
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT" },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: {} },
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT", messages: [], tools: {} },
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

  it("uses the registered VeryfrontError slug for persistence failures", () => {
    const error = new DurableRunEventPersistenceError("mirror unavailable");

    assertInstanceOf(error, DurableRunEventPersistenceError);
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "durable-run-event-persistence-failed");
    assertEquals(error.category, "AGENT");
    assertEquals(error.detail, "mirror unavailable");
  });
});
