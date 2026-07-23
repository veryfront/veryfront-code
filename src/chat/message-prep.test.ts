import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertMatch, assertStringIncludes, assertThrows } from "#std/assert";
import type { ProviderModelMessage } from "./types.ts";
import {
  compactForStep,
  compactOldToolInputs,
  compressTurn,
  enforceTokenBudget,
  estimateOverhead,
  estimateTokens,
  type HistoricalToolInputCompactionDiagnostic,
  maskOldToolOutputs,
  prepareProviderModelMessagesFromUiMessages,
  repairToolPairs,
  rewriteUnsupportedFilePartsAsAnnotations,
  stripPendingToolParts,
} from "./message-prep.ts";

Deno.test("repairToolPairs moves a later tool result immediately after the matching tool call", () => {
  const messages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: "I want to build a bank" }],
    },
    {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Let me gather one more detail first." },
        {
          type: "tool-call" as const,
          toolCallId: "tool-form",
          toolName: "form_input",
          input: { title: "Bank builder intake" },
        },
      ],
    },
    {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Waiting for your response." }],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "tool-form",
          toolName: "form_input",
          output: {
            type: "json" as const,
            value: {
              submitted: true,
              values: {
                bank_type: "dashboard",
              },
            },
          },
        },
      ],
    },
  ];

  const repaired = repairToolPairs(messages);
  const serialized = JSON.stringify(repaired);
  const toolResultMatches = serialized.match(/"toolCallId":"tool-form"/g) ?? [];
  const unavailableMatches = serialized.match(/\[tool result unavailable\]/g) ?? [];

  assertEquals(toolResultMatches.length, 2);
  assertEquals(unavailableMatches.length, 0);
  assertEquals(repaired, [messages[0]!, messages[1]!, messages[3]!, messages[2]!]);
});

Deno.test("repairToolPairs removes incomplete calls instead of fabricating tool results", () => {
  const messages: ProviderModelMessage[] = [
    { role: "user", content: "run it" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Starting." },
        { type: "tool-call", toolCallId: "missing", toolName: "bash", input: {} },
      ],
    },
  ];

  assertEquals(repairToolPairs(messages), [
    messages[0]!,
    { role: "assistant", content: [{ type: "text", text: "Starting." }] },
  ]);
  assertEquals(
    JSON.stringify(repairToolPairs(messages)).includes("tool result unavailable"),
    false,
  );
});

Deno.test("repairToolPairs never moves a result across a later user turn", () => {
  const messages: ProviderModelMessage[] = [
    { role: "user", content: "first turn" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "reused", toolName: "search", input: {} }],
    },
    { role: "user", content: "second turn" },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "reused",
        toolName: "search",
        output: { type: "json", value: { ok: true } },
      }],
    },
  ];

  assertEquals(repairToolPairs(messages), [messages[0]!, messages[2]!]);
});

Deno.test("estimateTokens handles cyclic diagnostic values without throwing", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  const estimate = estimateTokens(cyclic);
  assert(Number.isSafeInteger(estimate));
  assert(estimate > 0);
});

Deno.test("estimateTokens does not execute accessors", () => {
  let getterCalls = 0;
  const value: Record<string, unknown> = { visible: "ok" };
  Object.defineProperty(value, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "hidden";
    },
  });

  assert(estimateTokens(value) > 0);
  assertEquals(getterCalls, 0);
});

