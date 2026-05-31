import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendCurrentRunToolStateToSystemPrompt,
  createCurrentRunToolState,
  createToolInputFingerprint,
  recordCurrentRunToolResult,
  summarizeToolResultForCurrentRunState,
} from "./current-run-tool-state.ts";

describe("current-run tool state", () => {
  it("normalizes input fingerprints independent of key order", () => {
    assertEquals(
      createToolInputFingerprint({ b: 2, a: { d: 4, c: 3 } }),
      createToolInputFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("records calls by tool name and normalized input fingerprint", () => {
    const state = createCurrentRunToolState();
    const now = new Date("2026-01-01T00:00:00.000Z");

    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "harvest__list_accounts",
      input: {},
      result: {
        data: [
          {
            id: 123456,
            name: "Example Workspace",
            product: "harvest",
            mfa_required: false,
          },
        ],
      },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_2",
      toolName: "harvest__list_accounts",
      input: {},
      result: {
        data: [
          {
            id: 123456,
            name: "Example Workspace",
            product: "harvest",
            mfa_required: false,
          },
        ],
      },
      now,
    });

    assertEquals(state.harvest__list_accounts?.calls["{}"], {
      toolCallIds: ["call_1", "call_2"],
      input: {},
      status: "success",
      summary: {
        accountsCount: 1,
        accounts: [{
          id: 123456,
          name: "Example Workspace",
          product: "harvest",
        }],
        omitted: "account auth policy and provider-specific fields",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("uses configured summaries for known integration collection tools", () => {
    const summary = summarizeToolResultForCurrentRunState("gmail__list_emails", {
      messages: [
        {
          id: "msg-1",
          threadId: "thread-1",
          from: "Sender <sender@example.test>",
          subject: "Hello",
          snippet: "Short preview",
          body: "large body ".repeat(100),
        },
      ],
      nextPageToken: "next",
      debug: "debug ".repeat(100),
    });

    assertEquals(summary, {
      status: "success",
      summary: {
        messagesCount: 1,
        messages: [{
          id: "msg-1",
          threadId: "thread-1",
          from: "Sender <sender@example.test>",
          subject: "Hello",
          snippet: "Short preview",
        }],
        omitted: "large email bodies and provider-specific payload fields",
        nextPageToken: "next",
      },
    });
  });

  it("keeps empty collection results visible", () => {
    const summary = summarizeToolResultForCurrentRunState("github__list_prs", {
      data: [],
    });

    assertEquals(summary, {
      status: "empty",
      summary: {
        pullRequestsCount: 0,
        pullRequests: [],
        omitted: "pull request bodies, diff details, and provider-specific payload fields",
      },
    });
  });

  it("injects compact state into the system prompt", () => {
    const state = createCurrentRunToolState();
    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "slack__list_channels",
      input: { limit: 10 },
      result: { channels: [{ id: "C1", name: "general" }] },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assertStringIncludes(prompt, "Base system");
    assertStringIncludes(prompt, '<tool_state current_run="true">');
    assertStringIncludes(prompt, '"slack__list_channels"');
    assertStringIncludes(prompt, '"{\\"limit\\":10}"');
    assert(!prompt.includes('"input"'));
    assert(!prompt.includes('"toolCallIds"'));
    assert(!prompt.includes('"updatedAt"'));
    assert(!prompt.includes("call_1"));
  });

  it("retains Gmail history delta arrays declared as object fields", () => {
    const summary = summarizeToolResultForCurrentRunState("gmail__list_history", {
      history: [
        {
          id: "hist-1",
          messagesAdded: [
            {
              message: {
                id: "msg-1",
                threadId: "thread-1",
                labelIds: ["INBOX"],
                snippet: "short",
              },
            },
          ],
          messagesDeleted: [
            {
              message: {
                id: "msg-2",
                threadId: "thread-2",
              },
            },
          ],
        },
      ],
      historyId: "hist-latest",
    });

    assertEquals(summary, {
      status: "success",
      summary: {
        historyCount: 1,
        history: [{
          id: "hist-1",
          messagesAdded: [{
            message: {
              id: "msg-1",
              threadId: "thread-1",
              labelIds: ["INBOX"],
              snippet: "short",
            },
          }],
          messagesDeleted: [{
            message: {
              id: "msg-2",
              threadId: "thread-2",
            },
          }],
        }],
        omitted: "history details and provider-specific payload fields",
        historyId: "hist-latest",
      },
    });
  });
});
