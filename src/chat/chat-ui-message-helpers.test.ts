import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChatStreamChunkMessageMetadata,
  dedupeChatUiMessageChunks,
  extractChatMessageMetadata,
  normalizeChatMessageMetadata,
  normalizeChatUiMessageChunk,
  normalizeChatUiMessageStream,
} from "./chat-ui-message-helpers.ts";

describe("chat/chat-ui-message-helpers", () => {
  async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    return items;
  }

  async function* toStream<T>(chunks: T[]): AsyncIterable<T> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  it("normalizes hosted message metadata usage and known fields", () => {
    assertEquals(
      normalizeChatMessageMetadata({
        createdAt: "2026-04-23T00:00:00Z",
        agentId: "agent-1",
        agentName: "Support Agent",
        agent_avatar_url: "https://cdn.example.com/agents/support.svg",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedInputTokens: 3,
          cacheCreationInputTokens: 7,
          cacheReadInputTokens: 3,
          ignored: true,
        },
        unknown: true,
      }),
      {
        createdAt: "2026-04-23T00:00:00Z",
        agentId: "agent-1",
        agentName: "Support Agent",
        agentAvatarUrl: "https://cdn.example.com/agents/support.svg",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedInputTokens: 3,
          cacheCreationInputTokens: 7,
          cacheReadInputTokens: 3,
        },
      },
    );
  });

  it("returns undefined when extracting empty metadata", () => {
    assertEquals(extractChatMessageMetadata(null), undefined);
    assertEquals(extractChatMessageMetadata({ ignored: true }), undefined);
  });

  it("drops unsafe and non-finite metadata at the stream boundary", () => {
    assertEquals(
      normalizeChatMessageMetadata({
        agentName: "  Support Agent  ",
        agentAvatarUrl: "javascript:alert(1)",
        runId: "  run-1  ",
        usage: {
          inputTokens: Number.POSITIVE_INFINITY,
          outputTokens: -1,
          reasoningTokens: 3,
        },
        costUsd: Number.NaN,
        costCredits: -2,
      }),
      {
        agentName: "Support Agent",
        runId: "run-1",
        usage: { reasoningTokens: 3 },
      },
    );
  });

  it("accepts fractional costs but not fractional token counts", () => {
    assertEquals(
      normalizeChatMessageMetadata({
        usage: { inputTokens: 1.5, outputTokens: 2 },
        billableInputTokens: 3.5,
        costUsd: 0.125,
      }),
      {
        usage: { outputTokens: 2 },
        costUsd: 0.125,
      },
    );
  });

  it("does not execute metadata accessors at the stream boundary", () => {
    let getterCalls = 0;
    const metadata: Record<string, unknown> = {};
    for (const key of ["agentName", "usage", "costUsd"]) {
      Object.defineProperty(metadata, key, {
        enumerable: true,
        get() {
          getterCalls += 1;
          return key === "usage" ? { inputTokens: 1 } : "unsafe";
        },
      });
    }

    assertEquals(normalizeChatMessageMetadata(metadata), {});
    assertEquals(getterCalls, 0);
  });

  it("builds stream chunk metadata from finish usage", () => {
    assertEquals(
      buildChatStreamChunkMessageMetadata({
        agentId: "agent-1",
        agentName: "Support Agent",
        agentAvatarUrl: "https://cdn.example.com/agents/support.svg",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        streamingMessageId: "msg-1",
        part: {
          type: "finish",
          totalUsage: {
            inputTokens: 4,
            outputTokens: 6,
            inputTokenDetails: {
              cacheWriteTokens: 2,
              cacheReadTokens: 3,
            },
            outputTokenDetails: {
              reasoningTokens: 1,
            },
            costCredits: 0.123,
            costSource: "gateway",
          },
        },
      }),
      {
        agentId: "agent-1",
        agentName: "Support Agent",
        agentAvatarUrl: "https://cdn.example.com/agents/support.svg",
        modelId: "openai/gpt-5.4",
        runId: "run-1",
        streamingMessageId: "msg-1",
        usage: {
          inputTokens: 4,
          outputTokens: 6,
          reasoningTokens: 1,
          cachedInputTokens: 3,
          cacheCreationInputTokens: 2,
          cacheReadInputTokens: 3,
        },
        costCredits: 0.123,
        costSource: "gateway",
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

  it("dedupes replayed text chunks without losing new content", async () => {
    const result = await collect(dedupeChatUiMessageChunks(toStream([
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-delta", id: "msg-1", delta: " world" },
      { type: "text-end", id: "msg-1" },
    ])));

    assertEquals(result, [
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-delta", id: "msg-1", delta: " world" },
      { type: "text-end", id: "msg-1" },
    ]);
  });

  it("does not emit a second end marker when a completed block is replayed", async () => {
    const result = await collect(dedupeChatUiMessageChunks(toStream([
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-end", id: "msg-1" },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-end", id: "msg-1" },
    ])));

    assertEquals(result, [
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-end", id: "msg-1" },
    ]);
  });

  it("normalizes a hosted UI stream with metadata and replay dedupe", async () => {
    const result = await collect(normalizeChatUiMessageStream(toStream([
      { type: "start", messageId: "msg-1", messageMetadata: { agentId: "agent-1" } },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-delta", id: "msg-1", delta: " world" },
      { type: "text-end", id: "msg-1" },
      { type: "finish", finishReason: "stop", messageMetadata: { usage: { inputTokens: 1 } } },
    ])));

    assertEquals(result, [
      { type: "start", messageId: "msg-1", messageMetadata: { agentId: "agent-1" } },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-delta", id: "msg-1", delta: " world" },
      { type: "text-end", id: "msg-1" },
      { type: "finish", finishReason: "stop", messageMetadata: { usage: { inputTokens: 1 } } },
    ]);
  });
});
