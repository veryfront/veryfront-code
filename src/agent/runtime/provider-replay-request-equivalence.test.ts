import { buildAnthropicMessagesRequest } from "@veryfront/ext-llm-anthropic/testing";
import { buildOpenAIResponsesRequest } from "@veryfront/ext-llm-openai/testing";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";
import type { AgentRuntimeMessage } from "./message-adapter.ts";
import { applyProviderReplayCheckpoints, attachProviderReplaySidecar } from "./provider-replay.ts";
import { convertToTextGenerationRuntimeRequestMessages } from "./text-generation-runtime-message-converter.ts";

const warnings = { push() {}, drain: () => [] };

function toProviderPrompt(messages: AgentRuntimeMessage[]) {
  return convertToTextGenerationRuntimeRequestMessages(messages).map((message) =>
    message.role === "user" && typeof message.content === "string"
      ? { ...message, content: [{ type: "text" as const, text: message.content }] }
      : message
  );
}

function createMessages(
  providerBlocks: RuntimeProviderBlock[],
  includeProviderBlocks: boolean,
): AgentRuntimeMessage[] {
  const assistant: AgentRuntimeMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: "Verified the release lookup plan.",
        signature: "signed-reasoning-1",
      },
      {
        type: "tool-get_release",
        toolCallId: "framework-call-1",
        toolName: "get_release",
        args: { releaseId: "rel-1" },
      },
      {
        type: "tool-result",
        toolCallId: "framework-call-1",
        toolName: "get_release",
        result: { id: "rel-1", status: "ready" },
      },
      { type: "text", text: "I found the matching tool." },
    ],
    timestamp: 2,
  };
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Find release tools" }],
      timestamp: 1,
    },
    includeProviderBlocks
      ? attachProviderReplaySidecar(assistant, {
        providerBlocks,
        providerBlockPositions: [0, 4],
      })
      : assistant,
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Continue" }],
      timestamp: 3,
    },
  ];
}

describe("provider replay request equivalence", () => {
  it("keeps restarted Anthropic requests byte-equivalent to uninterrupted replay", () => {
    const providerBlocks: RuntimeProviderBlock[] = [
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "server_tool_use",
          id: "srvtoolu_1",
          name: "tool_search",
          input: { query: "release" },
          provider_extension: { exact: true },
        },
      },
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "tool_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [{ type: "tool_reference", tool_name: "get_release" }],
        },
      },
    ];
    const uninterrupted = toProviderPrompt(createMessages(providerBlocks, true));
    const restarted = toProviderPrompt(
      applyProviderReplayCheckpoints(
        createMessages(providerBlocks, false),
        [{
          version: 1,
          messageId: "assistant-1",
          provider: "anthropic",
          providerBlocks,
          providerBlockPositions: [0, 4],
          totalPartCount: 6,
        }],
        "anthropic",
      ),
    );

    const uninterruptedBody = buildAnthropicMessagesRequest(
      "claude-opus-4-6",
      "anthropic",
      { prompt: uninterrupted } as never,
      false,
      warnings,
    );
    const restartedBody = buildAnthropicMessagesRequest(
      "claude-opus-4-6",
      "anthropic",
      { prompt: restarted } as never,
      false,
      warnings,
    );

    assertEquals(JSON.stringify(restartedBody), JSON.stringify(uninterruptedBody));
    assertEquals(JSON.stringify(restartedBody).includes("signed-reasoning-1"), true);
  });

  it("keeps restarted OpenAI Responses requests byte-equivalent to uninterrupted replay", () => {
    const providerBlocks: RuntimeProviderBlock[] = [
      {
        type: "provider-block",
        provider: "openai-responses",
        block: {
          type: "tool_search_call",
          execution: "server",
          call_id: null,
          status: "completed",
          arguments: { query: "release" },
          provider_extension: { exact: true },
        },
      },
      {
        type: "provider-block",
        provider: "openai-responses",
        block: {
          type: "tool_search_output",
          execution: "server",
          call_id: null,
          status: "completed",
          tools: [{ type: "function", name: "get_release" }],
        },
      },
    ];
    const uninterrupted = toProviderPrompt(createMessages(providerBlocks, true));
    const restarted = toProviderPrompt(
      applyProviderReplayCheckpoints(
        createMessages(providerBlocks, false),
        [{
          version: 1,
          messageId: "assistant-1",
          provider: "openai-responses",
          providerBlocks,
          providerBlockPositions: [0, 4],
          totalPartCount: 6,
        }],
        "openai-responses",
      ),
    );

    const uninterruptedBody = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      { prompt: uninterrupted } as never,
      false,
      warnings,
    );
    const restartedBody = buildOpenAIResponsesRequest(
      "gpt-5.4",
      "openai",
      { prompt: restarted } as never,
      false,
      warnings,
    );

    assertEquals(JSON.stringify(restartedBody), JSON.stringify(uninterruptedBody));
    assertEquals(JSON.stringify(restartedBody).includes("signed-reasoning-1"), true);
  });
});
