import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import {
  AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE,
  applyContextBudget,
  ContextCompactionError,
  getContextCompactionEventPayloadSchema,
} from "./context-budget-manager.ts";

function message(
  id: string,
  role: AgentRuntimeMessage["role"],
  text: string,
  timestamp = 1,
): AgentRuntimeMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
    timestamp,
  };
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return typeof part === "object" && part !== null &&
    "type" in part && part.type === "text" &&
    "text" in part && typeof part.text === "string";
}

function toolCallMessage(id: string, toolCallId: string): AgentRuntimeMessage {
  return {
    id,
    role: "assistant",
    parts: [{
      type: "tool-call",
      toolCallId,
      toolName: "search_docs",
      args: { query: "context compaction" },
    }],
    timestamp: 1,
  };
}

function toolResultMessage(id: string, toolCallId: string): AgentRuntimeMessage {
  return {
    id,
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId,
      toolName: "search_docs",
      result: { ok: true },
    }],
    timestamp: 1,
  };
}

Deno.test("applyContextBudget returns unchanged messages when under budget", async () => {
  const messages = [
    message("user-1", "user", "Hello"),
    message("assistant-1", "assistant", "Hi"),
  ];

  const result = await applyContextBudget(messages, {
    tokenBudget: 10_000,
    reserveTokens: 1_000,
    recentTailTokens: 1_000,
    summaryGenerator: () => ({ text: "unused" }),
  });

  assertEquals(result.messages, messages);
  assertEquals(result.eventPayload, undefined);
  assertEquals(result.diagnostics.compacted, false);
});

Deno.test("applyContextBudget compacts oversized history into summary plus retained tail", async () => {
  const messages = [
    message("user-1", "user", "Older goal ".repeat(200)),
    message("assistant-1", "assistant", "Recent answer"),
    message("user-2", "user", "Latest user request"),
  ];

  const result = await applyContextBudget(messages, {
    tokenBudget: 260,
    reserveTokens: 20,
    recentTailTokens: 20,
    now: () => 123,
    summaryGenerator: ({ messagesToSummarize, retainedMessages }) => ({
      text: `Summarized ${messagesToSummarize.length}; retained ${retainedMessages.length}`,
    }),
  });

  assertExists(result.eventPayload);
  assertEquals(result.eventPayload.type, AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE);
  assertEquals(result.eventPayload.firstKeptEntryId, "assistant-1");
  assertEquals(result.messages.map((entry) => entry.id), [
    "context_compaction_summary:assistant-1",
    "assistant-1",
    "user-2",
  ]);
  assertEquals(result.messages[0]?.role, "system");
  const summaryPart = result.messages[0]?.parts[0];
  assertStringIncludes(
    isTextPart(summaryPart) ? summaryPart.text : "",
    "Previous context summary:",
  );
  assertEquals(result.diagnostics.compacted, true);
});

Deno.test("applyContextBudget retains the latest assistant and user exchange", async () => {
  const messages = [
    message("user-1", "user", "Older goal ".repeat(200)),
    message("assistant-1", "assistant", "Older answer ".repeat(200)),
    message("assistant-2", "assistant", "Recent answer"),
    message("user-2", "user", "Latest user request"),
  ];

  const result = await applyContextBudget(messages, {
    tokenBudget: 260,
    reserveTokens: 20,
    recentTailTokens: 20,
    summaryGenerator: () => ({ text: "Earlier context summarized." }),
  });

  assertExists(result.eventPayload);
  assertEquals(result.eventPayload.firstKeptEntryId, "assistant-2");
  assertEquals(result.messages.map((entry) => entry.id), [
    "context_compaction_summary:assistant-2",
    "assistant-2",
    "user-2",
  ]);
});

Deno.test("applyContextBudget keeps tool call and result pairs in the retained tail", async () => {
  const messages = [
    message("user-1", "user", "Older goal ".repeat(200)),
    toolCallMessage("assistant-tool-1", "tool-1"),
    toolResultMessage("tool-result-1", "tool-1"),
    message("user-2", "user", "Use that result"),
  ];

  const result = await applyContextBudget(messages, {
    tokenBudget: 220,
    reserveTokens: 20,
    recentTailTokens: 80,
    summaryGenerator: () => ({ text: "Tool context summarized." }),
  });

  assertExists(result.eventPayload);
  assertEquals(result.eventPayload.firstKeptEntryId, "assistant-tool-1");
  assertEquals(result.messages.map((entry) => entry.id), [
    "context_compaction_summary:assistant-tool-1",
    "assistant-tool-1",
    "tool-result-1",
    "user-2",
  ]);
});

Deno.test("applyContextBudget rejects invalid summary output", async () => {
  await assertRejects(
    () =>
      applyContextBudget([
        message("user-1", "user", "Older goal ".repeat(200)),
        message("user-2", "user", "Latest"),
      ], {
        tokenBudget: 180,
        reserveTokens: 20,
        recentTailTokens: 20,
        summaryGenerator: () => ({ text: "" }),
      }),
    ContextCompactionError,
    "Context compaction summary generation failed",
  );
});

Deno.test("applyContextBudget rejects compacted context that still exceeds the usable budget", async () => {
  await assertRejects(
    () =>
      applyContextBudget([
        message("user-1", "user", "Older goal ".repeat(200)),
        message("user-2", "user", "Latest request ".repeat(200)),
      ], {
        tokenBudget: 120,
        reserveTokens: 20,
        recentTailTokens: 20,
        summaryGenerator: () => ({ text: "Older context summarized." }),
      }),
    ContextCompactionError,
    "Context compaction result exceeded usable token budget",
  );
});

Deno.test("applyContextBudget rejects invalid budget options before compaction", async () => {
  await assertRejects(
    () =>
      applyContextBudget([
        message("user-1", "user", "Older goal ".repeat(200)),
        message("user-2", "user", "Latest request"),
      ], {
        tokenBudget: 100,
        reserveTokens: 100,
        recentTailTokens: 20,
        summaryGenerator: () => ({ text: "unused" }),
      }),
    ContextCompactionError,
    "reserveTokens must be lower than tokenBudget",
  );
});

Deno.test("context compaction event schema rejects inconsistent token accounting", () => {
  const result = getContextCompactionEventPayloadSchema().safeParse({
    type: AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE,
    summary: { text: "Earlier context summarized." },
    firstKeptEntryId: "message-2",
    tokensBefore: 1_000,
    tokensAfter: 900,
    tokenBudget: 800,
    reserveTokens: 100,
    reason: "context_window",
  });

  assertEquals(result.success, false);
});
