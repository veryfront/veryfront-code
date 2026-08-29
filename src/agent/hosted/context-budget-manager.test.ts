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

Deno.test("applyContextBudget reports token category diagnostics even when under budget", async () => {
  const messages = [
    message("user-1", "user", "Read the file"),
    {
      id: "assistant-tool-1",
      role: "assistant",
      parts: [{
        type: "tool-call",
        toolCallId: "tool-large-input",
        toolName: "update_file",
        args: {
          path: "components/GraphViewer.tsx",
          content: "large generated file body ".repeat(500),
        },
      }],
      timestamp: 1,
    },
    toolResultMessage("tool-result-1", "tool-large-input"),
  ] satisfies AgentRuntimeMessage[];

  const result = await applyContextBudget(messages, {
    tokenBudget: 20_000,
    reserveTokens: 1_000,
    recentTailTokens: 1_000,
    summaryGenerator: () => ({ text: "unused" }),
  });

  const beforeBreakdown = result.diagnostics.beforeBreakdown;
  const afterBreakdown = result.diagnostics.afterBreakdown;

  assertExists(beforeBreakdown);
  assertExists(afterBreakdown);
  assertEquals(beforeBreakdown.toolCallInputTokens > 0, true);
  assertEquals(afterBreakdown.toolCallInputTokens, beforeBreakdown.toolCallInputTokens);
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

Deno.test("applyContextBudget rejects generator summaries that exceed maxSummaryTokens", async () => {
  await assertRejects(
    () =>
      applyContextBudget([
        message("user-1", "user", "Older goal ".repeat(200)),
        message("assistant-1", "assistant", "Recent answer"),
        message("user-2", "user", "Latest user request"),
      ], {
        tokenBudget: 260,
        reserveTokens: 20,
        recentTailTokens: 20,
        maxSummaryTokens: 5,
        summaryGenerator: () => ({ text: "x ".repeat(500) }),
      }),
    ContextCompactionError,
    "Context compaction summary exceeded maxSummaryTokens",
    "oversized summaries must be rejected",
  );
});

Deno.test("applyContextBudget keeps minimumRecentTurns user turns in the retained tail", async () => {
  const messages = [
    message("user-1", "user", "Older goal ".repeat(200)),
    message("assistant-1", "assistant", "Older answer"),
    message("user-2", "user", "Second request"),
    message("assistant-2", "assistant", "Recent answer ".repeat(12)),
    message("user-3", "user", "Latest user request"),
  ];
  const options = {
    tokenBudget: 400,
    reserveTokens: 20,
    recentTailTokens: 20,
    summaryGenerator: () => ({ text: "Earlier context summarized." }),
  };

  const singleTurn = await applyContextBudget(messages, { ...options, minimumRecentTurns: 1 });
  assertExists(singleTurn.eventPayload);
  assertEquals(
    singleTurn.eventPayload.firstKeptEntryId,
    "assistant-2",
    "one recent turn keeps only the latest exchange",
  );

  const twoTurns = await applyContextBudget(messages, { ...options, minimumRecentTurns: 2 });
  assertExists(twoTurns.eventPayload);
  assertEquals(
    twoTurns.eventPayload.firstKeptEntryId,
    "assistant-1",
    "two recent turns must move the retained tail back past the second-latest user message",
  );

  await assertRejects(
    () => applyContextBudget(messages, { ...options, minimumRecentTurns: 0 }),
    ContextCompactionError,
    "Context compaction minimumRecentTurns must be a positive integer",
    "minimumRecentTurns of zero must be rejected",
  );
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

Deno.test("applyContextBudget keeps split checkpoint anchors atomic", async () => {
  const checkpointId = "assistant-checkpoint";
  const messages = [
    message("user-old", "user", "Older goal ".repeat(200)),
    {
      ...toolCallMessage(checkpointId, "provider-tool-1"),
      id: checkpointId,
    },
    {
      ...toolResultMessage(checkpointId, "provider-tool-1"),
      id: checkpointId,
    },
    message(checkpointId, "assistant", "Trailing provider answer ".repeat(8)),
    message("user-latest", "user", "Continue."),
  ] satisfies AgentRuntimeMessage[];

  const result = await applyContextBudget(messages, {
    tokenBudget: 300,
    reserveTokens: 20,
    recentTailTokens: 20,
    atomicMessageIds: [checkpointId],
    summaryGenerator: ({ messagesToSummarize }) => ({
      text: `Summarized ${messagesToSummarize.map((entry) => entry.id).join(",")}`,
    }),
  });

  assertEquals(result.messages.map((entry) => entry.id), [
    `context_compaction_summary:${checkpointId}`,
    checkpointId,
    checkpointId,
    checkpointId,
    "user-latest",
  ]);
  assertEquals(
    result.eventPayload?.summary.text,
    "Summarized user-old",
    "every same-ID checkpoint segment must be retained or summarized together",
  );
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
