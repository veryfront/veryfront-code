import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatModelMessage, ChatUiMessage } from "veryfront/chat/types";
import {
  apiConversationSchema,
  apiMessageSchema,
  conversationTypeSchema,
  convertUiMessagesToModelMessages,
  extractTextFromMessage,
  extractUploadId,
  isRecord,
  isToolCallPart,
  mapToolState,
  messagePartSchema,
  messageStatusSchema,
  pushToolParts,
  stringifyUnknown,
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

  it("extracts upload ids and safely stringifies unknown values", () => {
    assertEquals(
      extractUploadId("https://api.example.com/uploads/550e8400-e29b-41d4-a716-446655440000/url"),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    assertEquals(isRecord({ ok: true }), true);
    assertEquals(isRecord([]), false);
    assertEquals(stringifyUnknown({ a: 1 }), '{"a":1}');
  });

  it("extracts text from model messages", () => {
    const message: ChatModelMessage = {
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

describe("convertUiMessagesToModelMessages", () => {
  it("converts assistant tool UI parts into assistant and tool model messages", () => {
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

    assertEquals(convertUiMessagesToModelMessages(messages), [
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
});
