import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "../../chat/types.ts";
import {
  type ChatUiMessageStreamFinish,
  createChatUiMessageStreamFromDataStream,
} from "./chat-ui-message-stream.ts";

const encoder = new TextEncoder();

function createSseStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

async function collectChunks(
  stream: AsyncIterable<ChatUiMessageChunk>,
): Promise<ChatUiMessageChunk[]> {
  const chunks: ChatUiMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("createChatUiMessageStreamFromDataStream", () => {
  it("maps data stream events into UI chunks and finalizes a response message", async () => {
    let finish: ChatUiMessageStreamFinish<{ modelId: string }> | undefined;
    const stream = createSseStream([
      { type: "message-start", messageId: "framework-message" },
      { type: "step-start" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello from framework" },
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "search_files" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"query":"' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "search_files",
        input: { query: "chat runtime" },
      },
      { type: "tool-output-available", toolCallId: "tool-1", output: { matches: 2 } },
      { type: "step-end" },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        { stream },
        {
          generateMessageId: () => "assistant-message",
          messageMetadata: () => ({ modelId: "anthropic/claude" }),
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "start-step" },
      { type: "text-start", id: "assistant-message", contentId: "text-1" },
      {
        type: "text-delta",
        id: "assistant-message",
        contentId: "text-1",
        delta: "Hello from framework",
      },
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "search_files" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"query":"' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "search_files",
        input: { query: "chat runtime" },
      },
      { type: "tool-output-available", toolCallId: "tool-1", output: { matches: 2 } },
      { type: "finish-step" },
      { type: "text-end", id: "assistant-message", contentId: "text-1" },
      { type: "finish", finishReason: "stop" },
    ]);

    assertEquals(finish, {
      messages: [
        {
          id: "assistant-message",
          role: "assistant",
          parts: [
            { type: "text", text: "Hello from framework" },
            {
              type: "dynamic-tool",
              toolName: "search_files",
              toolCallId: "tool-1",
              input: { query: "chat runtime" },
              state: "output-available",
              output: { matches: 2 },
            },
          ],
          metadata: { modelId: "anthropic/claude" },
        },
      ],
      isContinuation: false,
      responseMessage: {
        id: "assistant-message",
        role: "assistant",
        parts: [
          { type: "text", text: "Hello from framework" },
          {
            type: "dynamic-tool",
            toolName: "search_files",
            toolCallId: "tool-1",
            input: { query: "chat runtime" },
            state: "output-available",
            output: { matches: 2 },
          },
        ],
        metadata: { modelId: "anthropic/claude" },
      },
      isAborted: false,
      finishReason: "stop",
    });
  });

  it("surfaces orphaned tool input deltas as tool input errors", async () => {
    const orphaned: Array<{ toolCallId: string; inputText: string }> = [];
    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            { type: "step-start" },
            { type: "tool-input-delta", toolCallId: "tool-orphan", inputTextDelta: '{"path":"' },
            {
              type: "tool-input-delta",
              toolCallId: "tool-orphan",
              inputTextDelta: 'docs/research.md"',
            },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          onOrphanedToolInput: (value) => orphaned.push(value),
        },
      ),
    );

    assertEquals(orphaned, [
      { toolCallId: "tool-orphan", inputText: '{"path":"docs/research.md"' },
    ]);
    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "start-step" },
      {
        type: "tool-input-error",
        toolCallId: "tool-orphan",
        toolName: "unknown",
        input: { __rawInputText: '{"path":"docs/research.md"' },
        errorText:
          'Tool input started streaming before the tool lifecycle was established and never materialized into an executable tool call. Buffered args: {"path":"docs/research.md"',
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("includes data parts in the final response message", async () => {
    let finish: ChatUiMessageStreamFinish | undefined;
    const lifecycle = {
      action: "created",
      inputRequest: { id: "input-request-1", toolCallId: "tool-1" },
    };

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            { type: "data", data: { name: "veryfront.input_request.lifecycle", value: lifecycle } },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "data-veryfront.input_request.lifecycle", data: lifecycle },
      { type: "finish", finishReason: "stop" },
    ]);
    assertEquals(finish?.responseMessage.parts, [
      { type: "data-veryfront.input_request.lifecycle", data: lifecycle },
    ]);
  });
});
