import { assertEquals } from "@std/assert";
import {
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT,
  applyProviderReplayCheckpoint,
  applyProviderReplayCheckpoints,
  createProviderReplayCheckpointEvent,
  getNativeToolSearchSelectedNamesBeforeCall,
  getProviderReplayMessageParts,
  parseProviderReplayCheckpoint,
  parseProviderReplayCheckpoints,
  resolveProviderReplayProvider,
  retainCompatibleProviderReplay,
} from "./provider-replay.ts";

Deno.test("native tool-search authority requires paired provider selection before exact call", () => {
  const deferred = new Set(["get_release"]);
  const openAIParts = [
    {
      type: "provider-block",
      provider: "openai-responses",
      block: {
        type: "tool_search_call",
        execution: "server",
        call_id: "search-1",
        status: "completed",
      },
    },
    {
      type: "provider-block",
      provider: "openai-responses",
      block: {
        type: "tool_search_output",
        execution: "server",
        call_id: "search-1",
        status: "completed",
        tools: [{ type: "function", name: "get_release" }],
      },
    },
    { type: "tool-call", toolCallId: "release-1", toolName: "get_release" },
  ];
  assertEquals(
    getNativeToolSearchSelectedNamesBeforeCall({
      provider: "openai-responses",
      parts: openAIParts,
      toolCallId: "release-1",
      toolName: "get_release",
      authorizedDeferredToolNames: deferred,
    }),
    new Set(["get_release"]),
  );
  assertEquals(
    getNativeToolSearchSelectedNamesBeforeCall({
      provider: "openai-responses",
      parts: [...openAIParts].reverse(),
      toolCallId: "release-1",
      toolName: "get_release",
      authorizedDeferredToolNames: deferred,
    }),
    new Set(),
  );
  assertEquals(
    getNativeToolSearchSelectedNamesBeforeCall({
      provider: "openai-responses",
      parts: openAIParts,
      toolCallId: "release-1",
      toolName: "get_release",
      authorizedDeferredToolNames: new Set(),
    }),
    new Set(),
  );
  for (
    const invalidParts of [
      [
        openAIParts[0],
        {
          ...(openAIParts[1] as Record<string, unknown>),
          provider: "anthropic",
        },
        openAIParts[2],
      ],
      [
        openAIParts[0],
        {
          ...(openAIParts[1] as Record<string, unknown>),
          block: {
            ...((openAIParts[1] as { block: Record<string, unknown> }).block),
            status: "failed",
          },
        },
        openAIParts[2],
      ],
      [
        openAIParts[0],
        {
          ...(openAIParts[1] as Record<string, unknown>),
          block: {
            ...((openAIParts[1] as { block: Record<string, unknown> }).block),
            call_id: "other-search",
          },
        },
        openAIParts[2],
      ],
      [
        openAIParts[0],
        openAIParts[1],
        {
          ...(openAIParts[0] as Record<string, unknown>),
          block: {
            ...((openAIParts[0] as { block: Record<string, unknown> }).block),
            call_id: "search-2",
          },
        },
        openAIParts[2],
      ],
    ]
  ) {
    assertEquals(
      getNativeToolSearchSelectedNamesBeforeCall({
        provider: "openai-responses",
        parts: invalidParts,
        toolCallId: "release-1",
        toolName: "get_release",
        authorizedDeferredToolNames: deferred,
      }),
      undefined,
    );
  }
});

Deno.test("Anthropic native tool-search authority requires matching search result references", () => {
  const parts = [
    {
      type: "provider-block",
      provider: "anthropic",
      block: {
        type: "server_tool_use",
        id: "search-1",
        name: "tool_search_tool_regex",
        input: { query: "release" },
      },
    },
    {
      type: "provider-block",
      provider: "anthropic",
      block: {
        type: "tool_search_tool_result",
        tool_use_id: "search-1",
        content: {
          type: "tool_search_tool_search_result",
          tool_references: [{ type: "tool_reference", tool_name: "get_release" }],
        },
      },
    },
    { type: "tool-call", toolCallId: "release-1" },
  ];
  assertEquals(
    getNativeToolSearchSelectedNamesBeforeCall({
      provider: "anthropic",
      parts,
      toolCallId: "release-1",
      toolName: "get_release",
      authorizedDeferredToolNames: new Set(["get_release"]),
    }),
    new Set(["get_release"]),
  );
  assertEquals(
    getNativeToolSearchSelectedNamesBeforeCall({
      provider: "anthropic",
      parts: [
        parts[0],
        {
          ...parts[1],
          block: { ...(parts[1] as { block: object }).block, tool_use_id: "other-search" },
        },
        parts[2],
      ],
      toolCallId: "release-1",
      toolName: "get_release",
      authorizedDeferredToolNames: new Set(["get_release"]),
    }),
    undefined,
  );
  assertEquals(
    getNativeToolSearchSelectedNamesBeforeCall({
      provider: "anthropic",
      parts: [
        parts[0],
        {
          ...parts[1],
          block: {
            ...(parts[1] as { block: object }).block,
            content: {
              type: "tool_search_tool_result_error",
              error_code: "invalid_pattern",
            },
          },
        },
        parts[2],
      ],
      toolCallId: "release-1",
      toolName: "get_release",
      authorizedDeferredToolNames: new Set(["get_release"]),
    }),
    undefined,
  );
});