Deno.test("estimateTokens keeps its global entry budget across nested arrays", () => {
  let descriptorReads = 0;
  const trackDescriptors = (target: unknown[]) =>
    new Proxy(target, {
      getOwnPropertyDescriptor(target, key) {
        if (typeof key === "string" && /^\d+$/u.test(key)) descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  const inner = trackDescriptors(new Array(10_000).fill(null));
  const outerValues = new Array(10_000).fill(null);
  outerValues[0] = inner;
  const outer = trackDescriptors(outerValues);

  estimateTokens({ nested: outer });

  assertEquals(descriptorReads <= 10_000, true);
});

Deno.test("estimateOverhead rejects invalid tool counts", () => {
  assertThrows(
    () => estimateOverhead("instructions", -1),
    RangeError,
    "toolCount must be a nonnegative safe integer",
  );
  assertThrows(
    () => estimateOverhead("instructions", 1.5),
    RangeError,
    "toolCount must be a nonnegative safe integer",
  );
});

Deno.test("enforceTokenBudget fails when the required latest turn cannot fit", () => {
  assertThrows(
    () => enforceTokenBudget([{ role: "user", content: "latest request ".repeat(100) }], 10),
    RangeError,
    "Latest chat turn exceeds the available token budget",
  );
  assertThrows(
    () => enforceTokenBudget([{ role: "user", content: "ok" }], Number.NaN),
    RangeError,
    "budget must be a positive finite number",
  );
});

Deno.test("enforceTokenBudget preserves leading system instructions", () => {
  const system = { role: "system" as const, content: "Follow the safety policy." };
  const oldest = {
    role: "user" as const,
    content: "old question ".repeat(40),
  };
  const oldestAnswer = {
    role: "assistant" as const,
    content: "old answer ".repeat(40),
  };
  const latest = { role: "user" as const, content: "latest question" };

  const compacted = enforceTokenBudget([system, oldest, oldestAnswer, latest], 35, 0);

  assertEquals(compacted[0], system);
  assertEquals(compacted.at(-1), latest);
});

Deno.test("maskOldToolOutputs masks large historical tool outputs and removes stale reasoning before the latest user turn", () => {
  const messages = [
    { role: "user", content: "run the check" },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "old private chain" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "bash",
          input: { command: "npm test" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "bash",
          output: { type: "json", value: { exitCode: 0, stdout: "x".repeat(600) } },
        },
      ],
    },
    { role: "user", content: "now summarize it" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);

  assertEquals(masked[1], {
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "npm test" },
    }],
  });
  assertStringIncludes(JSON.stringify(masked[2]), "[Command: npm test, exit 0, output omitted");
  assertEquals(masked[3], messages[3]);
});

Deno.test("maskOldToolOutputs keeps compact email metadata for historical email list results", () => {
  const messages = [
    { role: "user", content: "check my inbox" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-email-list",
          toolName: "gmail__list_emails",
          input: { labelIds: ["INBOX"], maxResults: 30 },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-email-list",
          toolName: "gmail__list_emails",
          output: {
            type: "json",
            value: {
              messages: [
                {
                  id: "msg-1",
                  threadId: "thread-1",
                  from: "Sender <sender@example.com>",
                  to: "koji@example.com",
                  subject: "Suspicious offer",
                  date: "Thu, 28 May 2026 10:00:00 +0000",
                  snippet: "This is enough to identify the email.",
                  labelIds: ["INBOX"],
                  body: "large message body ".repeat(100),
                  payload: { headers: Array.from({ length: 40 }, (_, index) => ({ index })) },
                },
              ],
              nextPageToken: "next-page",
              resultSizeEstimate: 201,
              debug: "internal detail ".repeat(100),
            },
          },
        },
      ],
    },
    { role: "user", content: "archive the suspicious one" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.messages, [
    {
      id: "msg-1",
      threadId: "thread-1",
      from: "Sender <sender@example.com>",
      to: "koji@example.com",
      subject: "Suspicious offer",
      date: "Thu, 28 May 2026 10:00:00 +0000",
      snippet: "This is enough to identify the email.",
      labelIds: ["INBOX"],
    },
  ]);
  assertEquals(compacted.nextPageToken, "next-page");
  assertEquals(compacted.resultSizeEstimate, 201);
  assertEquals(compacted.messages[0].body, undefined);
  assertEquals(compacted.messages[0].payload, undefined);
  assertEquals(compacted.debug, undefined);
});

