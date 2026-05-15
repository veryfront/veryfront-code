import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DurableRunCanaryRunSummary } from "./runner.ts";
import {
  assertCompleted,
  collectAssistantText,
  findAssistantMessage,
  stringifyUnknown,
} from "./validation.ts";

function createRunSummary(
  overrides: Partial<DurableRunCanaryRunSummary> = {},
): DurableRunCanaryRunSummary {
  return {
    runId: "run_1",
    conversationId: "11111111-1111-4111-a111-111111111111",
    messageId: "22222222-2222-4222-a222-222222222222",
    agentId: "agent-a",
    status: "completed",
    latestEventId: 1,
    latestExternalEventSequence: null,
    waitingToolCallId: null,
    waitingToolName: null,
    terminalErrorCode: null,
    terminalErrorMessage: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("agent testing durable run canary validation", () => {
  it("assertCompleted accepts completed runs and rejects non-completed runs", () => {
    assertCompleted(createRunSummary());

    assertThrows(
      () =>
        assertCompleted(
          createRunSummary({
            runId: "run_2",
            status: "failed",
            terminalErrorCode: "BROKEN",
            terminalErrorMessage: "oops",
          }),
        ),
      Error,
      "Expected completed run",
    );
  });

  it("findAssistantMessage and collectAssistantText enforce assistant role and text extraction", () => {
    const assistantMessage = findAssistantMessage(
      [
        {
          id: "m1",
          role: "assistant",
          status: "completed",
          parts: [
            { type: "text", text: "hello" },
            { type: "text", text: "world" },
          ],
        },
      ],
      "m1",
    );

    assertEquals(collectAssistantText(assistantMessage), "hello\nworld");
    assertThrows(
      () =>
        findAssistantMessage([{ id: "m2", role: "tool", status: "completed", parts: [] }], "m2"),
      Error,
      "Expected assistant message",
    );
  });

  it("stringifyUnknown serializes objects and passes strings through", () => {
    assertEquals(stringifyUnknown("hello"), "hello");
    assertEquals(stringifyUnknown({ ok: true }), '{"ok":true}');
  });
});
