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

import { createHostedChatContextBudgetOptions } from "./cloud-agent-chat-execution.ts";
import { createNodeVeryfrontCloudAgentServiceContext } from "./cloud-agent-config.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

function hostedDefaultOptions() {
  const context = createNodeVeryfrontCloudAgentServiceContext({
    serviceName: "context-budget-test",
    createBashTool: () => {
      throw new Error("Shell tools are not used by context budgeting");
    },
    env: {
      VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET: "10000",
      VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS: "1000",
      VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS: "1000",
      VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS: "1000",
    },
  });
  const request: ParsedHostedChatRequest = {
    agentId: undefined,
    userId: "fixture-user",
    authToken: "fixture-token",
    messages: [],
    validatedContext: { projectId: null, branchId: null },
    projectId: null,
    conversationId: undefined,
    parentRunId: undefined,
    upstreamParentConversationId: undefined,
    upstreamParentRunId: undefined,
    spawnedFromToolCallId: undefined,
    model: undefined,
    allowDelegation: undefined,
    forwardedProps: {},
    runtimeOverrides: undefined,
    persistLatestUserMessageBeforeDurableRun: false,
    durableRootRun: { runId: "run_fixture", messageId: "11111111-1111-4111-8111-111111111111" },
  };
  const options = createHostedChatContextBudgetOptions(
    context,
    request,
    {},
    new AbortController().signal,
  );
  assertExists(options);
  assertEquals(options.minimumRecentTurns, 2, "actual hosted default is retained");
  return { ...options, summaryGenerator: () => ({ text: "Completed older stages" }) };
}

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

Deno.test("applyContextBudget compacts a long active turn while preserving its exact user request and tool pairs", async () => {
  const messages: AgentRuntimeMessage[] = [
    message("request", "user", "Process ten fixture emails"),
  ];
  for (let index = 0; index < 30; index++) {
    messages.push(toolCallMessage(`call-${index}`, `tool-${index}`));
    messages.push({
      ...toolResultMessage(`result-${index}`, `tool-${index}`),
      parts: [{
        type: "tool-result",
        toolCallId: `tool-${index}`,
        toolName: "search_docs",
        result: { text: "fixture ".repeat(500) },
      }],
    });
  }
  const originalMessages = structuredClone(messages);
  let summarizedIds: string[] = [];
  let retainedIds: string[] = [];
  const result = await applyContextBudget(messages, {
    tokenBudget: 10000,
    reserveTokens: 1000,
    recentTailTokens: 1000,
    maxSummaryTokens: 1000,
    summaryGenerator: ({ messagesToSummarize, retainedMessages }) => {
      retainedIds = retainedMessages.map((entry) => entry.id);
      summarizedIds = messagesToSummarize.map((entry) => entry.id);
      return { text: "Older fixture stages complete" };
    },
  });
  assertEquals(result.diagnostics.compacted, true);
  assertEquals(result.diagnostics.tokensAfter <= 9000, true);
  assertEquals(
    result.messages.some((entry) =>
      entry.id === "request" && isTextPart(entry.parts[0]) &&
      entry.parts[0].text === "Process ten fixture emails"
    ),
    true,
  );
  assertEquals(result.messages.some((entry) => entry.id === "call-29"), true);
  assertEquals(result.messages.some((entry) => entry.id === "result-29"), true);
  assertEquals(messages, originalMessages, "durable source history remains intact");
  assertEquals(summarizedIds.includes("request"), false);
  assertEquals(summarizedIds.includes("result-0"), true);
  assertEquals(result.messages.filter((entry) => entry.id === "request"), [messages[0]]);
  assertExists(result.eventPayload);
  assertEquals(result.eventPayload.firstKeptEntryId, "call-29");
  assertEquals(result.eventPayload.preservedMessageIds, ["request"]);
  assertEquals(retainedIds, ["request", "call-29", "result-29"]);
  for (const entry of result.messages) {
    for (const part of entry.parts) {
      if (part.type !== "tool-result") continue;
      assertEquals(
        result.messages.some((candidate) =>
          candidate.parts.some((call) =>
            call.type === "tool-call" && call.toolCallId === part.toolCallId
          )
        ),
        true,
        "retained results keep their matching calls",
      );
    }
  }
});

