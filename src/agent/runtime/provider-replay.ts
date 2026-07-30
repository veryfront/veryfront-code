import type { ConversationRunEvent } from "../conversation/run-events.ts";
import type { AgentRuntimeMessage } from "./message-adapter.ts";
import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";
import type { Message, MessagePart } from "../types.ts";

export const AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT = "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT" as const;

export type ProviderReplayProvider = RuntimeProviderBlock["provider"];

/** Private cumulative provider replay state for one durable assistant message. */
export type ProviderReplayCheckpoint = {
  version: 1;
  messageId: string;
  provider: ProviderReplayProvider;
  providerBlocks: RuntimeProviderBlock[];
  /** Absolute indexes in the provider-visible assistant sequence, including private blocks. */
  providerBlockPositions: number[];
  /** Provider-visible assistant part count, including private blocks. */
  totalPartCount: number;
};

export type ProviderReplayCheckpointEvent =
  & ConversationRunEvent
  & ProviderReplayCheckpoint
  & {
    type: typeof AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT;
  };

export type ProviderReplayCheckpoints = ProviderReplayCheckpoint[];

const PROVIDER_REPLAY_SIDECAR = Symbol("veryfront.providerReplaySidecar");

type ProviderReplaySidecar = {
  providerBlocks: RuntimeProviderBlock[];
  providerBlockPositions: number[];
};

export type ProviderReplayMessagePart = MessagePart | RuntimeProviderBlock;

type ProviderReplayMessage = Message & {
  [PROVIDER_REPLAY_SIDECAR]?: ProviderReplaySidecar;
};

const ANTHROPIC_NATIVE_TOOL_SEARCH_MODEL_PREFIXES = [
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;
const OPENAI_NATIVE_TOOL_SEARCH_MODEL_IDS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProviderReplayProvider(value: unknown): value is ProviderReplayProvider {
  return value === "anthropic" || value === "openai-responses";
}

function isAnthropicProviderBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "server_tool_use") {
    return typeof value.id === "string" &&
      value.id.length > 0 &&
      typeof value.name === "string" &&
      value.name.length > 0 &&
      Object.hasOwn(value, "input");
  }
  return value.type === "tool_search_tool_result" &&
    typeof value.tool_use_id === "string" &&
    value.tool_use_id.length > 0 &&
    Object.hasOwn(value, "content");
}

function isOpenAIProviderBlock(value: unknown): boolean {
  return isRecord(value) &&
    (value.type === "tool_search_call" || value.type === "tool_search_output");
}

function isRuntimeProviderBlock(
  value: unknown,
  provider: ProviderReplayProvider,
): value is RuntimeProviderBlock {
  if (
    !isRecord(value) ||
    value.type !== "provider-block" ||
    value.provider !== provider
  ) {
    return false;
  }
  return provider === "anthropic"
    ? isAnthropicProviderBlock(value.block)
    : isOpenAIProviderBlock(value.block);
}

/** Resolve private replay only for the exact direct transports with native tool search. */
export function resolveProviderReplayProvider(
  model: string | undefined,
): ProviderReplayProvider | undefined {
  if (!model) return undefined;
  const parts = model.trim().toLowerCase().split("/");
  const provider = parts[0];
  if (provider === "veryfront-cloud") return undefined;
  const modelId = parts.slice(1).join("/");
  const openAIBaseModelId = modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (
    provider === "anthropic" &&
    ANTHROPIC_NATIVE_TOOL_SEARCH_MODEL_PREFIXES.some((prefix) =>
      modelId === prefix || modelId.startsWith(`${prefix}-`)
    )
  ) {
    return "anthropic";
  }
  if (
    provider === "openai" &&
    OPENAI_NATIVE_TOOL_SEARCH_MODEL_IDS.some((supportedModelId) =>
      openAIBaseModelId === supportedModelId
    )
  ) {
    return "openai-responses";
  }
  return undefined;
}

/** Parse an authenticated server checkpoint without trusting its shape. */
export function parseProviderReplayCheckpoint(
  value: unknown,
): ProviderReplayCheckpoint | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.messageId !== "string" ||
    value.messageId.length === 0 ||
    !isProviderReplayProvider(value.provider) ||
    !Array.isArray(value.providerBlocks) ||
    value.providerBlocks.length === 0 ||
    !Array.isArray(value.providerBlockPositions) ||
    value.providerBlockPositions.length !== value.providerBlocks.length ||
    typeof value.totalPartCount !== "number" ||
    !Number.isSafeInteger(value.totalPartCount)
  ) {
    return undefined;
  }
  const providerBlockPositions = value.providerBlockPositions;
  const totalPartCount = value.totalPartCount;
  if (
    totalPartCount < value.providerBlocks.length ||
    totalPartCount > 10_000 ||
    !providerBlockPositions.every((position, index) =>
      Number.isSafeInteger(position) &&
      position >= 0 &&
      position < totalPartCount &&
      (index === 0 || position > providerBlockPositions[index - 1])
    )
  ) {
    return undefined;
  }
  const provider = value.provider;
  if (!value.providerBlocks.every((block) => isRuntimeProviderBlock(block, provider))) {
    return undefined;
  }

  return {
    version: 1,
    messageId: value.messageId,
    provider,
    providerBlocks: [...value.providerBlocks],
    providerBlockPositions: [...providerBlockPositions],
    totalPartCount,
  };
}

