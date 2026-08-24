import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findProviderVisibleToolReplayMatches,
  isTransientToolState,
} from "./tool-replay-reconciliation.ts";
import type {
  ChatProviderModelInputMessage,
  ChatProviderModelInputPart,
} from "./provider-input-types.ts";

function assistantMessage(
  parts: ChatProviderModelInputPart[],
  id = "assistant-1",
): ChatProviderModelInputMessage {
  return { id, role: "assistant", parts };
}

function toolMessage(
  parts: ChatProviderModelInputPart[],
  id = "assistant-1:tool",
): ChatProviderModelInputMessage {
  return { id, role: "tool", parts };
}

function userMessage(text: string, id = "user-1"): ChatProviderModelInputMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function rawToolCall(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
  state = "completed",
): ChatProviderModelInputPart {
  return {
    type: "tool_call",
    id: toolCallId,
    name: toolName,
    input,
    state,
  } as ChatProviderModelInputPart;
}

function rawToolResult(
  toolCallId: string,
  output: unknown,
  toolName?: string,
): ChatProviderModelInputPart {
  return (toolName
    ? { type: "tool_result", tool_call_id: toolCallId, tool_name: toolName, output }
    : { type: "tool_result", tool_call_id: toolCallId, output }) as ChatProviderModelInputPart;
}

function dynamicToolCall(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
  state: string,
  output?: unknown,
): ChatProviderModelInputPart {
  return (output === undefined ? { type: "dynamic-tool", toolName, toolCallId, input, state } : {
    type: "dynamic-tool",
    toolName,
    toolCallId,
    input,
    state,
    output,
  }) as ChatProviderModelInputPart;
}

