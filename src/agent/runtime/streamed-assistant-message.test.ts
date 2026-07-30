import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatStreamState } from "./chat-stream-handler.ts";
import { buildStreamedAssistantMessage } from "./streamed-assistant-message.ts";
import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";
import { getProviderReplayMessageParts } from "./provider-replay.ts";
import { createStreamState, processStream } from "./chat-stream-handler.ts";
import { createMockResult, createSSECollector } from "./chat-stream-handler.test-helpers.ts";

describe("agent/streamed-assistant-message", () => {
  it("builds an assistant message from completed stream state", () => {
    const state: ChatStreamState = {
      accumulatedText: "Final answer",
      reasoningParts: [
        { id: "reasoning_empty", text: "" },
        { id: "reasoning_text", text: "internal note", signature: "sig_1" },
        { id: "reasoning_redacted", text: "", redactedData: "redacted_1" },
      ],
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "call_1",
          {
            id: "call_1",
            name: "lookup",
            arguments: '{"query":"docs"}',
            inputAvailable: true,
          },
        ],
        [
          "call_2",
          {
            id: "call_2",
            name: "web_search",
            arguments: '{"q":"Veryfront"}',
            inputAvailable: true,
            providerExecuted: true,
          },
        ],
      ]),
      suppressedToolCalls: [],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_fixed",
      timestamp: 123,
    });

    assertEquals(message, {
      id: "msg_fixed",
      role: "assistant",
      timestamp: 123,
      parts: [
        { type: "reasoning", text: "internal note", signature: "sig_1" },
        { type: "reasoning", redactedData: "redacted_1" },
        { type: "text", text: "Final answer" },
        {
          type: "tool-lookup",
          toolCallId: "call_1",
          toolName: "lookup",
          args: { query: "docs" },
          inputText: '{"query":"docs"}',
        },
        {
          type: "tool-web_search",
          toolCallId: "call_2",
          toolName: "web_search",
          args: { q: "Veryfront" },
          inputText: '{"q":"Veryfront"}',
          providerExecuted: true,
        },
      ],
    });
  });

  it("omits recoverable placeholder tool parts when assistant text exists", () => {
    const state: ChatStreamState = {
      accumulatedText: "Created the Outlook assistant.",
      reasoningParts: [],
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "call_placeholder",
          {
            id: "call_placeholder",
            name: "studio_suggestions",
            arguments: "{}",
            inputAvailable: false,
          },
        ],
      ]),
      suppressedToolCalls: [],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_text_only",
      timestamp: 456,
    });

    assertEquals(message, {
      id: "msg_text_only",
      role: "assistant",
      timestamp: 456,
      parts: [
        { type: "text", text: "Created the Outlook assistant." },
      ],
    });
  });

  it("persists streamed provider blocks in exact arrival order", () => {
    const providerBlocks = [
      {
        type: "provider-block" as const,
        provider: "openai-responses" as const,
        block: {
          type: "tool_search_call",
          execution: "server",
          call_id: null,
          unknown: { keep: true },
        },
      },
      {
        type: "provider-block" as const,
        provider: "openai-responses" as const,
        block: {
          type: "tool_search_output",
          execution: "server",
          call_id: null,
          output: [{ type: "tool_reference", name: "lookup" }],
        },
      },
    ] satisfies RuntimeProviderBlock[];
    const state: ChatStreamState = {
      accumulatedText: "Found it.",
      reasoningParts: [],
      finishReason: "stop",
      toolCalls: new Map(),
      toolResults: [],
      providerBlocks,
      providerReplayOrder: [
        providerBlocks[0]!,
        { type: "text", text: "Found it." },
        providerBlocks[1]!,
      ],
      suppressedToolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_provider_blocks",
      timestamp: 789,
    });

    assertEquals(message.parts, [{ type: "text", text: "Found it." }]);
    assertEquals(getProviderReplayMessageParts(message), [
      providerBlocks[0]!,
      { type: "text", text: "Found it." },
      providerBlocks[1]!,
    ]);
    assertEquals(JSON.stringify(message).includes("provider-block"), false);
  });

  it("preserves provider block and signed reasoning interleaving in private replay", async () => {
    const providerBlocks = [
      {
        type: "provider-block" as const,
        provider: "openai-responses" as const,
        block: {
          type: "tool_search_call",
          execution: "server",
          call_id: null,
          unknown: { keep: true },
        },
      },
      {
        type: "provider-block" as const,
        provider: "openai-responses" as const,
        block: {
          type: "tool_search_output",
          execution: "server",
          call_id: null,
          output: [{ type: "tool_reference", name: "lookup" }],
        },
      },
    ] satisfies RuntimeProviderBlock[];
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    await processStream(
      createMockResult([
        providerBlocks[0]!,
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "Check the index." },
        { type: "reasoning-end", id: "reasoning-1", signature: "signed-reasoning-1" },
        providerBlocks[1]!,
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]),
      state,
      controller,
      encoder,
      "text-1",
    );

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_interleaved_reasoning",
      timestamp: 790,
    });

    const reasoningPart = {
      type: "reasoning" as const,
      text: "Check the index.",
      signature: "signed-reasoning-1",
    };
    assertEquals(message.parts, [reasoningPart]);
    assertEquals(getProviderReplayMessageParts(message), [
      providerBlocks[0]!,
      reasoningPart,
      providerBlocks[1]!,
    ]);
    assertEquals(JSON.stringify(message).includes("provider-block"), false);
  });

  it("persists a tool call recovered from parseable input at finish exactly once", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    await processStream(
      createMockResult([
        { type: "text-delta", text: "I will retrieve it." },
        { type: "tool-input-start", id: "call-finish", toolName: "retrieveEvidence" },
        { type: "tool-input-delta", id: "call-finish", delta: '{"uploadId":"upload-1"}' },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]),
      state,
      controller,
      encoder,
      "text-1",
    );

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_finish_recovery",
      timestamp: 791,
    });

    assertEquals(message.parts, [
      { type: "text", text: "I will retrieve it." },
      {
        type: "tool-retrieveEvidence",
        toolCallId: "call-finish",
        toolName: "retrieveEvidence",
        args: { uploadId: "upload-1" },
        inputText: '{"uploadId":"upload-1"}',
      },
    ]);
    assertEquals(
      state.providerReplayOrder?.filter((part) =>
        part.type === "tool-call" && part.toolCallId === "call-finish"
      ).length,
      1,
    );
    assertEquals(getProviderReplayMessageParts(message), message.parts);
  });

  it("persists a tool call synthesized from a raw result at its first lifecycle position", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    await processStream(
      createMockResult([
        { type: "reasoning-start", id: "reasoning-raw" },
        { type: "reasoning-delta", id: "reasoning-raw", delta: "Search first." },
        {
          type: "tool-result",
          toolCallId: "call-raw-result",
          toolName: "lookup",
          input: { query: "Veryfront" },
          output: { ok: true },
        },
        { type: "text-delta", text: "Found it." },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]),
      state,
      controller,
      encoder,
      "text-1",
    );

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_raw_result",
      timestamp: 792,
    });

    assertEquals(message.parts, [
      { type: "reasoning", text: "Search first." },
      {
        type: "tool-lookup",
        toolCallId: "call-raw-result",
        toolName: "lookup",
        args: { query: "Veryfront" },
        inputText: '{"query":"Veryfront"}',
      },
      { type: "text", text: "Found it." },
    ]);
    assertEquals(
      state.providerReplayOrder?.filter((part) =>
        part.type === "tool-call" && part.toolCallId === "call-raw-result"
      ).length,
      1,
    );
    assertEquals(getProviderReplayMessageParts(message), message.parts);
  });
});
