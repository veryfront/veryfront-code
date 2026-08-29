import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AppendConversationRunEventsError,
  isCursorMismatchConversationRunAppendError,
  isIgnorableConversationRunAppendError,
  isPayloadTooLargeConversationRunAppendError,
  isTerminalRunConversationRunAppendError,
  parseAppendConversationRunEventsError,
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
    assertEquals(
      parseAppendConversationRunEventsError(
        JSON.stringify({
          detail: "Run not found",
          slug: "resource-not-found",
        }),
      ),
      {
        detail: "Run not found",
        slug: "resource-not-found",
      },
    );
    assertEquals(
      parseAppendConversationRunEventsError(JSON.stringify({ error: "resource-not-found" })),
      {
        detail: "resource-not-found",
        slug: "resource-not-found",
      },
    );
    assertEquals(
      parseAppendConversationRunEventsError(JSON.stringify({ detail: "resource-not-found" })),
      {
        detail: "resource-not-found",
        slug: null,
      },
      "a human detail must never become a machine slug",
    );
    assertEquals(
      parseAppendConversationRunEventsError(JSON.stringify({ detail: "Run not found" })),
      {
        detail: "Run not found",
        slug: null,
      },
      "a detail-only body carries no slug",
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

  // veryfront-issue-inbox#757: the api registers a distinct slug for the
  // terminal-run rejection, so the runtime prefers it over the English detail --
  // the string stays as a fallback for api versions that still emit only
  // `validation-failed`.
  it("prefers the terminal-run rejection slug over the detail wording", () => {
    const sluggedTerminal = new AppendConversationRunEventsError({
      status: 400,
      detail: "This run is terminal (message reworded by a future api release)",
      slug: "terminal-run-append-rejected",
    });
    const rewordedWithoutSlug = new AppendConversationRunEventsError({
      status: 400,
      detail: "This run is terminal (message reworded by a future api release)",
      slug: "validation-failed",
    });

    assertEquals(isTerminalRunConversationRunAppendError(sluggedTerminal), true);
    assertEquals(isIgnorableConversationRunAppendError(sluggedTerminal), true);
    // Without the distinct slug, a reworded message must miss (noisy retries),
    // never misfire into the terminal branch.
    assertEquals(isTerminalRunConversationRunAppendError(rewordedWithoutSlug), false);
    assertEquals(isIgnorableConversationRunAppendError(rewordedWithoutSlug), false);
  });

  // veryfront-issue-inbox#743: a terminal-run rejection means the run is already
  // finished server-side, so the runtime must stop cleanly instead of completing a
  // run that no longer accepts a terminal transition. Every other rejection --
  // including the other `validation-failed` details -- must stay outside this branch.
  it("classifies only the terminal-run rejection as an already-terminal run", () => {
    const terminal = new AppendConversationRunEventsError({
      status: 400,
      detail: "Cannot append external events to a terminal run",
    });
    const deletedRun = new AppendConversationRunEventsError({
      status: 404,
      detail: "Run not found",
      slug: "resource-not-found",
    });
    const humanDetailCollision = new AppendConversationRunEventsError({
      status: 404,
      detail: "resource-not-found",
    });
    const waitingForTool = new AppendConversationRunEventsError({
      status: 400,
      detail: "Cannot append external events while the run is waiting for a tool result",
    });
    const missingRun = new AppendConversationRunEventsError({ status: 404 });
    const otherMissingResource = new AppendConversationRunEventsError({
      status: 404,
      detail: "conversation-not-found",
      slug: "conversation-not-found",
    });
    const similarMissingResource = new AppendConversationRunEventsError({
      status: 404,
      detail: "run-resource-not-found",
      slug: "run-resource-not-found",
    });
    const cursorMismatch = new AppendConversationRunEventsError({
      status: 400,
      detail: "External run event cursor mismatch",
    });
    const oversized = new AppendConversationRunEventsError({
      status: 400,
      detail: "Agent run event payload must be less than 256 KB",
    });
    const otherValidationFailure = new AppendConversationRunEventsError({
      status: 400,
      detail: "Agent run event type is not supported",
    });

    assertEquals(isTerminalRunConversationRunAppendError(terminal), true);
    assertEquals(isTerminalRunConversationRunAppendError(deletedRun), true);
    assertEquals(isTerminalRunConversationRunAppendError(humanDetailCollision), false);
    assertEquals(isTerminalRunConversationRunAppendError(waitingForTool), false);
    assertEquals(isTerminalRunConversationRunAppendError(missingRun), false);
    assertEquals(isTerminalRunConversationRunAppendError(otherMissingResource), false);
    assertEquals(isTerminalRunConversationRunAppendError(similarMissingResource), false);
    assertEquals(isTerminalRunConversationRunAppendError(cursorMismatch), false);
    assertEquals(isTerminalRunConversationRunAppendError(oversized), false);
    assertEquals(isTerminalRunConversationRunAppendError(otherValidationFailure), false);
    assertEquals(
      isTerminalRunConversationRunAppendError(
        Object.assign(new Error("resource-not-found"), {
          status: 404,
          detail: "resource-not-found",
          slug: "resource-not-found",
        }),
      ),
      false,
    );
    assertEquals(isTerminalRunConversationRunAppendError(new Error("terminal run")), false);
  });

  it("classifies oversized payload append failures as permanent", () => {
    const oversizedEvent = new AppendConversationRunEventsError({
      status: 400,
      detail: "Agent run event payload must be less than 256 KB",
    });
    const oversizedSnapshot = new AppendConversationRunEventsError({
      status: 400,
      detail: "Agent run request snapshot payload must be less than 2 MB",
    });
    const cursorMismatch = new AppendConversationRunEventsError({
      status: 400,
      detail: "External run event cursor mismatch",
    });
    const upstreamFailure = new AppendConversationRunEventsError({
      status: 500,
      detail: "internal failure",
    });

    assertEquals(isPayloadTooLargeConversationRunAppendError(oversizedEvent), true);
    assertEquals(isPayloadTooLargeConversationRunAppendError(oversizedSnapshot), true);
    assertEquals(isPayloadTooLargeConversationRunAppendError(cursorMismatch), false);
    assertEquals(isPayloadTooLargeConversationRunAppendError(upstreamFailure), false);
    // A permanent oversize rejection must NOT be retried as a transient failure.
    assertEquals(isIgnorableConversationRunAppendError(oversizedEvent), false);
  });
});
