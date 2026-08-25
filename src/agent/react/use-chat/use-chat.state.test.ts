import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  handleAgUiStreamingResponse,
  handleStreamingResponse,
} from "#veryfront/agent/react/use-chat/streaming/index.ts";
import type { ChatProps } from "#veryfront/react/components/chat/chat.tsx";
import type { ChatFilePart, ChatMessage } from "./types.ts";
import type { UseChatResult } from "./types.ts";
import {
  buildUserMessageParts,
  findBranchUserMessageIndex,
  isLatestRequest,
  resolveBranchKey,
  resolveUseChatStreamHandler,
  userMessagePayload,
} from "./use-chat.ts";

const _chatPropsAcceptsWholeSession: ChatProps = { chat: {} as UseChatResult };
type RemovedFlatChatKeys = Extract<
  keyof ChatProps,
  | "messages"
  | "input"
  | "onChange"
  | "onSubmit"
  | "sendMessage"
  | "stop"
  | "reload"
  | "setInput"
  | "model"
  | "activeModel"
  | "onModelChange"
  | "inferenceMode"
>;
type RemovedSessionAliases = Extract<
  keyof UseChatResult,
  "onChange" | "onSubmit" | "onModelChange"
>;
const _flatChatKeysAreRemoved: RemovedFlatChatKeys extends never ? true : false = true;
const _sessionAliasesAreRemoved: RemovedSessionAliases extends never ? true : false = true;
void _chatPropsAcceptsWholeSession;
void _flatChatKeysAreRemoved;
void _sessionAliasesAreRemoved;

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

  it("buildUserMessageParts puts file attachments before the text", () => {
    const file: ChatFilePart = {
      type: "file",
      mediaType: "image/png",
      url: "https://cdn.example.com/a.png",
      filename: "a.png",
    };
    assertEquals(
      buildUserMessageParts("describe this", [file]),
      [file, { type: "text", text: "describe this" }],
      "file parts should lead, followed by the text part",
    );
  });

  it("buildUserMessageParts returns a text-only part when there are no files", () => {
    assertEquals(buildUserMessageParts("just text"), [{ type: "text", text: "just text" }]);
    assertEquals(buildUserMessageParts("also text", []), [{ type: "text", text: "also text" }]);
  });

  it("userMessagePayload preserves file parts for regenerate", () => {
    const file: ChatFilePart = {
      type: "file",
      mediaType: "application/pdf",
      url: "https://example.com/report.pdf",
      filename: "report.pdf",
    };
    const message: ChatMessage = {
      id: "u1",
      role: "user",
      parts: [file, { type: "text", text: "summarize" }],
    };

    assertEquals(userMessagePayload(message), { text: "summarize", files: [file] });
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

  it("preserves renderable AG-UI custom events as assistant message parts", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Done"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:0"}',
          "",
          "event: Custom",
          'data: {"name":"source-url","value":{"type":"source-url","sourceId":"web-1","url":"https://example.com/reference","title":"Reference"}}',
          "",
          "event: Custom",
          'data: {"name":"source-document","value":{"type":"source-document","sourceId":"knowledge/handbook.md","mediaType":"text/markdown","title":"knowledge/handbook.md","filename":"knowledge/handbook.md"}}',
          "",
          "event: Custom",
          'data: {"name":"file","value":{"type":"file","url":"https://cdn.example.com/report.pdf","mediaType":"application/pdf","filename":"report.pdf"}}',
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

    assertEquals(messages[0]?.parts, [
      { type: "text", text: "Done", state: "done" },
      {
        type: "source-url",
        sourceId: "web-1",
        url: "https://example.com/reference",
        title: "Reference",
      },
      {
        type: "source-document",
        sourceId: "knowledge/handbook.md",
        mediaType: "text/markdown",
        title: "knowledge/handbook.md",
        filename: "knowledge/handbook.md",
      },
      {
        type: "file",
        url: "https://cdn.example.com/report.pdf",
        mediaType: "application/pdf",
        filename: "report.pdf",
      },
    ]);
  });

  it("preserves text blocks around an AG-UI citation", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Before citation"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:0"}',
          "",
          "event: Custom",
          'data: {"name":"source-url","value":{"type":"source-url","sourceId":"web-1","url":"https://example.com/reference","title":"Reference"}}',
          "",
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:1","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:1","delta":"After citation"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:1"}',
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

    assertEquals(messages[0]?.id, "msg-1");
    assertEquals(messages[0]?.parts, [
      { type: "text", text: "Before citation", state: "done" },
      {
        type: "source-url",
        sourceId: "web-1",
        url: "https://example.com/reference",
        title: "Reference",
      },
      { type: "text", text: "After citation", state: "done" },
    ]);
  });

  it("replaces a fallback citation with richer metadata during durable replay", async () => {
    const encoder = new TextEncoder();
    const sourceId = "knowledge/handbook.md";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: Custom",
          `data: {"name":"source-document","value":{"type":"source-document","sourceId":"${sourceId}","mediaType":"text/markdown","title":"${sourceId}","filename":"${sourceId}"}}`,
          "",
          "event: Custom",
          `data: {"name":"source-document","value":{"type":"source-document","sourceId":"${sourceId}","mediaType":"text/x-markdown","title":"Curated handbook","filename":"${sourceId}"}}`,
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

    assertEquals(messages[0]?.parts, [{
      type: "source-document",
      sourceId,
      mediaType: "text/x-markdown",
      title: "Curated handbook",
      filename: sourceId,
    }]);
  });

  it("preserves valid legacy source events and ignores malformed source events", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"type":"text-start","id":"text:0"}',
          'data: {"type":"text-delta","id":"text:0","delta":"Done"}',
          'data: {"type":"text-end","id":"text:0"}',
          'data: {"type":"source-url","sourceId":"web-1","url":"https://example.com/reference","title":"Reference"}',
          'data: {"type":"source-document","sourceId":"broken","title":"Broken"}',
          'data: {"type":"message-finish"}',
          "",
        ].join("\n")));
        controller.close();
      },
    });
    const messages: ChatMessage[] = [];

    await handleStreamingResponse(body, {
      onData: () => {},
      onMessage: (message) => messages.push(message),
    });

    assertEquals(messages[0]?.parts, [
      { type: "text", text: "Done", state: "done" },
      {
        type: "source-url",
        sourceId: "web-1",
        url: "https://example.com/reference",
        title: "Reference",
      },
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
          "event: StateDelta",
          'data: {"delta":{"phase":"planning"}}',
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
    assertEquals(
      message.parts,
      [
        { type: "text", text: "Done", state: "done" },
      ],
      "internal state events must not become renderable assistant parts",
    );
    assertEquals(
      dataEvents,
      [
        { context: "private" },
        [{ id: "u1", role: "user", content: "Question" }],
        { phase: "planning" },
      ],
      "snapshot and delta payloads still reach onData",
    );
  });

  it("surfaces an AG-UI run error as a rejected stream", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Done"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:0"}',
          "",
          "event: RunError",
          'data: {"message":"Runtime failed"}',
          "",
          "",
        ].join("\n")));
        controller.close();
      },
    });

    await assertRejects(
      () =>
        handleAgUiStreamingResponse(body, {
          onData: () => {},
          onMessage: () => {},
        }),
      Error,
      "Runtime failed",
      "a RunError must reject the stream rather than finish silently",
    );
  });

  it("treats a cancelled AG-UI run as an abort rather than an error", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Done"}',
          "",
          "event: TextMessageEnd",
          'data: {"messageId":"msg-1","contentId":"text:0"}',
          "",
          "event: RunError",
          'data: {"message":"Cancelled by the user","code":"CANCELLED"}',
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

    assertEquals(messages, [], "a cancelled run resolves without committing an assistant message");
  });
});
