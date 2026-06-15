import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AppendConversationRunEventsError,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  parseAppendConversationRunEventsErrorBody,
} from "./durable-append-errors.ts";

describe("agent/durable-append-errors", () => {
  it("parses structured and plaintext append errors", () => {
    assertEquals(
      parseAppendConversationRunEventsErrorBody(
        JSON.stringify({ detail: "Cannot append external events to a terminal run" }),
      ),
      "Cannot append external events to a terminal run",
    );
    assertEquals(
      parseAppendConversationRunEventsErrorBody(JSON.stringify({ error: "append failed" })),
      "append failed",
    );
    assertEquals(parseAppendConversationRunEventsErrorBody("plain text"), "plain text");
    assertEquals(parseAppendConversationRunEventsErrorBody(""), null);
  });

  it("classifies ignorable and cursor-mismatch append failures", () => {
    const terminal = new AppendConversationRunEventsError({
      status: 400,
      detail: "Cannot append external events to a terminal run",
    });
    const waitingForTool = new AppendConversationRunEventsError({
      status: 400,
      detail: "Cannot append external events while the run is waiting for a tool result",
    });
    const missingRun = new AppendConversationRunEventsError({ status: 404 });
    const cursorMismatch = new AppendConversationRunEventsError({
      status: 400,
      detail: "External run event cursor mismatch",
    });
    const upstreamFailure = new AppendConversationRunEventsError({
      status: 500,
      detail: "internal failure",
    });

    assertEquals(isIgnorableConversationRunAppendError(terminal), true);
    assertEquals(isIgnorableConversationRunAppendError(waitingForTool), true);
    assertEquals(isIgnorableConversationRunAppendError(missingRun), true);
    assertEquals(isIgnorableConversationRunAppendError(cursorMismatch), false);
    assertEquals(isIgnorableConversationRunAppendError(upstreamFailure), false);
    assertEquals(isCursorMismatchConversationRunAppendError(cursorMismatch), true);
    assertEquals(isCursorMismatchConversationRunAppendError(terminal), false);
  });
});
