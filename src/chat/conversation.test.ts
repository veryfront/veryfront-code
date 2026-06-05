import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage, ProviderModelMessage } from "veryfront/chat/types";
import {
  apiConversationSchema,
  apiMessageSchema,
  conversationTypeSchema,
  messagePartSchema,
  messageStatusSchema,
} from "veryfront/chat/compat";
import {
  convertUiMessagesToProviderModelMessages,
  extractTextFromMessage,
  extractUploadId,
  hasIncompleteToolParts,
  isRecord,
  isToolCallPart,
  mapToolState,
  markIncompleteToolPartsAsErrored,
  markIncompleteToolPartsAsStopped,
  pushToolParts,
  stringifyUnknown,
  toConversationPartsFromUiMessage,
} from "veryfront/chat/conversation";

describe("chat/conversation schemas", () => {
  it("validates API conversation and message payloads", () => {
    assertEquals(messagePartSchema.safeParse({ type: "text", text: "hello" }).success, true);
    assertEquals(
      messagePartSchema.safeParse({
        type: "tool_call",
        id: "tc-1",
        name: "bash",
        input: {},
        state: "pending",
      }).success,
      true,
    );
    assertEquals(conversationTypeSchema.safeParse("project_agent").success, true);
    assertEquals(messageStatusSchema.safeParse("cancelled").success, true);
    assertEquals(
      apiConversationSchema.safeParse({
        id: "conv-1",
        type: "chat",
        status: "active",
        messageCount: 1,
        createdBy: "user-1",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      }).success,
      true,
    );
    assertEquals(
      apiMessageSchema.safeParse({
        id: "msg-1",
        conversationId: "conv-1",
        parentId: null,
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
        status: "completed",
        model: null,
        tokenUsage: null,
        finishReason: null,
        createdBy: "user-1",
        metadata: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: null,
      }).success,
      true,
    );
  });
});