const anthropicBlocks = [
  {
    type: "provider-block" as const,
    provider: "anthropic" as const,
    block: {
      type: "server_tool_use" as const,
      id: "srvtoolu_1",
      name: "tool_search",
      input: { query: "deploy" },
      raw_extension: { preserved: true },
    },
  },
  {
    type: "provider-block" as const,
    provider: "anthropic" as const,
    block: {
      type: "tool_search_tool_result" as const,
      tool_use_id: "srvtoolu_1",
      content: [{ type: "tool_reference", tool_name: "deploy_release" }],
    },
  },
];

Deno.test("provider replay checkpoint preserves exact ordered raw blocks", () => {
  const checkpoint = parseProviderReplayCheckpoint({
    version: 1,
    messageId: "assistant-1",
    provider: "anthropic",
    providerBlocks: anthropicBlocks,
    providerBlockPositions: [0, 2],
    totalPartCount: 3,
  });

  assertEquals(checkpoint, {
    version: 1,
    messageId: "assistant-1",
    provider: "anthropic",
    providerBlocks: anthropicBlocks,
    providerBlockPositions: [0, 2],
    totalPartCount: 3,
  });
  assertEquals(createProviderReplayCheckpointEvent(checkpoint!), {
    type: AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT,
    ...checkpoint,
  });
});

Deno.test("provider replay checkpoint rejects mixed-provider and malformed blocks", () => {
  assertEquals(
    parseProviderReplayCheckpoint({
      version: 1,
      messageId: "assistant-1",
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "openai-responses",
        block: { type: "tool_search_call" },
      }],
      providerBlockPositions: [0],
      totalPartCount: 1,
    }),
    undefined,
  );
  assertEquals(
    parseProviderReplayCheckpoint({
      version: 1,
      messageId: "assistant-1",
      provider: "anthropic",
      providerBlocks: [],
      providerBlockPositions: [],
      totalPartCount: 0,
    }),
    undefined,
  );
});

Deno.test("provider replay merges only into exact assistant and active provider", () => {
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "hi" }],
      timestamp: 1,
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "done" }],
      timestamp: 2,
    },
  ];
  const checkpoint = parseProviderReplayCheckpoint({
    version: 1,
    messageId: "assistant-1",
    provider: "anthropic",
    providerBlocks: anthropicBlocks,
    providerBlockPositions: [0, 2],
    totalPartCount: 3,
  });

  assertEquals(
    getProviderReplayMessageParts(
      applyProviderReplayCheckpoint(messages, checkpoint, "anthropic")[1]!,
    ),
    [anthropicBlocks[0]!, { type: "text", text: "done" }, anthropicBlocks[1]!],
  );
  assertEquals(applyProviderReplayCheckpoint(messages, checkpoint, "openai-responses"), messages);
  assertEquals(
    applyProviderReplayCheckpoint(
      messages,
      checkpoint ? { ...checkpoint, messageId: "user-1" } : undefined,
      "anthropic",
    ),
    messages,
  );
});

Deno.test("provider replay injection preserves every original public assistant part", () => {
  const publicParts = [
    {
      type: "tool-get_release" as const,
      toolCallId: "call-1",
      toolName: "get_release",
      args: { id: "rel-1" },
    },
    {
      type: "tool-result" as const,
      toolCallId: "call-1",
      toolName: "get_release",
      result: { id: "rel-1" },
    },
    { type: "reasoning" as const, text: "private reasoning" },
    { type: "text" as const, text: "done" },
  ];
  const messages = [{
    id: "assistant-mixed",
    role: "assistant" as const,
    parts: publicParts,
    timestamp: 1,
  }];
  const checkpoint = parseProviderReplayCheckpoint({
    version: 1,
    messageId: "assistant-mixed",
    provider: "anthropic",
    providerBlocks: anthropicBlocks,
    providerBlockPositions: [0, 4],
    totalPartCount: 6,
  });

  const restored = applyProviderReplayCheckpoint(messages, checkpoint, "anthropic")[0]!;

  assertEquals(restored.parts, publicParts);
  assertEquals(getProviderReplayMessageParts(restored), [
    anthropicBlocks[0]!,
    publicParts[0]!,
    publicParts[1]!,
    publicParts[2]!,
    anthropicBlocks[1]!,
    publicParts[3]!,
  ]);
});