Deno.test("actual hosted default compacts the one available active user turn", async () => {
  const messages = [message("request", "user", "Exact hosted request")];
  for (let index = 0; index < 30; index++) {
    messages.push(toolCallMessage(`call-${index}`, "reused-tool"));
    const result = toolResultMessage(`result-${index}`, "reused-tool");
    result.parts.push({ type: "text", text: "fixture ".repeat(500) });
    messages.push(result);
  }
  const result = await applyContextBudget(messages, hostedDefaultOptions());
  assertEquals(result.diagnostics.compacted, true);
  assertEquals(
    result.messages.filter((entry) => messages.some((original) => original.id === entry.id)).map(
      (entry) => entry.id,
    ),
    ["request", "call-29", "result-29"],
  );
  assertEquals(result.eventPayload?.preservedMessageIds, ["request"]);
});

Deno.test("actual hosted default fails closed when two protected turns overflow", async () => {
  const messages = [
    message("first-request", "user", "First protected request"),
    message("request", "user", "Second protected request"),
  ];
  for (let index = 0; index < 30; index++) {
    messages.push(toolCallMessage(`call-${index}`, `tool-${index}`));
    const result = toolResultMessage(`result-${index}`, `tool-${index}`);
    result.parts.push({ type: "text", text: "fixture ".repeat(500) });
    messages.push(result);
  }
  const original = structuredClone(messages);
  let summarized = false;
  await assertRejects(
    () =>
      applyContextBudget(messages, {
        ...hostedDefaultOptions(),
        summaryGenerator: () => {
          summarized = true;
          return { text: "Summary" };
        },
      }),
    ContextCompactionError,
    "exceeded usable token budget",
  );
  assertEquals(summarized, false, "an impossible protected suffix fails before a model summary");
  assertEquals(messages, original);
});

Deno.test("actual hosted default retains two complete recent turns when their suffix fits", async () => {
  const messages = [
    message("old-request", "user", "Old history ".repeat(5000)),
    message("old-response", "assistant", "Old response"),
    message("protected-request", "user", "First protected request"),
    message("protected-response", "assistant", "First protected response ".repeat(300)),
    message("request", "user", "Latest protected request"),
    toolCallMessage("call", "tool"),
    toolResultMessage("result", "tool"),
  ];
  const result = await applyContextBudget(messages, hostedDefaultOptions());
  assertEquals(result.diagnostics.compacted, true);
  for (const original of messages.slice(1)) {
    assertEquals(result.messages.find((entry) => entry.id === original.id), original);
  }
  assertEquals(result.messages.some((entry) => entry.id === "old-request"), false);
});

Deno.test("active-turn compaction treats completed tool identifier reuse as separate pairs", async () => {
  const messages: AgentRuntimeMessage[] = [message("request", "user", "Keep this exact request")];
  for (let index = 0; index < 30; index++) {
    messages.push(toolCallMessage(`call-${index}`, "reused-tool-id"));
    const result = toolResultMessage(`result-${index}`, "reused-tool-id");
    result.parts.push({ type: "text", text: "fixture ".repeat(500) });
    messages.push(result);
  }
  const result = await applyContextBudget(messages, {
    tokenBudget: 10000,
    reserveTokens: 1000,
    recentTailTokens: 1000,
    maxSummaryTokens: 1000,
    summaryGenerator: () => ({ text: "Completed older stages" }),
  });
  assertEquals(result.diagnostics.compacted, true);
  assertEquals(
    result.messages.filter((entry) => messages.some((original) => original.id === entry.id)).map((
      entry,
    ) => entry.id),
    ["request", "call-29", "result-29"],
  );
});

Deno.test("compaction closes dependencies of interleaved tool results", async () => {
  const lastResult = toolResultMessage("result-b", "tool-b");
  lastResult.parts.push({ type: "text", text: "fixture ".repeat(100) });
  const messages = [
    message("request", "user", "Keep this exact request"),
    message("older-stage", "assistant", "fixture ".repeat(5000)),
    toolCallMessage("call-a", "tool-a"),
    toolCallMessage("call-b", "tool-b"),
    toolResultMessage("result-a", "tool-a"),
    lastResult,
  ];
  const result = await applyContextBudget(messages, {
    tokenBudget: 2000,
    reserveTokens: 500,
    recentTailTokens: 100,
    maxSummaryTokens: 100,
    summaryGenerator: () => ({ text: "Summary" }),
  });
  assertEquals(result.eventPayload?.firstKeptEntryId, "call-a");
  assertEquals(
    result.messages.filter((entry) => messages.some((original) => original.id === entry.id)).map((
      entry,
    ) => entry.id),
    ["request", "call-a", "call-b", "result-a", "result-b"],
  );
});