/** Parse the authenticated, ordered replay history with one checkpoint per message. */
export function parseProviderReplayCheckpoints(
  value: unknown,
): ProviderReplayCheckpoints | undefined {
  if (!Array.isArray(value)) return undefined;
  const checkpoints: ProviderReplayCheckpoint[] = [];
  const messageIds = new Set<string>();
  for (const candidate of value) {
    const checkpoint = parseProviderReplayCheckpoint(candidate);
    if (!checkpoint || messageIds.has(checkpoint.messageId)) return undefined;
    messageIds.add(checkpoint.messageId);
    checkpoints.push(checkpoint);
  }
  return checkpoints;
}

/** Create the exact-run event consumed by the authenticated API durable store. */
export function createProviderReplayCheckpointEvent(
  checkpoint: ProviderReplayCheckpoint,
): ProviderReplayCheckpointEvent {
  return {
    type: AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT,
    ...checkpoint,
  };
}

/** Merge trusted replay state only into its exact matching assistant message. */
export function applyProviderReplayCheckpoint(
  messages: readonly AgentRuntimeMessage[],
  checkpoint: ProviderReplayCheckpoint | undefined,
  activeProvider: ProviderReplayProvider | undefined,
): AgentRuntimeMessage[] {
  if (!checkpoint || checkpoint.provider !== activeProvider) {
    return [...messages];
  }

  const targetIndex = messages.findIndex((message) =>
    message.id === checkpoint.messageId && message.role === "assistant"
  );
  if (targetIndex < 0) return [...messages];
  const target = messages[targetIndex]!;
  const totalPartCount = target.parts.length + checkpoint.providerBlocks.length;
  if (checkpoint.totalPartCount !== totalPartCount) {
    return [...messages];
  }

  return messages.map((message, index) =>
    index === targetIndex ? attachProviderReplaySidecar(message, checkpoint) : message
  );
}

/** Merge ordered trusted checkpoints into exact matching assistant messages. */
export function applyProviderReplayCheckpoints(
  messages: readonly AgentRuntimeMessage[],
  checkpoints: readonly ProviderReplayCheckpoint[],
  activeProvider: ProviderReplayProvider | undefined,
): AgentRuntimeMessage[] {
  return checkpoints.reduce(
    (current, checkpoint) => applyProviderReplayCheckpoint(current, checkpoint, activeProvider),
    [...messages],
  );
}

/** Attach private provider replay state without widening public MessagePart. */
export function attachProviderReplaySidecar<T extends Message>(
  message: T,
  checkpoint: Pick<
    ProviderReplayCheckpoint,
    "providerBlocks" | "providerBlockPositions"
  >,
): T {
  return {
    ...message,
    [PROVIDER_REPLAY_SIDECAR]: {
      providerBlocks: [...checkpoint.providerBlocks],
      providerBlockPositions: [...checkpoint.providerBlockPositions],
    },
  };
}

/** Return private provider replay state from a trusted in-process message. */
export function getProviderReplaySidecar(
  message: Message,
): ProviderReplaySidecar | undefined {
  return (message as ProviderReplayMessage)[PROVIDER_REPLAY_SIDECAR];
}

/** Drop stale private replay when the next request cannot use the same native transport. */
export function retainCompatibleProviderReplay<T extends Message>(
  messages: readonly T[],
  model: string | undefined,
): T[] {
  const activeProvider = resolveProviderReplayProvider(model);
  return messages.map((message) => {
    const sidecar = getProviderReplaySidecar(message);
    if (
      !sidecar ||
      (
        activeProvider !== undefined &&
        sidecar.providerBlocks.every((block) => block.provider === activeProvider)
      )
    ) {
      return message;
    }
    const clone = { ...message } as ProviderReplayMessage;
    delete clone[PROVIDER_REPLAY_SIDECAR];
    return clone as T;
  });
}

/** Inject private blocks without dropping or reordering any public assistant part. */
export function getProviderReplayMessageParts(
  message: Message,
): ProviderReplayMessagePart[] {
  const sidecar = getProviderReplaySidecar(message);
  if (!sidecar) return [...message.parts];

  const blocksByPosition = new Map(
    sidecar.providerBlockPositions.map((position, index) => [
      position,
      sidecar.providerBlocks[index]!,
    ]),
  );
  const totalPartCount = message.parts.length + sidecar.providerBlocks.length;
  const parts: ProviderReplayMessagePart[] = [];
  let publicPartIndex = 0;
  for (let position = 0; position < totalPartCount; position++) {
    const providerBlock = blocksByPosition.get(position);
    if (providerBlock) {
      parts.push(providerBlock);
    } else {
      const publicPart = message.parts[publicPartIndex++];
      if (publicPart) parts.push(publicPart);
    }
  }
  return parts;
}