Deno.test("provider replay parses and restores an ordered unique checkpoint set", () => {
  const checkpoints = parseProviderReplayCheckpoints([
    {
      version: 1,
      messageId: "assistant-1",
      provider: "anthropic",
      providerBlocks: anthropicBlocks,
      providerBlockPositions: [0, 2],
      totalPartCount: 3,
    },
    {
      version: 1,
      messageId: "assistant-2",
      provider: "anthropic",
      providerBlocks: [anthropicBlocks[0]!],
      providerBlockPositions: [1],
      totalPartCount: 2,
    },
  ]);
  const messages = [
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "one" }],
      timestamp: 1,
    },
    {
      id: "assistant-2",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "two" }],
      timestamp: 2,
    },
  ];

  assertEquals(
    applyProviderReplayCheckpoints(messages, checkpoints ?? [], "anthropic").map(
      getProviderReplayMessageParts,
    ),
    [
      [anthropicBlocks[0]!, { type: "text", text: "one" }, anthropicBlocks[1]!],
      [{ type: "text", text: "two" }, anthropicBlocks[0]!],
    ],
  );
  assertEquals(
    parseProviderReplayCheckpoints([
      {
        version: 1,
        messageId: "assistant-1",
        provider: "anthropic",
        providerBlocks: anthropicBlocks,
        providerBlockPositions: [0, 2],
        totalPartCount: 3,
      },
      {
        version: 1,
        messageId: "assistant-1",
        provider: "anthropic",
        providerBlocks: anthropicBlocks,
        providerBlockPositions: [0, 2],
        totalPartCount: 3,
      },
    ]),
    undefined,
  );
});

Deno.test("provider replay provider resolution is explicit and fail closed", () => {
  assertEquals(resolveProviderReplayProvider("anthropic/claude-sonnet-4-6"), "anthropic");
  for (
    const model of [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-pro",
      "gpt-5.5",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]
  ) {
    assertEquals(resolveProviderReplayProvider(`openai/${model}`), "openai-responses");
    assertEquals(
      resolveProviderReplayProvider(`openai/${model}-2026-07-30`),
      "openai-responses",
    );
  }
  assertEquals(resolveProviderReplayProvider("anthropic/claude-3-7-sonnet"), undefined);
  for (
    const model of [
      "gpt-5.3",
      "gpt-5.4-nano",
      "gpt-5.5-pro",
      "gpt-5.6-codex",
      "gpt-5.6-arbitrary",
      "gpt-5.6-sol-codex",
      "gpt-5.6-sol-2026-07",
      "gpt-5.6-sol-2026-07-30-extra",
    ]
  ) {
    assertEquals(resolveProviderReplayProvider(`openai/${model}`), undefined);
  }
  assertEquals(resolveProviderReplayProvider("veryfront-cloud/openai/gpt-5.4"), undefined);
  assertEquals(
    resolveProviderReplayProvider("veryfront-cloud/anthropic/claude-sonnet-4-6"),
    undefined,
  );
  assertEquals(resolveProviderReplayProvider("google/gemini-3"), undefined);
});

Deno.test("provider replay is removed on unsupported or proxied model switches", () => {
  const message = {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "done" }],
    timestamp: 1,
  };
  const replayed = applyProviderReplayCheckpoint(
    [message],
    {
      version: 1,
      messageId: message.id,
      provider: "anthropic",
      providerBlocks: anthropicBlocks,
      providerBlockPositions: [0, 2],
      totalPartCount: 3,
    },
    "anthropic",
  );

  assertEquals(
    getProviderReplayMessageParts(
      retainCompatibleProviderReplay(replayed, "anthropic/claude-sonnet-4-6")[0]!,
    ),
    [anthropicBlocks[0]!, message.parts[0]!, anthropicBlocks[1]!],
  );
  for (
    const model of [
      "anthropic/claude-3-7-sonnet",
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4",
    ]
  ) {
    assertEquals(
      getProviderReplayMessageParts(retainCompatibleProviderReplay(replayed, model)[0]!),
      message.parts,
    );
  }
});