Deno.test("maskOldToolOutputs keeps compact GitHub issue metadata and cursor state", () => {
  const messages = [
    { role: "user", content: "check issues" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-github-issues",
          toolName: "github__list_issues",
          input: { owner: "veryfront", repo: "veryfront-code", first: 30 },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-github-issues",
          toolName: "github__list_issues",
          output: {
            type: "json",
            value: {
              issues: [
                {
                  id: "I_kwD",
                  number: 42,
                  title: "Audit integration tools",
                  body: "body ".repeat(200),
                  state: "OPEN",
                  url: "https://github.com/veryfront/veryfront-code/issues/42",
                  author: { login: "octocat" },
                  labels: { totalCount: 2, nodes: [{ name: "bug" }] },
                  assignees: { totalCount: 1, nodes: [{ login: "dev" }] },
                  comments: { nodes: [{ body: "large comment" }] },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
              debug: "internal detail ".repeat(100),
            },
          },
        },
      ],
    },
    { role: "user", content: "summarize the open ones" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.issuesCount, 1);
  assertEquals(compacted.issues[0].number, 42);
  assertEquals(compacted.issues[0].title, "Audit integration tools");
  assertEquals(compacted.issues[0].body.length <= 501, true);
  assertEquals(compacted.issues[0].labels, { totalCount: 2 });
  assertEquals(compacted.issues[0].assignees, { totalCount: 1 });
  assertEquals(compacted.pageInfo, { hasNextPage: true, endCursor: "cursor-2" });
  assertEquals(compacted.issues[0].comments, undefined);
  assertEquals(compacted.debug, undefined);
});

Deno.test("maskOldToolOutputs keeps compact GitHub PR labels from REST list results", () => {
  const messages = [
    { role: "user", content: "check prs" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-github-prs",
          toolName: "github__list_prs",
          input: { owner: "veryfront", repo: "veryfront-code", state: "open" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-github-prs",
          toolName: "github__list_prs",
          output: {
            type: "json",
            value: {
              pullRequests: [
                {
                  id: 123,
                  node_id: "PR_kwD",
                  number: 2567,
                  title: "Improve tool summaries",
                  body: "body ".repeat(200),
                  state: "open",
                  html_url: "https://github.com/veryfront/veryfront-code/pull/2567",
                  labels: [
                    { id: 1, name: "bug", color: "d73a4a", description: "ignored" },
                    { id: 2, name: "integrations", color: "0e8a16", description: "" },
                  ],
                  requested_reviewers: [{ login: "reviewer" }],
                  comments: [{ body: "large comment" }],
                },
              ],
              debug: "internal detail ".repeat(100),
            },
          },
        },
      ],
    },
    { role: "user", content: "summarize the open ones" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.pullRequestsCount, 1);
  assertEquals(compacted.pullRequests[0].number, 2567);
  assertEquals(compacted.pullRequests[0].labels, ["bug", "integrations"]);
  assertEquals(compacted.pullRequests[0].requested_reviewers, [{ login: "reviewer" }]);
  assertEquals(compacted.pullRequests[0].comments, undefined);
  assertEquals(compacted.debug, undefined);
});

Deno.test("maskOldToolOutputs keeps compact Confluence search metadata", () => {
  const messages = [
    { role: "user", content: "search docs" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-confluence-search",
          toolName: "confluence__search_content",
          input: { cloudId: "cloud-1", cql: "text ~ release" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-confluence-search",
          toolName: "confluence__search_content",
          output: {
            type: "json",
            value: {
              results: [
                {
                  id: "123",
                  type: "page",
                  status: "current",
                  title: "Release process",
                  excerpt: "release ".repeat(100),
                  space: { id: 10, key: "ENG", name: "Engineering", nested: { ignored: true } },
                  version: { number: 7, minorEdit: false, by: { ignored: true } },
                  _links: { webui: "/spaces/ENG/pages/123", base: "https://example.atlassian.net" },
                  body: { storage: { value: "<p>large body</p>" } },
                },
              ],
              size: 1,
              limit: 25,
              start: 0,
              _links: { next: "/wiki/rest/api/content/search?start=25" },
            },
          },
        },
      ],
    },
    { role: "user", content: "which page matters?" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.contentCount, 1);
  assertEquals(compacted.content[0].title, "Release process");
  assertEquals(compacted.content[0].excerpt.length <= 301, true);
  assertEquals(compacted.content[0].space, { id: 10, key: "ENG", name: "Engineering" });
  assertEquals(compacted.content[0].version, { number: 7, minorEdit: false });
  assertEquals(compacted.content[0].body, undefined);
  assertEquals(compacted.size, 1);
  assertEquals(compacted.limit, 25);
  assertEquals(compacted.start, 0);
  assertEquals(compacted._links, { next: "/wiki/rest/api/content/search?start=25" });
});

Deno.test("maskOldToolOutputs keeps compact Jira issue fields for search results", () => {
  const messages = [
    { role: "user", content: "search jira" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-jira-search",
          toolName: "jira__search_issues",
          input: { cloudId: "cloud-1", jql: "updated >= -30d ORDER BY updated DESC" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-jira-search",
          toolName: "jira__search_issues",
          output: {
            type: "json",
            value: {
              issues: [
                {
                  id: "10001",
                  key: "VF-123",
                  fields: {
                    summary: "Fix integration summaries",
                    created: "2026-06-19T10:00:00.000+0000",
                    updated: "2026-06-19T11:00:00.000+0000",
                    status: { name: "In Progress" },
                    assignee: { displayName: "Dev" },
                  },
                  changelog: { histories: [{ id: "large", detail: "ignored ".repeat(400) }] },
                },
              ],
              nextPageToken: "next-token",
              isLast: false,
              maxResults: 1,
            },
          },
        },
      ],
    },
    { role: "user", content: "what is the newest issue?" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.issuesCount, 1);
  assertEquals(compacted.issues[0].id, "10001");
  assertEquals(compacted.issues[0].key, "VF-123");
  assertEquals(compacted.issues[0].fields, {
    summary: "Fix integration summaries",
    created: "2026-06-19T10:00:00.000+0000",
    updated: "2026-06-19T11:00:00.000+0000",
  });
  assertEquals(compacted.issues[0].summary, "Fix integration summaries");
  assertEquals(compacted.issues[0].status, { name: "In Progress" });
  assertEquals(compacted.issues[0].assignee, { displayName: "Dev" });
  assertEquals(compacted.issues[0].created, "2026-06-19T10:00:00.000+0000");
  assertEquals(compacted.issues[0].updated, "2026-06-19T11:00:00.000+0000");
  assertEquals(compacted.issues[0].changelog, undefined);
  assertEquals(compacted.nextPageToken, "next-token");
});

Deno.test("maskOldToolOutputs keeps provider-scoped Outlook email action fields", () => {
  const messages = [
    { role: "user", content: "check outlook" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-outlook-list",
          toolName: "outlook__list_emails",
          input: { folderId: "inbox", $top: 25 },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-outlook-list",
          toolName: "outlook__list_emails",
          output: {
            type: "json",
            value: {
              value: [
                {
                  id: "outlook-message-1",
                  conversationId: "outlook-thread-1",
                  sender: {
                    emailAddress: {
                      name: "Planner",
                      address: "noreply@example.com",
                    },
                  },
                  toRecipients: [
                    {
                      emailAddress: {
                        name: "Koji",
                        address: "koji@example.com",
                      },
                    },
                  ],
                  subject: "You have late tasks",
                  receivedDateTime: "2026-05-28T10:00:00Z",
                  bodyPreview: "Preview text ".repeat(40),
                  isRead: false,
                  importance: "normal",
                  hasAttachments: true,
                  body: { contentType: "html", content: "<p>body</p>".repeat(200) },
                },
              ],
              "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skip=10",
              debug: "internal detail ".repeat(100),
            },
          },
        },
      ],
    },
    { role: "user", content: "summarize the first one" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.messages[0].id, "outlook-message-1");
  assertEquals(compacted.messages[0].conversationId, "outlook-thread-1");
  assertEquals(compacted.messages[0].sender, {
    name: "Planner",
    address: "noreply@example.com",
  });
  assertEquals(compacted.messages[0].toRecipients, [
    { name: "Koji", address: "koji@example.com" },
  ]);
  assertEquals(compacted.messages[0].isRead, false);
  assertEquals(compacted.messages[0].hasAttachments, true);
  assertEquals(
    compacted["@odata.nextLink"],
    "https://graph.microsoft.com/v1.0/me/messages?$skip=10",
  );
  assertEquals(compacted.messages[0].body, undefined);
  assertEquals(compacted.debug, undefined);
});

