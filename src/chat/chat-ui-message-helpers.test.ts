import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChatStreamChunkMessageMetadata,
  extractChatMessageMetadata,
  normalizeChatMessageMetadata,
  normalizeChatUiMessageChunk,
} from "./chat-ui-message-helpers.ts";

describe("chat/chat-ui-message-helpers", () => {
  it("normalizes hosted message metadata usage and known fields", () => {
    assertEquals(
      normalizeChatMessageMetadata({
        createdAt: "2026-04-23T00:00:00Z",
        agentId: "agent-1",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedInputTokens: 3,
          ignored: true,
        },
        unknown: true,
      }),
      {
        createdAt: "2026-04-23T00:00:00Z",
        agentId: "agent-1",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedInputTokens: 3,
        },
      },
    );
  });

  it("returns undefined when extracting empty metadata", () => {
    assertEquals(extractChatMessageMetadata(null), undefined);
    assertEquals(extractChatMessageMetadata({ ignored: true }), undefined);
  });

  it("builds stream chunk metadata from finish usage", () => {
    assertEquals(
      buildChatStreamChunkMessageMetadata({
        agentId: "agent-1",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        streamingMessageId: "msg-1",
        part: {
          type: "finish",
          totalUsage: {
            inputTokens: 4,
            outputTokens: 6,
          },
        },
      }),
      {
        agentId: "agent-1",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        streamingMessageId: "msg-1",
        usage: {
          inputTokens: 4,
          outputTokens: 6,
        },
      },
    );
  });

  it("normalizes lifecycle UI chunks onto canonical message metadata", () => {
    assertEquals(
      normalizeChatUiMessageChunk({
        type: "start",
        messageId: "msg-1",
        messageMetadata: {
          createdAt: "2026-04-23T00:00:00Z",
          usage: { inputTokens: 1 },
        },
      }),
      {
        type: "start",
        messageId: "msg-1",
        messageMetadata: {
          createdAt: "2026-04-23T00:00:00Z",
          usage: { inputTokens: 1 },
        },
      },
    );

    assertEquals(
      normalizeChatUiMessageChunk({
        type: "message-metadata",
        messageMetadata: { modelId: "openai/gpt-5.4", invalid: true },
      }),
      {
        type: "message-metadata",
        messageMetadata: { modelId: "openai/gpt-5.4" },
      },
    );
  });
});
