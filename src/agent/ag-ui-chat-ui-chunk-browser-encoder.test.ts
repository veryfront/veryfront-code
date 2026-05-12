import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  createAgUiChatUiChunkBrowserEncoder,
  createAgUiChatUiTrackedBrowserResponse,
  getAgUiChatUiMessageChunkMetadata,
  getAgUiChatUiMessageUsageMetadata,
  normalizeChatUiMessageChunkToAgUiRuntimeEvent,
} from "./ag-ui-chat-ui-chunk-browser-encoder.ts";

describe("agent/ag-ui-chat-ui-chunk-browser-encoder", () => {
  it("extracts usage and total token metadata", () => {
    assertEquals(
      getAgUiChatUiMessageUsageMetadata({
        usage: {
          inputTokens: 12,
          outputTokens: 8,
        },
      }),
      {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
    );

    assertEquals(
      getAgUiChatUiMessageUsageMetadata({
        usage: {
          outputTokens: 8,
        },
      }),
      {
        inputTokens: undefined,
        outputTokens: 8,
        totalTokens: 8,
      },
    );

    assertEquals(getAgUiChatUiMessageUsageMetadata(undefined), {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    });
  });

  it("extracts model, provider, usage, and finish reason from chat chunks", () => {
    const finishChunk: ChatUiMessageChunk = {
      type: "finish",
      finishReason: "stop",
      messageMetadata: {
        modelId: "custom/model",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
        },
      },
    };

    assertEquals(
      getAgUiChatUiMessageChunkMetadata(finishChunk, {
        resolveProvider: (modelId) => modelId === "custom/model" ? "custom-provider" : undefined,
      }),
      {
        provider: "custom-provider",
        model: "custom/model",
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        finishReason: "stop",
      },
    );
  });

  it("returns null when a non-finish chunk has no metadata", () => {
    assertEquals(
      getAgUiChatUiMessageChunkMetadata({ type: "text-delta", id: "msg-1", delta: "hello" }),
      null,
    );
  });

  it("normalizes chat chunks into AG-UI runtime events", () => {
    assertEquals(
      normalizeChatUiMessageChunkToAgUiRuntimeEvent({
        type: "start",
        messageId: "msg-1",
        messageMetadata: { modelId: "model-a" },
      }),
      {
        type: "message-start",
        messageId: "msg-1",
        messageMetadata: { modelId: "model-a" },
      },
    );

    assertEquals(normalizeChatUiMessageChunkToAgUiRuntimeEvent({ type: "start-step" }), {
      type: "step-start",
    });
    assertEquals(normalizeChatUiMessageChunkToAgUiRuntimeEvent({ type: "finish-step" }), {
      type: "step-end",
    });
    assertEquals(
      normalizeChatUiMessageChunkToAgUiRuntimeEvent({ type: "error", errorText: "boom" }),
      {
        type: "error",
        error: "boom",
      },
    );
  });

  it("creates a browser encoder for chat UI chunks", () => {
    const encoder = createAgUiChatUiChunkBrowserEncoder({
      modelId: "custom/model",
      resolveProvider: (modelId) => modelId === "custom/model" ? "custom-provider" : undefined,
    });

    const encodedStart = encoder.encode({
      type: "start",
      messageId: "msg-1",
      messageMetadata: {
        modelId: "custom/model",
        usage: {
          inputTokens: 1,
        },
      },
    });

    assertEquals(encodedStart, []);

    assertEquals(encoder.encode({ type: "text-delta", id: "msg-1", delta: "hello" }), [
      {
        event: "TextMessageStart",
        payload: {
          messageId: "msg-1",
          role: "assistant",
        },
      },
      {
        event: "TextMessageContent",
        payload: {
          messageId: "msg-1",
          delta: "hello",
        },
      },
    ]);

    assertEquals(
      encoder.finalize({
        text: "hello",
        messages: [{
          id: "msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
        }],
        toolCalls: [],
        status: "completed",
      }),
      [
        {
          event: "TextMessageEnd",
          payload: {
            messageId: "msg-1",
          },
        },
        {
          event: "RunFinished",
          payload: {
            metadata: {
              provider: "custom-provider",
              model: "custom/model",
              inputTokens: 1,
              totalTokens: 1,
            },
          },
        },
      ],
    );
  });

  it("creates a tracked browser response for chat UI chunks", async () => {
    const response = createAgUiChatUiTrackedBrowserResponse({
      agUiInput: {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messages: [],
        tools: [],
        context: [],
      },
      agentId: "agent-1",
      modelId: "custom/model",
      resolveProvider: (modelId) => modelId === "custom/model" ? "custom-provider" : undefined,
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "start",
              messageId: "msg-1",
              messageMetadata: { modelId: "custom/model" },
            };
            yield {
              type: "text-delta",
              id: "msg-1",
              delta: "hello",
            };
            yield {
              type: "finish",
              finishReason: "stop",
              messageMetadata: {
                modelId: "custom/model",
                usage: {
                  inputTokens: 2,
                  outputTokens: 3,
                },
              },
            };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
    });

    const text = await response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, '"model":"custom/model"');
    assertStringIncludes(text, '"provider":"custom-provider"');
    assertStringIncludes(text, '"inputTokens":2');
    assertStringIncludes(text, '"outputTokens":3');
    assertStringIncludes(text, '"totalTokens":5');
    assertStringIncludes(text, '"finishReason":"stop"');
  });
});