Deno.test("maskOldToolOutputs keeps GitHub issue identifiers for follow-up calls", () => {
  const messages = [
    { role: "user", content: "inspect issue" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-github-issue",
          toolName: "github__get_issue",
          input: { owner: "veryfront", repo: "veryfront-code", issue_number: 1932 },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-github-issue",
          toolName: "github__get_issue",
          output: {
            type: "json",
            value: {
              id: 3189234567,
              node_id: "I_kwDOExample",
              number: 1932,
              title: "Improve GitHub integration",
              state: "open",
              html_url: "https://github.com/veryfront/veryfront-code/issues/1932",
              user: { login: "octocat", id: 1 },
              created_at: "2026-05-28T10:00:00Z",
              updated_at: "2026-05-29T10:00:00Z",
              body: "large issue body ".repeat(200),
            },
          },
        },
      ],
    },
    { role: "user", content: "comment on it" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);
  const toolMessage = masked[2];
  if (toolMessage?.role !== "tool") {
    throw new Error("expected tool message");
  }
  const output = toolMessage.content[0]?.output;
  if (output?.type !== "text") {
    throw new Error("expected compacted text output");
  }
  const compacted = JSON.parse(output.value);

  assertEquals(compacted.issues, [
    {
      id: 3189234567,
      node_id: "I_kwDOExample",
      number: 1932,
      title: "Improve GitHub integration",
      body: compacted.issues[0].body,
      state: "open",
      html_url: "https://github.com/veryfront/veryfront-code/issues/1932",
      user: { login: "octocat", id: 1 },
      created_at: "2026-05-28T10:00:00Z",
      updated_at: "2026-05-29T10:00:00Z",
    },
  ]);
  assertEquals(compacted.issues[0].body.length <= 2001, true);
});

