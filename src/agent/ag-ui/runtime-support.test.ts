import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeAgUiRuntimeMessages } from "./runtime-support.ts";

describe("agent/ag-ui-runtime-support", () => {
  it("canonicalizes legacy upload metadata on user attachments", () => {
    const messages = normalizeAgUiRuntimeMessages([
      {
        id: "user-1",
        role: "user",
        content: "Review this screenshot",
        attachments: [{
          type: "file",
          url: "https://uploads.example.com/screenshot.png",
          mediaType: "image/png",
          upload_id: "upload-image-1",
          upload_path: "_chat/user/upload-image-1-screenshot.png",
          filename: "screenshot.png",
        }],
      },
    ]);

    assertEquals(messages, [{
      id: "user-1",
      role: "user",
      parts: [
        { type: "text", text: "Review this screenshot" },
        {
          type: "file",
          url: "https://uploads.example.com/screenshot.png",
          mediaType: "image/png",
          uploadId: "upload-image-1",
          uploadPath: "_chat/user/upload-image-1-screenshot.png",
          filename: "screenshot.png",
        },
      ],
    }]);
  });

  it("infers tool message names from preceding assistant runtime tool calls", () => {
    const messages = normalizeAgUiRuntimeMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "harvest__list_users",
            arguments: '{"accountId":"2029314"}',
          },
        }],
      },
      {
        id: "tool-1-result",
        role: "tool",
        toolCallId: "tool-1",
        content: '{"users":[{"id":1,"name":"Ada"}]}',
      },
    ]);

    assertEquals(messages, [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "harvest__list_users",
          args: { accountId: "2029314" },
        }],
      },
      {
        id: "tool-1-result",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "harvest__list_users",
          result: '{"users":[{"id":1,"name":"Ada"}]}',
        }],
      },
    ]);
  });

  it("wraps failed tool results so the runtime sees the error", () => {
    const messages = normalizeAgUiRuntimeMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "tool-1",
          type: "function",
          function: { name: "harvest__list_users", arguments: "{}" },
        }],
      },
      {
        id: "tool-1-result",
        role: "tool",
        toolCallId: "tool-1",
        content: "partial",
        error: "upstream 500",
      },
    ]);

    assertEquals(
      messages[1]?.parts[0],
      {
        type: "tool-result",
        toolCallId: "tool-1",
        toolName: "harvest__list_users",
        result: { content: "partial", error: "upstream 500" },
      },
      "a tool message with an error must wrap content and error so the runtime sees the failure",
    );
  });

  it("resets inferred tool names on a new user turn", () => {
    const messages = normalizeAgUiRuntimeMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "tool-1",
          type: "function",
          function: { name: "harvest__list_users", arguments: "{}" },
        }],
      },
      { id: "user-1", role: "user", content: "next" },
      {
        id: "tool-1-result",
        role: "tool",
        toolCallId: "tool-1",
        content: "stale",
      },
    ]);

    assertEquals(
      (messages[2]?.parts[0] as { toolName: string }).toolName,
      "unknown",
      "a user turn must clear inferred tool names so a stale id cannot borrow a name",
    );
  });
});
