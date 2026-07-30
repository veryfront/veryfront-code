import { assertEquals } from "@std/assert";
import {
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT,
  applyProviderReplayCheckpoint,
  applyProviderReplayCheckpoints,
  createProviderReplayCheckpointEvent,
  getProviderReplayMessageParts,
  parseProviderReplayCheckpoint,
  parseProviderReplayCheckpoints,
  resolveProviderReplayProvider,
  retainCompatibleProviderReplay,
} from "./provider-replay.ts";

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
  assertEquals(resolveProviderReplayProvider("openai/gpt-5.4"), "openai-responses");
  assertEquals(resolveProviderReplayProvider("anthropic/claude-3-7-sonnet"), undefined);
  assertEquals(resolveProviderReplayProvider("openai/gpt-5.3"), undefined);
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