Deno.test("maskOldToolOutputs does not summarize unresearched email-like providers", () => {
  const messages = [
    { role: "user", content: "search mail" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-custom-search",
          toolName: "custom__search_emails",
          input: { q: "invoice" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-custom-search",
          toolName: "custom__search_emails",
          output: {
            type: "json",
            value: {
              messages: [{ id: "custom-1", body: "body ".repeat(200) }],
            },
          },
        },
      ],
    },
    { role: "user", content: "continue" },
  ] satisfies ProviderModelMessage[];

  const masked = maskOldToolOutputs(messages);

  assertStringIncludes(JSON.stringify(masked[2]), "[custom__search_emails output omitted");
});

Deno.test("enforceTokenBudget compresses the oldest turn before dropping later turns", () => {
  const messages = [
    { role: "user" as const, content: "old request ".repeat(100) },
    { role: "assistant" as const, content: "old answer ".repeat(100) },
    { role: "user" as const, content: "middle request ".repeat(5) },
    { role: "assistant" as const, content: "middle answer ".repeat(5) },
    { role: "user" as const, content: "latest request ".repeat(5) },
    { role: "assistant" as const, content: "latest answer ".repeat(5) },
  ];

  const totalTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const compacted = enforceTokenBudget(messages, totalTokens - 1);

  assertMatch(String(compacted[0]!.content), /^\[Compressed:/);
  assertEquals(compacted[1]?.role, "assistant");
  assertStringIncludes(String(compacted[1]?.content), "[Earlier assistant response:");
  assertEquals(compacted.slice(-2), messages.slice(-2));
});

Deno.test("enforceTokenBudget can still drop the oldest compressed turn when the budget remains too small", () => {
  const messages = [
    { role: "user" as const, content: "turn one ".repeat(120) },
    { role: "assistant" as const, content: "answer one ".repeat(120) },
    { role: "user" as const, content: "turn two ".repeat(120) },
    { role: "assistant" as const, content: "answer two ".repeat(120) },
    { role: "user" as const, content: "turn three ".repeat(120) },
    { role: "assistant" as const, content: "answer three ".repeat(120) },
    { role: "user" as const, content: "turn four ".repeat(120) },
    { role: "assistant" as const, content: "answer four ".repeat(120) },
  ];

  const retainedBudget = [
    ...compressTurn(messages, 4, 5),
    ...messages.slice(6),
  ].reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const compacted = enforceTokenBudget(messages, retainedBudget);

  assertEquals(compacted.length >= 4, true);
  assertMatch(String(compacted[0]!.content), /^\[Compressed: turn three/);
  assertEquals(compacted.slice(-2), messages.slice(-2));
});

Deno.test("compressTurn emits a two-message summary shell", () => {
  const messages = [
    { role: "user" as const, content: "please do something important" },
    {
      role: "assistant" as const,
      content: [
        { type: "tool-call" as const, toolCallId: "tool-1", toolName: "web_search", input: {} },
        { type: "text" as const, text: "Here is the final answer." },
      ],
    },
  ];

  const compressed = compressTurn(messages, 0, 1);
  assertStringIncludes(
    String(compressed[0]!.content),
    "[Compressed: please do something important",
  );
  assertEquals(compressed[1], {
    role: "assistant",
    content: "[Earlier assistant response: Here is the final answer.]",
  });
});

Deno.test("compressTurn keeps generated summaries within bounded field limits", () => {
  const repeatedToolParts = Array.from({ length: 40 }, (_, index) => ({
    type: "tool-call" as const,
    toolCallId: `tool-${index}`,
    toolName: index === 0 ? "tool-" + "x".repeat(200) : `tool-${index % 20}`,
    input: {},
  }));
  const compressed = compressTurn(
    [
      { role: "user", content: "u".repeat(200) },
      {
        role: "assistant",
        content: [
          ...repeatedToolParts,
          { type: "text", text: "a".repeat(300) },
        ],
      },
    ],
    0,
    1,
  );

  const userSummary = String(compressed[0]?.content);
  const assistantSummary = String(compressed[1]?.content);
  assertStringIncludes(userSummary, `[Compressed: ${"u".repeat(99)}…`);
  assertStringIncludes(assistantSummary, `${"a".repeat(149)}…]`);
  assertEquals(userSummary.includes("tool-20"), false);
  assertEquals(userSummary.match(/tool-1(?:[,;]|$)/g)?.length, 1);
});

Deno.test("stripPendingToolParts removes stale assistant tool calls before model conversion", () => {
  const messages = [
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "Let me ask one thing." },
        {
          type: "dynamic-tool" as const,
          toolName: "form_input",
          toolCallId: "tool-form",
          state: "input-available" as const,
          input: { title: "Intake" },
        },
        {
          type: "dynamic-tool" as const,
          toolName: "report",
          toolCallId: "tool-report",
          state: "output-streaming" as const,
          input: {},
        },
      ],
    },
  ];

  assertEquals(stripPendingToolParts(messages), [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Let me ask one thing." }],
    },
  ]);
});

