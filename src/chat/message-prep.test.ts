import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertStringIncludes } from "#std/assert";
import type { ProviderModelMessage } from "./types.ts";
import {
  compressTurn,
  enforceTokenBudget,
  estimateTokens,
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
  assertStringIncludes(JSON.stringify(masked[2]), "[Command: npm test — exit 0, output omitted");
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
                    { id: 2, name: "integrations", color: "0e8a16" },
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
  assertEquals(compacted[1], {
    role: "assistant",
    content: "Acknowledged.",
  });
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

  const compacted = enforceTokenBudget(messages, 120);

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
    content: "Acknowledged.",
  });
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
          state: "output-available",
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
          state: "output-available",
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
