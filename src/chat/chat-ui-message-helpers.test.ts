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

  it("preserves valid child-run audit metadata while dropping unknown fields", () => {
    assertEquals(
      normalizeChatMessageMetadata({
        childRunAudit: {
          status: "failed",
          description: "Delegate could not finish",
          steps: 3,
          durationMs: 1250,
          toolCalls: [{
            toolName: "web_search",
            toolCallId: "call-1",
            input: { query: "status" },
            ignored: true,
          }],
          toolResults: [{
            toolName: "web_search",
            toolCallId: "call-1",
            input: { query: "status" },
            output: { error: "timeout" },
            ignored: true,
          }],
          terminalErrorCode: "TIMEOUT",
          terminalErrorMessage: "Timed out",
          ignored: true,
        },
      }),
      {
        childRunAudit: {
          status: "failed",
          description: "Delegate could not finish",
          steps: 3,
          durationMs: 1250,
          toolCalls: [{
            toolName: "web_search",
            toolCallId: "call-1",
            input: { query: "status" },
          }],
          toolResults: [{
            toolName: "web_search",
            toolCallId: "call-1",
            input: { query: "status" },
            output: { error: "timeout" },
          }],
          terminalErrorCode: "TIMEOUT",
          terminalErrorMessage: "Timed out",
        },
      },
    );
  });

  it("drops non-finite, fractional, and negative usage metadata", () => {
    assertEquals(
      normalizeChatMessageMetadata({
        usage: {
          inputTokens: 10,
          outputTokens: -1,
          reasoningTokens: 1.5,
          cachedInputTokens: Number.NaN,
          cacheReadInputTokens: Number.POSITIVE_INFINITY,
        },
        costUsd: 0.25,
        providerCostUsd: -1,
        costCredits: Number.POSITIVE_INFINITY,
        childRunAudit: {
          status: "completed",
          steps: -1,
          durationMs: Number.NaN,
        },
      }),
      {
        usage: { inputTokens: 10 },
        costUsd: 0.25,
        childRunAudit: { status: "completed" },
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

  it("dedupes replayed text chunks that diverge after a shared prefix", async () => {
    const result = await collect(dedupeChatUiMessageChunks(toStream([
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Created the assistant." },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Created the " },
      { type: "text-delta", id: "msg-1", delta: "workflow." },
      { type: "text-end", id: "msg-1" },
    ])));

    assertEquals(result, [
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Created the assistant." },
      { type: "text-end", id: "msg-1" },
      { type: "text-start", id: "msg-1:replay:1" },
      { type: "text-delta", id: "msg-1:replay:1", delta: "Created the workflow." },
      { type: "text-end", id: "msg-1:replay:1" },
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