Deno.test("rewriteUnsupportedFilePartsAsAnnotations converts non-model-native files into text annotations", () => {
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      parts: [
        { type: "text" as const, text: "Read this data." },
        {
          type: "file" as const,
          mediaType: "application/zip",
          filename: "archive.zip",
          uploadId: "upload-zip",
          uploadPath: "uploads/archive.zip",
          url: "https://files.example.com/archive.zip",
        },
      ],
    },
  ];

  assertEquals(rewriteUnsupportedFilePartsAsAnnotations(messages)[0]!.parts, [
    {
      type: "text",
      text: "Read this data.\n\n<uploaded_files>\n" +
        '<file name="archive.zip" upload_id="upload-zip" path="uploads/archive.zip" ' +
        'url="https://files.example.com/archive.zip" type="application/zip" />\n' +
        "</uploaded_files>",
    },
  ]);
});

Deno.test("prepareProviderModelMessagesFromUiMessages normalizes UI history into provider-safe tool order", () => {
  const prepared = prepareProviderModelMessagesFromUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Inspect rollout state." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "search_files",
          toolCallId: "tool-1",
          state: "completed",
          input: { query: "rollout" },
          output: { matches: 2 },
        },
      ],
    },
  ]);

  assertEquals(prepared, [
    {
      role: "user",
      content: [{ type: "text", text: "Inspect rollout state." }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "search_files",
          input: { query: "rollout" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "search_files",
          output: {
            type: "json",
            value: { matches: 2 },
          },
        },
      ],
    },
  ]);
});