Deno.test("compaction rejects overlapping pending calls with the same identifier", async () => {
  const messages = [
    message("request", "user", "fixture ".repeat(5000)),
    toolCallMessage("call-a", "ambiguous-tool"),
    toolCallMessage("call-b", "ambiguous-tool"),
    toolResultMessage("result", "ambiguous-tool"),
  ];
  await assertRejects(
    () =>
      applyContextBudget(messages, {
        tokenBudget: 2000,
        reserveTokens: 500,
        recentTailTokens: 100,
        maxSummaryTokens: 100,
        summaryGenerator: () => ({ text: "Summary" }),
      }),
    ContextCompactionError,
    "overlapping pending calls",
  );
});

Deno.test("active-turn compaction cannot split atomic segments of the preserved request", async () => {
  const messages: AgentRuntimeMessage[] = [
    message("request", "user", "First request segment"),
    message("request", "assistant", "Protected continuation segment"),
    message("request", "user", "Latest request segment"),
  ];
  for (let index = 0; index < 30; index++) {
    messages.push(message(`stage-${index}`, "assistant", "fixture ".repeat(1000)));
  }
  await assertRejects(
    () =>
      applyContextBudget(messages, {
        tokenBudget: 10000,
        reserveTokens: 1000,
        recentTailTokens: 1000,
        atomicMessageIds: ["request"],
        summaryGenerator: () => ({ text: "Older steps" }),
      }),
    ContextCompactionError,
  );
});

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

Deno.test("context compaction schema validates preserved request identifiers", () => {
  const event = {
    type: AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE,
    summary: { text: "Earlier work complete" },
    firstKeptEntryId: "call-29",
    preservedMessageIds: ["request"],
    tokensBefore: 10000,
    tokensAfter: 1000,
    tokenBudget: 10000,
    reserveTokens: 1000,
    reason: "context_window" as const,
  };
  const schema = getContextCompactionEventPayloadSchema();
  assertEquals(schema.parse(event).preservedMessageIds, ["request"]);
  assertEquals(schema.parse({ ...event, preservedMessageIds: [] }).preservedMessageIds, []);
  for (const preservedMessageIds of [[""], ["request", "request"], ["request", "another-user"]]) {
    assertEquals(schema.safeParse({ ...event, preservedMessageIds }).success, false);
  }
});

Deno.test("active-turn compaction rejects ambiguous preserved request identifiers", async () => {
  const messages: AgentRuntimeMessage[] = [
    message("request", "user", "Original request"),
    message("request", "user", "Latest request"),
    ...Array.from(
      { length: 30 },
      (_, index) => message(`stage-${index}`, "assistant", "fixture ".repeat(1000)),
    ),
  ];
  await assertRejects(
    () =>
      applyContextBudget(messages, {
        tokenBudget: 10000,
        reserveTokens: 1000,
        recentTailTokens: 1000,
        summaryGenerator: () => ({ text: "Older steps" }),
      }),
    ContextCompactionError,
  );
});

Deno.test("active-turn compaction rejects ambiguous durable tail anchors", async () => {
  const messages: AgentRuntimeMessage[] = [
    message("request", "user", "Original request"),
    ...Array.from(
      { length: 30 },
      (_, index) => message(`stage-${index}`, "assistant", "fixture ".repeat(1000)),
    ),
    message("checkpoint", "assistant", "Recent checkpoint ".repeat(100)),
    message("checkpoint", "assistant", "Continuation checkpoint ".repeat(100)),
  ];
  await assertRejects(
    () =>
      applyContextBudget(messages, {
        tokenBudget: 10000,
        reserveTokens: 1000,
        recentTailTokens: 1000,
        atomicMessageIds: ["checkpoint"],
        summaryGenerator: () => ({ text: "Older steps" }),
      }),
    ContextCompactionError,
  );
});