describe("chat/conversation helpers", () => {
  it("maps UI tool state and pushes persisted tool parts", () => {
    const parts: Array<ReturnType<typeof messagePartSchema.parse>> = [];
    pushToolParts(parts, "bash", "tc-1", "output-available", {
      input: { command: "ls" },
      output: "ok",
    });

    assertEquals(mapToolState("approval-requested"), "pending");
    assertEquals(mapToolState("output-denied"), "error");
    assertEquals(parts, [
      { type: "tool_call", id: "tc-1", name: "bash", input: { command: "ls" }, state: "completed" },
      { type: "tool_result", tool_call_id: "tc-1", output: "ok", is_error: false },
    ]);
  });

  it("treats terminal provider tool states as complete", () => {
    const message: ChatUiMessage = {
      id: "assistant-provider-tools",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "srvtoolu-search",
          input: { query: "Veryfront" },
          state: "completed",
          providerExecuted: true,
          output: { results: [] },
        },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://example.com" },
          state: "error",
          providerExecuted: true,
          errorText: "404 / Not Found",
        },
      ],
    };

    const parts: Array<ReturnType<typeof messagePartSchema.parse>> = [];
    for (const part of message.parts) {
      if (part.type === "tool-web_search") {
        pushToolParts(parts, "web_search", part.toolCallId, part.state, part);
      }
      if (part.type === "tool-web_fetch") {
        pushToolParts(parts, "web_fetch", part.toolCallId, part.state, part);
      }
    }

    assertEquals(hasIncompleteToolParts(message), false);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Tool call did not complete"), message);
    assertEquals(parts, [
      {
        type: "tool_call",
        id: "srvtoolu-search",
        name: "web_search",
        input: { query: "Veryfront" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "srvtoolu-search",
        output: { results: [] },
        is_error: false,
      },
      {
        type: "tool_call",
        id: "srvtoolu-fetch",
        name: "web_fetch",
        input: { url: "https://example.com" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "srvtoolu-fetch",
        output: "404 / Not Found",
        is_error: true,
      },
    ]);
  });

  it("treats provider-owned input-available tools as complete", () => {
    const message: ChatUiMessage = {
      id: "assistant-provider-owned-tool",
      role: "assistant",
      parts: [
        { type: "text", text: "I can answer with the fetched context." },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://example.com/docs" },
          state: "input-available",
          providerExecuted: true,
        },
      ],
    };

    assertEquals(hasIncompleteToolParts(message), false);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Tool call did not complete"), message);
    assertEquals(toConversationPartsFromUiMessage(message), [
      { type: "text", text: "I can answer with the fetched context." },
      {
        type: "tool_call",
        id: "srvtoolu-fetch",
        name: "web_fetch",
        input: { url: "https://example.com/docs" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "srvtoolu-fetch",
        output: null,
        is_error: false,
      },
    ]);
  });

  it("maps UI messages into persistable conversation parts", () => {
    const message: ChatUiMessage = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "Real content" },
        { type: "reasoning", text: "Thinking…" },
        { type: "source-url", sourceId: "src-1", url: "https://example.com", title: "Example" },
        { type: "source-document", sourceId: "doc-1", title: "Design Doc" },
        { type: "data-rollout", data: { approved: true } },
        {
          type: "file",
          mediaType: "image/png",
          url: "https://files.example.com/uploaded/11111111-1111-4111-a111-111111111111",
        },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "brief.pdf",
          url: "https://files.example.com/uploaded/22222222-2222-4222-a222-222222222222",
        },
        {
          type: "tool-form_input",
          toolCallId: "tool-1",
          input: { title: "Continue?" },
          state: "output-available",
          output: { approved: true },
        },
      ],
    };

    assertEquals(toConversationPartsFromUiMessage(message), [
      { type: "text", text: "Real content" },
      { type: "reasoning", text: "Thinking…" },
      { type: "citation", source_id: "src-1", title: "Example", url: "https://example.com" },
      { type: "citation", source_id: "doc-1", title: "Design Doc" },
      { type: "data", name: "rollout", value: { approved: true } },
      {
        type: "image",
        upload_id: "11111111-1111-4111-a111-111111111111",
        media_type: "image/png",
        url: "https://files.example.com/uploaded/11111111-1111-4111-a111-111111111111",
      },
      {
        type: "file",
        upload_id: "22222222-2222-4222-a222-222222222222",
        media_type: "application/pdf",
        url: "https://files.example.com/uploaded/22222222-2222-4222-a222-222222222222",
      },
      {
        type: "tool_call",
        id: "tool-1",
        name: "form_input",
        input: { title: "Continue?" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "tool-1",
        output: { approved: true },
        is_error: false,
      },
    ]);
  });

  it("marks incomplete UI tool parts as stopped or errored", () => {
    const message: ChatUiMessage = {
      id: "assistant-3",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "update_file",
          toolCallId: "tool-3",
          input: {},
          state: "pending",
        },
        {
          type: "tool-form_input",
          toolCallId: "tool-4",
          input: { title: "Continue?" },
          state: "approval-requested",
          approval: { id: "approval-1" },
        },
      ],
    };

    assertEquals(hasIncompleteToolParts(message), true);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Assistant ended before completion"), {
      id: "assistant-3",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "update_file",
          toolCallId: "tool-3",
          input: {},
          state: "output-error",
          errorText: "Assistant ended before completion",
        },
        {
          type: "tool-form_input",
          toolCallId: "tool-4",
          input: { title: "Continue?" },
          state: "output-error",
          errorText: "Assistant ended before completion",
        },
      ],
    });
    assertEquals(markIncompleteToolPartsAsStopped(message).parts[0], {
      type: "dynamic-tool",
      toolName: "update_file",
      toolCallId: "tool-3",
      input: {},
      state: "output-error",
      errorText: "Stopped by user",
    });
  });

  it("extracts upload ids and safely stringifies unknown values", () => {
    assertEquals(
      extractUploadId("https://api.example.com/uploads/550e8400-e29b-41d4-a716-446655440000/url"),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    assertEquals(isRecord({ ok: true }), true);
    assertEquals(isRecord([]), false);
    assertEquals(stringifyUnknown({ a: 1 }), '{"a":1}');
  });

  it("extracts text from provider model messages", () => {
    const message: ProviderModelMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "tool-call", toolCallId: "tc-1", toolName: "bash", input: {} },
        { type: "text", text: "second" },
      ],
    };

    assertEquals(extractTextFromMessage(message), "first second");
  });
});