Deno.test("prepareProviderModelMessagesFromUiMessages prefers completed tool output over superseded stopped errors", () => {
  const prepared = prepareProviderModelMessagesFromUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Search my notes." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "notion__search_notion",
          toolCallId: "toolu_01Search",
          input: { query: "research notes" },
          state: "output-error",
          providerExecuted: true,
          renderMode: "tool_call",
          errorText: "Stopped by user",
        },
        {
          type: "dynamic-tool",
          toolName: "notion__search_notion",
          toolCallId: "toolu_01Search",
          input: { query: "research notes" },
          state: "completed",
          providerExecuted: true,
          renderMode: "tool_result",
          output: { data: [] },
        },
      ],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Create a template I can use." }],
    },
  ]);

  assertEquals(prepared, [
    {
      role: "user",
      content: [{ type: "text", text: "Search my notes." }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "toolu_01Search",
          toolName: "notion__search_notion",
          input: { query: "research notes" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "toolu_01Search",
          toolName: "notion__search_notion",
          output: {
            type: "json",
            value: { data: [] },
          },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "text", text: "Create a template I can use." }],
    },
  ]);
});

Deno.test("prepareProviderModelMessagesFromUiMessages compacts large historical write and child-agent inputs", () => {
  const childPromptMarker = "CHILD_PROMPT_MARKER";
  const fileBodyMarker = "GENERATED_FILE_BODY_MARKER";
  const prepared = prepareProviderModelMessagesFromUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Build a graph viewer." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "invoke_agent",
          toolCallId: "tool-invoke",
          input: {
            agent_id: "codegen",
            model: "sonnet",
            description: "Build WebGL graph renderer",
            tools: ["create_file", "update_file", "get_file"],
            max_steps: 30,
            prompt: `${childPromptMarker}:${"child prompt ".repeat(4000)}`,
          },
          state: "output-available",
          output: {
            error: "Chat stream idle timeout after 120000ms during response_pending",
          },
        },
        {
          type: "dynamic-tool",
          toolName: "update_file",
          toolCallId: "tool-update",
          input: {
            path: "components/GraphViewer.tsx",
            content: `${fileBodyMarker}:${"const x = 1;\n".repeat(3000)}`,
          },
          state: "output-available",
          output: { ok: true },
        },
      ],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Make each node draggable." }],
    },
  ]);

  const serialized = JSON.stringify(prepared);
  assertEquals(serialized.includes(childPromptMarker), false);
  assertEquals(serialized.includes(fileBodyMarker), false);
  assertStringIncludes(serialized, "historical_tool_input_summary");
  assertStringIncludes(serialized, "Build WebGL graph renderer");
  assertStringIncludes(serialized, "components/GraphViewer.tsx");
  assertStringIncludes(serialized, "originalInputChars");
  assertStringIncludes(serialized, "originalInputHash");
});

Deno.test("prepareProviderModelMessagesFromUiMessages compacts custom tools through retention policy", () => {
  const customMarker = "RENDER_CANVAS_SOURCE_MARKER";
  const diagnostics: HistoricalToolInputCompactionDiagnostic[] = [];
  const prepared = prepareProviderModelMessagesFromUiMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Render the canvas." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "render_canvas",
          toolCallId: "tool-render",
          input: {
            targetPath: "components/Canvas.tsx",
            source: `${customMarker}:${"const node = 1;\n".repeat(3000)}`,
          },
          state: "output-available",
          output: { ok: true },
        }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Now make it interactive." }],
      },
    ],
    {
      historicalToolInputRetention: {
        diagnostics,
        resolvePolicy: (toolName) =>
          toolName === "render_canvas"
            ? {
              compactCompletedInput: true,
              compactAfterChars: 100,
              retainInputFields: [{ inputName: "targetPath", outputName: "path" }],
            }
            : undefined,
      },
    },
  );

  const serialized = JSON.stringify(prepared);
  assertEquals(serialized.includes(customMarker), false);
  assertStringIncludes(serialized, "historical_tool_input_summary");
  assertStringIncludes(serialized, "components/Canvas.tsx");
  assertEquals(diagnostics.length, 1);
  assertEquals((diagnostics[0] as { toolName?: string }).toolName, "render_canvas");
  assertEquals((diagnostics[0] as { toolCallId?: string }).toolCallId, "tool-render");
  assert((diagnostics[0] as { originalInputChars?: number }).originalInputChars! > 1_000);
  assert((diagnostics[0] as { retainedInputChars?: number }).retainedInputChars! < 1_000);
});