describe("tool-replay-reconciliation", () => {
  it("classifies in-flight states as transient", () => {
    assertEquals(isTransientToolState("input-streaming"), true);
    assertEquals(isTransientToolState("approval-requested"), true);
    assertEquals(isTransientToolState("output-available"), false);
    assertEquals(isTransientToolState(undefined), false);
  });

  it("returns an empty match set for empty history", () => {
    const matches = findProviderVisibleToolReplayMatches([]);
    assertEquals(typeof matches.preservedTransientToolParts.has, "function");
    assertEquals(typeof matches.matchedToolResultNames.get, "function");
    assertEquals(matches.matchedToolCallParts.has({}), false);
    assertEquals(matches.supersededToolResultParts.has({}), false);
  });

  it("matches a simple call/result pair and records the result's tool name", () => {
    const call = rawToolCall("tc-1", "bash", { command: "ls" });
    const result = rawToolResult("tc-1", "ok", "bash");
    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([call]),
      toolMessage([result]),
    ]);

    assertEquals(matches.matchedToolCallParts.has(call), true);
    assertEquals(matches.matchedToolResultParts.has(result), true);
    assertEquals(matches.matchedToolResultNames.get(result), "bash");
    // A non-transient, once-only occurrence is neither preserved-as-transient,
    // superseded, nor a batch start.
    assertEquals(matches.preservedTransientToolParts.has(call), false);
    assertEquals(matches.supersededToolCallParts.has(call), false);
    assertEquals(matches.supersededToolResultParts.has(result), false);
    assertEquals(matches.toolCallPartsStartingNewBatch.has(call), false);
  });

  it("discriminates by part object identity, not structural equality", () => {
    // THE CRITICAL PROPERTY: matching keys every collection off the exact part
    // object seen during the walk. A structurally identical clone that was
    // never part of the actual history must read as absent, even though it
    // would satisfy any value-based equality check.
    const call = rawToolCall("tc-1", "bash", { command: "ls" });
    const result = rawToolResult("tc-1", "ok", "bash");
    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([call]),
      toolMessage([result]),
    ]);

    const equalButDistinctCall = { ...call };
    const equalButDistinctResult = { ...result };

    assertEquals(matches.matchedToolCallParts.has(call), true);
    assertEquals(matches.matchedToolCallParts.has(equalButDistinctCall), false);
    assertEquals(matches.matchedToolResultParts.has(result), true);
    assertEquals(matches.matchedToolResultParts.has(equalButDistinctResult), false);
    assertEquals(matches.matchedToolResultNames.get(result), "bash");
    assertEquals(matches.matchedToolResultNames.get(equalButDistinctResult), undefined);
  });

  it("supersedes an earlier call/result occurrence when a later same-id call wins the match", () => {
    // Core of the algorithm: two split call/result pairs share a toolCallId
    // across four messages. The later occurrence is authoritative; the
    // earlier call AND its already-matched result are both marked superseded
    // (while remaining "matched", since they were matched before losing).
    const call1 = rawToolCall("dup", "github__get_pr_diff", { pull_number: 1 });
    const result1 = rawToolResult("dup", { files: ["old.ts"] }, "github__get_pr_diff");
    const call2 = rawToolCall("dup", "github__get_pr_diff", { pull_number: 2 });
    const result2 = rawToolResult("dup", { files: ["new.ts"] }, "github__get_pr_diff");

    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([call1], "assistant-1"),
      toolMessage([result1], "assistant-1:tool"),
      assistantMessage([call2], "assistant-2"),
      toolMessage([result2], "assistant-2:tool"),
    ]);

    assertEquals(matches.matchedToolCallParts.has(call1), true);
    assertEquals(matches.supersededToolCallParts.has(call1), true);
    assertEquals(matches.matchedToolResultParts.has(result1), true);
    assertEquals(matches.supersededToolResultParts.has(result1), true);

    assertEquals(matches.matchedToolCallParts.has(call2), true);
    assertEquals(matches.supersededToolCallParts.has(call2), false);
    assertEquals(matches.matchedToolResultParts.has(result2), true);
    assertEquals(matches.supersededToolResultParts.has(result2), false);
  });

  it("supersedes an earlier self-contained call occurrence when a later same-id self-contained call lands", () => {
    // The *other* supersede path: two self-contained occurrences (their own
    // output, no separate result part) share a toolCallId in one message.
    // Neither ever enters matchedToolCallParts (that set is only populated by
    // the pendingCalls/result-matching path), but the earlier one is still
    // marked superseded so it won't render.
    const call1 = dynamicToolCall("dup", "github__list_prs", { page: 1 }, "output-available", {
      data: [{ number: 3092 }],
    });
    const call2 = dynamicToolCall("dup", "github__list_prs", { page: 2 }, "output-available", {
      data: [{ number: 3093 }],
    });

    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([call1, call2]),
    ]);

    assertEquals(matches.supersededToolCallParts.has(call1), true);
    assertEquals(matches.supersededToolCallParts.has(call2), false);
    assertEquals(matches.matchedToolCallParts.has(call1), false);
    assertEquals(matches.matchedToolCallParts.has(call2), false);
  });

  it("preserves a transient call only when a later result actually resolves it", () => {
    const resolvedCall = dynamicToolCall(
      "resolved",
      "github__get_pr_diff",
      { pull_number: 1 },
      "streaming",
    );
    const unresolvedCall = dynamicToolCall(
      "unresolved",
      "github__get_issue",
      { number: 12 },
      "pending",
    );
    const result = rawToolResult("resolved", { files: ["a.ts"] }, "github__get_pr_diff");

    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([resolvedCall, unresolvedCall]),
      toolMessage([result]),
    ]);

    assertEquals(matches.preservedTransientToolParts.has(resolvedCall), true);
    assertEquals(matches.matchedToolCallParts.has(resolvedCall), true);

    // Never resolved: stays pending forever, never matched, never preserved.
    assertEquals(matches.preservedTransientToolParts.has(unresolvedCall), false);
    assertEquals(matches.matchedToolCallParts.has(unresolvedCall), false);
  });

  it("does not match a result whose tool name conflicts with the pending call's name", () => {
    const call = dynamicToolCall(
      "tool-1",
      "github__get_pr_diff",
      { pull_number: 1 },
      "streaming",
    );
    const mismatchedResult = rawToolResult("tool-1", { data: [] }, "github__list_prs");
    const controlCall = rawToolCall("tool-2", "github__list_prs", { state: "open" });
    const controlResult = rawToolResult("tool-2", { data: [] }, "github__list_prs");

    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([call, controlCall]),
      toolMessage([mismatchedResult, controlResult]),
    ]);

    assertEquals(matches.matchedToolCallParts.has(call), false);
    assertEquals(matches.matchedToolResultParts.has(mismatchedResult), false);
    assertEquals(matches.preservedTransientToolParts.has(call), false);
    // Positive control: a compatible pair in the same history really is
    // matched, proving the fixture was processed rather than short-circuited.
    assertEquals(matches.matchedToolCallParts.has(controlCall), true);
  });

  it("leaves a pending call with no result unmatched and unpreserved", () => {
    const call = rawToolCall("never-resolved", "github__get_issue", { number: 42 });

    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([call]),
    ]);

    assertEquals(matches.matchedToolCallParts.has(call), false);
    assertEquals(matches.supersededToolCallParts.has(call), false);
    assertEquals(matches.preservedTransientToolParts.has(call), false);
    assertEquals(matches.toolCallPartsStartingNewBatch.has(call), false);
  });

  it("marks a same-message call as starting a new batch when an earlier message's call is still pending", () => {
    // Mirrors conversion.test.ts's "does not join prior-message unresolved
    // calls into a new same-message call batch": first-call and second-call
    // start pending in message 1. Message 2 resolves first-call, then
    // introduces third-call while second-call (from the earlier message) is
    // still pending — third-call starts a new batch. second-call is orphaned
    // (its pending entry is dropped as stale before its own result arrives),
    // so it never matches.
    const firstCall = rawToolCall("first-call", "github__get_pr_diff", { pull_number: 1 });
    const secondCall = rawToolCall("second-call", "github__list_prs", { state: "open" });
    const firstResult = rawToolResult("first-call", { files: ["one.ts"] }, "github__get_pr_diff");
    const thirdCall = rawToolCall("third-call", "github__get_issue", { number: 42 });
    const secondResult = rawToolResult(
      "second-call",
      { data: [{ number: 3092 }] },
      "github__list_prs",
    );
    const thirdResult = rawToolResult("third-call", { issue: 42 }, "github__get_issue");

    const matches = findProviderVisibleToolReplayMatches([
      assistantMessage([firstCall, secondCall], "assistant-1"),
      assistantMessage(
        [firstResult, thirdCall, secondResult, thirdResult],
        "assistant-2",
      ),
    ]);

    assertEquals(matches.toolCallPartsStartingNewBatch.has(thirdCall), true);
    assertEquals(matches.toolCallPartsStartingNewBatch.has(firstCall), false);
    assertEquals(matches.toolCallPartsStartingNewBatch.has(secondCall), false);

    assertEquals(matches.matchedToolCallParts.has(firstCall), true);
    assertEquals(matches.matchedToolCallParts.has(thirdCall), true);
    // second-call's own result arrives after third-call already evicted it
    // from the pending list as a stale earlier-message entry.
    assertEquals(matches.matchedToolCallParts.has(secondCall), false);
    assertEquals(matches.matchedToolResultParts.has(secondResult), false);
  });

  it(
    "supersedes an earlier same-id call via toolCallsById even once it's been evicted from the pending queue",
    () => {
      // This pins toolCallsById-based supersession only: staleCall and
      // freshCall share a toolCallId, so removePendingCallsWithId's own
      // id-based eviction removes staleCall from pendingCalls when freshCall
      // is processed, regardless of whether any earlier-message/user-turn
      // boundary flush ran. And freshCall is self-contained, so no result
      // ever needs to match against pendingCalls. Neither of those redundant
      // paths exercises the user-message boundary itself — see the next case
      // for a fixture that actually discriminates that behavior.
      const staleCall = dynamicToolCall(
        "duplicate-call",
        "github__get_pr_diff",
        { pull_number: 1 },
        "streaming",
      );
      const freshCall = dynamicToolCall(
        "duplicate-call",
        "github__get_pr_diff",
        { pull_number: 2 },
        "output-available",
        { files: ["new.ts"] },
      );

      const matches = findProviderVisibleToolReplayMatches([
        assistantMessage([staleCall], "assistant-1"),
        userMessage("continue with a different PR", "user-2"),
        assistantMessage([freshCall], "assistant-2"),
      ]);

      // The stale transient call from before the user turn is never resolved
      // (its slot was dropped, not matched), so it is not preserved.
      assertEquals(matches.preservedTransientToolParts.has(staleCall), false);
      assertEquals(matches.matchedToolCallParts.has(staleCall), false);
      // supersession tracks it via toolCallsById independent of pendingCalls
      // eviction: the stale call is superseded even though it was already
      // dropped from the pending queue by the same-id removal above.
      assertEquals(matches.supersededToolCallParts.has(staleCall), true);
      assertEquals(matches.matchedToolCallParts.has(freshCall), false);
    },
  );

  it(
    "ends a pending call's window at a user message, so a later result can't resolve it",
    () => {
      // Unlike the case above, staleCall and lateResult share a toolCallId
      // that appears nowhere else, so removePendingCallsWithId's same-id
      // eviction can't be doing the work, and lateResult actually needs
      // pendingCalls to still hold an entry to match against. If user text
      // stopped counting as provider-visible content, staleCall would
      // survive in pendingCalls and lateResult would match it, flipping all
      // three assertions below to true. (A mutant that deletes only the
      // immediate origin-filtered flush call inside the visible-content
      // branch is *not* caught here: for a callless user message, the
      // end-of-message-loop `pendingCalls.splice(0,
      // pendingCountBeforeSameMessageVisibleContent)` fallback evicts the
      // exact same entries regardless, since everything in pendingCalls
      // before such a message is by construction from an earlier message.)
      const staleCall = dynamicToolCall(
        "only-call",
        "github__get_pr_diff",
        { pull_number: 1 },
        "streaming",
      );
      const lateResult = rawToolResult(
        "only-call",
        { files: ["late.ts"] },
        "github__get_pr_diff",
      );

      const matches = findProviderVisibleToolReplayMatches([
        assistantMessage([staleCall], "assistant-1"),
        userMessage("different question", "user-2"),
        assistantMessage([lateResult], "assistant-3"),
      ]);

      assertEquals(matches.matchedToolCallParts.has(staleCall), false);
      assertEquals(matches.preservedTransientToolParts.has(staleCall), false);
      assertEquals(matches.matchedToolResultParts.has(lateResult), false);
    },
  );

  it(
    "ends a pending call's window at a user message that carries only a file",
    () => {
      // Same fixture as above, but the user turn holds no text at all, so only
      // the file half of the user branch in isProviderVisibleNonToolPart can
      // close the pending-call window.
      const staleCall = dynamicToolCall(
        "only-call",
        "github__get_pr_diff",
        { pull_number: 1 },
        "streaming",
      );
      const lateResult = rawToolResult(
        "only-call",
        { files: ["late.ts"] },
        "github__get_pr_diff",
      );

      const matches = findProviderVisibleToolReplayMatches([
        assistantMessage([staleCall], "assistant-1"),
        {
          id: "user-2",
          role: "user",
          parts: [{
            type: "file",
            mediaType: "image/png",
            url: "https://files.example.com/shot.png",
          }] as ChatProviderModelInputPart[],
        },
        assistantMessage([lateResult], "assistant-3"),
      ]);

      assertEquals(
        matches.matchedToolCallParts.has(staleCall),
        false,
        "a file-only user boundary must leave the stale call unmatched",
      );
      assertEquals(
        matches.preservedTransientToolParts.has(staleCall),
        false,
        "a file-only user boundary must not preserve the stale transient call",
      );
      assertEquals(
        matches.matchedToolResultParts.has(lateResult),
        false,
        "a result after a file-only user boundary must not resolve the stale call",
      );
    },
  );
});
