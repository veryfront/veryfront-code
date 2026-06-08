import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleAgUiStreamingResponse } from "#veryfront/agent/react/use-chat/streaming/index.ts";
import type { ChatMessage } from "./types.ts";
import {
  findBranchUserMessageIndex,
  isLatestRequest,
  resolveBranchKey,
  resolveUseChatStreamHandler,
} from "./use-chat.ts";

describe("use-chat internal state helpers", () => {
  it("isLatestRequest only accepts matching request ids", () => {
    assertEquals(isLatestRequest(3, 3), true);
    assertEquals(isLatestRequest(3, 2), false);
  });

  it("resolveBranchKey prefers mapped key when message id was remapped", () => {
    const branchMap = new Map([
      [
        "msg-old",
        {
          branches: [],
          currentIndex: 0,
          baseMessages: [] as ChatMessage[],
        },
      ],
    ]);
    const branchKeyByMessageId = new Map([["msg-new", "msg-old"]]);

    assertEquals(resolveBranchKey("msg-new", branchMap, branchKeyByMessageId), "msg-old");
  });

  it("resolveBranchKey falls back to direct map key and returns undefined when missing", () => {
    const branchMap = new Map([
      [
        "msg-root",
        {
          branches: [],
          currentIndex: 0,
          baseMessages: [] as ChatMessage[],
        },
      ],
    ]);
    const branchKeyByMessageId = new Map<string, string>();

    assertEquals(resolveBranchKey("msg-root", branchMap, branchKeyByMessageId), "msg-root");
    assertEquals(resolveBranchKey("msg-missing", branchMap, branchKeyByMessageId), undefined);
  });

  it("findBranchUserMessageIndex locates the active user branch by mapped key", () => {
    const messages: ChatMessage[] = [
      { id: "sys", role: "system", parts: [{ type: "text", text: "S" }] },
      { id: "u1", role: "user", parts: [{ type: "text", text: "old branch" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "A" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "new branch" }] },
    ];
    const branchKeyByMessageId = new Map<string, string>([
      ["u1", "root-1"],
      ["u2", "root-2"],
    ]);

    assertEquals(findBranchUserMessageIndex(messages, "root-2", branchKeyByMessageId), 3);
    assertEquals(findBranchUserMessageIndex(messages, "root-1", branchKeyByMessageId), 1);
    assertEquals(findBranchUserMessageIndex(messages, "missing", branchKeyByMessageId), -1);
  });

  it("defaults to AG-UI streaming when no transport is specified", () => {
    assertEquals(resolveUseChatStreamHandler(undefined), handleAgUiStreamingResponse);
    assertEquals(resolveUseChatStreamHandler("ag-ui"), handleAgUiStreamingResponse);
  });

  it("preserves AG-UI custom data events as assistant message parts", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: Custom",
          'data: {"name":"dora.report","value":{"overall":"fail"}}',
          "",
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Done"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:0"}',
          "",
          "event: RunFinished",
          'data: {"threadId":"thread-1","runId":"run-1"}',
          "",
          "",
        ].join("\n")));
        controller.close();
      },
    });
    const messages: ChatMessage[] = [];

    await handleAgUiStreamingResponse(body, {
      onData: () => {},
      onMessage: (message) => messages.push(message),
    });

    const message = messages[0];
    assertExists(message);
    assertEquals(message.parts, [
      { type: "data-dora.report", data: { overall: "fail" } },
      { type: "text", text: "Done", state: "done" },
    ]);
  });

  it("does not store AG-UI snapshot events as assistant message parts", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: StateSnapshot",
          'data: {"snapshot":{"context":"private"}}',
          "",
          "event: MessagesSnapshot",
          'data: {"messages":[{"id":"u1","role":"user","content":"Question"}]}',
          "",
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Done"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:0"}',
          "",
          "event: RunFinished",
          'data: {"threadId":"thread-1","runId":"run-1"}',
          "",
          "",
        ].join("\n")));
        controller.close();
      },
    });
    const messages: ChatMessage[] = [];
    const dataEvents: unknown[] = [];

    await handleAgUiStreamingResponse(body, {
      onData: (data) => dataEvents.push(data),
      onMessage: (message) => messages.push(message),
    });

    const message = messages[0];
    assertExists(message);
    assertEquals(message.parts, [
      { type: "text", text: "Done", state: "done" },
    ]);
    assertEquals(dataEvents, [
      { context: "private" },
      [{ id: "u1", role: "user", content: "Question" }],
    ]);
  });
});