Deno.test("compactOldToolInputs does not execute retained metadata accessors", () => {
  let getterCalls = 0;
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("untrusted metadata getter");
    },
  });
  const messages: ProviderModelMessage[] = [
    { role: "user", content: "Run the tool." },
    {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "tool-custom",
        toolName: "custom",
        input: { metadata, payload: "x".repeat(2_000) },
      }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tool-custom",
        toolName: "custom",
        output: { type: "json", value: { ok: true } },
      }],
    },
    { role: "user", content: "Continue." },
  ];

  const compacted = compactOldToolInputs(messages, {
    resolvePolicy: () => ({
      compactCompletedInput: true,
      compactAfterChars: 100,
      retainInputFields: ["metadata"],
    }),
  });

  assertEquals(getterCalls, 0);
  assertEquals(JSON.stringify(compacted).includes("untrusted metadata getter"), false);
});

Deno.test("compactForStep compacts old tool inputs while preserving latest-turn tool inputs", () => {
  const oldFileBodyMarker = "OLD_FILE_BODY_MARKER";
  const latestFileBodyMarker = "LATEST_FILE_BODY_MARKER";
  const messages = [
    { role: "user", content: "Create the file." },
    {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "tool-old-update",
        toolName: "update_file",
        input: {
          path: "components/GraphViewer.tsx",
          content: `${oldFileBodyMarker}:${"old body ".repeat(3000)}`,
        },
      }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tool-old-update",
        toolName: "update_file",
        output: { type: "json", value: { ok: true } },
      }],
    },
    { role: "user", content: "Patch the current turn." },
    {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "tool-latest-update",
        toolName: "update_file",
        input: {
          path: "components/GraphViewer.tsx",
          content: `${latestFileBodyMarker}:${"new body ".repeat(3000)}`,
        },
      }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tool-latest-update",
        toolName: "update_file",
        output: { type: "json", value: { ok: true } },
      }],
    },
  ] satisfies ProviderModelMessage[];

  const compacted = compactForStep(messages);
  const serialized = JSON.stringify(compacted);

  assertEquals(serialized.includes(oldFileBodyMarker), false);
  assertEquals(serialized.includes(latestFileBodyMarker), true);
  assertStringIncludes(serialized, "historical_tool_input_summary");
});

Deno.test("prepareProviderModelMessagesFromUiMessages omits provider-owned tool history", () => {
  const prepared = prepareProviderModelMessagesFromUiMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Explain Swedish tax residency." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "web_search",
            toolCallId: "toolu_web_search",
            input: { query: "site:skatteverket.se tax residency" },
            state: "output-available",
            providerExecuted: true,
            output: null,
          },
          {
            type: "text",
            text: "Unlimited tax liability is based on Chapter 3 of the Income Tax Act.",
          },
        ],
      },
      {
        id: "tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "toolu_web_search",
            tool_name: "web_search",
            output: null,
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Cite the official source." }],
      },
    ],
    { providerOwnedToolNames: ["web_search"] },
  );

  assertEquals(prepared, [
    {
      role: "user",
      content: [{ type: "text", text: "Explain Swedish tax residency." }],
    },
    {
      role: "assistant",
      content: [{
        type: "text",
        text: "Unlimited tax liability is based on Chapter 3 of the Income Tax Act.",
      }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "Cite the official source." }],
    },
  ]);
});

Deno.test("prepareProviderModelMessagesFromUiMessages rejects invalid compaction thresholds", () => {
  assertThrows(
    () =>
      prepareProviderModelMessagesFromUiMessages(
        [
          { id: "user-1", role: "user", parts: [{ type: "text", text: "Run it" }] },
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{
              type: "dynamic-tool",
              toolName: "custom_tool",
              toolCallId: "tool-1",
              input: { payload: "x".repeat(2_000) },
              state: "output-available",
              output: { ok: true },
            }],
          },
          { id: "user-2", role: "user", parts: [{ type: "text", text: "Continue" }] },
        ],
        {
          historicalToolInputRetention: {
            resolvePolicy: () => ({ compactCompletedInput: true, compactAfterChars: 0 }),
          },
        },
      ),
    RangeError,
    "compactAfterChars must be a positive safe integer",
  );
});
