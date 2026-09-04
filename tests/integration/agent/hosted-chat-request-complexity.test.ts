// This complexity regression intentionally observes a shared-realm prototype,
// so it belongs in the integration suite rather than a unit module.
import "#veryfront/schemas/_test-setup.ts";
import { hostedChatRequestSchema, MAX_HOSTED_CHAT_REQUEST_MESSAGE_PARTS } from "#veryfront/agent";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const conversationId = "10000000-1000-4000-8000-100000000001";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";
const replayToolName = "github__get_pr_diff";

describe("hosted chat replay validation complexity", () => {
  it("marks each open tool call once when many text parts follow", () => {
    const callCount = MAX_HOSTED_CHAT_REQUEST_MESSAGE_PARTS / 2;
    const calls = Array.from({ length: callCount }, (_, index) => ({
      type: "tool_call",
      id: `tool-call-${index}`,
      name: replayToolName,
      input: { pullNumber: 3077 },
      state: "completed",
    }));
    const textParts = Array.from(
      { length: callCount },
      () => ({ type: "text", text: "continued" }),
    );
    const originalSet = Map.prototype.set;
    let openCallWrites = 0;

    try {
      Map.prototype.set = function (key: unknown, value: unknown): Map<unknown, unknown> {
        if (
          value !== null && typeof value === "object" &&
          "sawLaterNonResultContent" in value
        ) {
          openCallWrites += 1;
        }
        return Reflect.apply(originalSet, this, [key, value]) as Map<unknown, unknown>;
      };

      const parsed = hostedChatRequestSchema.safeParse({
        messages: [{
          id: "assistant-message-1",
          role: "assistant",
          parts: [...calls, ...textParts],
        }],
        context: { conversationId, projectId, branchId },
      });
      assertEquals(parsed.success, false);
    } finally {
      Map.prototype.set = originalSet;
    }

    assertEquals(openCallWrites, callCount * 2);
  });
});
