import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createConversationRunContext } from "./conversation-run-context.ts";

const RUN = {
  runId: "run_1",
  conversationId: "11111111-1111-4111-a111-111111111111",
  messageId: "22222222-2222-4222-a222-222222222222",
  latestEventId: 1,
  latestExternalEventSequence: 2,
  status: "running" as const,
};

describe("agent/conversation-run-context", () => {
  it("prefers durable run lineage when a run exists", () => {
    const publishParentRunEvents = async (_events: unknown[]) => undefined;
    assertEquals(
      createConversationRunContext({
        run: RUN,
        parentRunId: "parent-run",
        parentMessageId: "parent-message",
        publishParentRunEvents,
      }),
      {
        run: RUN,
        effectiveParentRunId: "run_1",
        effectiveParentMessageId: "22222222-2222-4222-a222-222222222222",
        publishParentRunEvents,
      },
    );
  });

  it("falls back to provided parent lineage when no run exists", () => {
    assertEquals(
      createConversationRunContext({
        run: null,
        parentRunId: "parent-run",
        parentMessageId: "parent-message",
      }),
      {
        run: null,
        effectiveParentRunId: "parent-run",
        effectiveParentMessageId: "parent-message",
        publishParentRunEvents: undefined,
      },
    );
  });
});