describe("convertUiMessagesToProviderModelMessages", () => {
  it("converts assistant tool UI parts into assistant and tool provider model messages", () => {
    const messages: ChatUiMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I can help." },
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "tool-1",
            input: { command: "pwd" },
            state: "output-available",
            output: { cwd: "/workspace" },
          },
          { type: "text", text: "Done." },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I can help." },
          { type: "tool-call", toolCallId: "tool-1", toolName: "bash", input: { command: "pwd" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "bash",
            output: { type: "json", value: { cwd: "/workspace" } },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
    ]);
  });

  it("recognizes raw tool-call parts", () => {
    assertEquals(
      isToolCallPart({ type: "tool-call", toolCallId: "tc-1", toolName: "bash", input: {} }),
      true,
    );
  });

  it("passes through pre-split role:tool messages from normalized replay history", () => {
    const messages: ChatUiMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "tool-1",
            name: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
            state: "completed",
          },
          {
            type: "tool_call",
            id: "tool-2",
            name: "github__list_prs",
            input: { repo: "api", owner: "veryfront" },
            state: "completed",
          },
        ],
      },
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "github__get_pr_diff",
            output: { error: "authentication_required" },
          },
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            tool_name: "github__list_prs",
            output: { error: "authentication_required" },
          },
        ],
      },
      {
        id: "message-1:after-tool:1",
        role: "assistant",
        parts: [{ type: "text", text: "I don't have GitHub access." }],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "github__list_prs",
            input: { repo: "api", owner: "veryfront" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            output: { type: "json", value: { error: "authentication_required" } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "github__list_prs",
            output: { type: "json", value: { error: "authentication_required" } },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I don't have GitHub access." }],
      },
    ]);
  });

  it("groups interleaved persisted tool call/result parts from one assistant turn", () => {
    const messages: ChatUiMessage[] = [
      {
        id: "assistant-interleaved",
        role: "assistant",
        parts: [
          { type: "text", text: "I will fetch both sources." },
          {
            type: "tool_call",
            id: "tool-1",
            name: "calendar__list_events",
            input: { calendarId: "primary" },
            state: "completed",
          },
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "calendar__list_events",
            output: { data: [{ summary: "Standup" }] },
          },
          {
            type: "tool_call",
            id: "tool-2",
            name: "gmail__search_emails",
            input: { q: "newer_than:1d" },
            state: "completed",
          },
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            tool_name: "gmail__search_emails",
            output: { data: [{ id: "email-1" }] },
          },
          { type: "text", text: "Now I will inspect the emails." },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will fetch both sources." },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            input: { calendarId: "primary" },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            input: { q: "newer_than:1d" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            output: { type: "json", value: { data: [{ summary: "Standup" }] } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            output: { type: "json", value: { data: [{ id: "email-1" }] } },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Now I will inspect the emails." }],
      },
    ]);
  });

  it("groups consecutive role:tool replay messages after parallel tool calls", () => {
    const messages: ChatUiMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "tool-1",
            name: "calendar__list_events",
            input: { calendarId: "primary" },
            state: "completed",
          },
          {
            type: "tool_call",
            id: "tool-2",
            name: "gmail__search_emails",
            input: { q: "newer_than:1d" },
            state: "completed",
          },
        ],
      },
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "calendar__list_events",
            output: { data: [{ summary: "Daily Product Engineering" }] },
          },
        ],
      },
      {
        id: "message-1:tool:tool-2",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            tool_name: "gmail__search_emails",
            output: { data: [{ id: "message-id" }] },
          },
        ],
      },
      {
        id: "message-1:after-tool:1",
        role: "assistant",
        parts: [{ type: "text", text: "I found today's updates." }],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            input: { calendarId: "primary" },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            input: { q: "newer_than:1d" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            output: { type: "json", value: { data: [{ summary: "Daily Product Engineering" }] } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            output: { type: "json", value: { data: [{ id: "message-id" }] } },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I found today's updates." }],
      },
    ]);
  });
});
