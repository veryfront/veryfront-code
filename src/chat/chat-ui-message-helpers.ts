import type { ChatMessageMetadata, ChatUiMessageChunk } from "./protocol.ts";

/** Minimal stream part fields used to derive message metadata. */
export type StreamChunkMetadataPart = {
  /** Stream part discriminator. */
  type: string;
  /** Final provider usage and billing fields, when available. */
  totalUsage?: unknown;
};

/** Input payload for build chat stream chunk message metadata. */
export interface BuildChatStreamChunkMessageMetadataInput {
  /** Stable agent identifier. */
  agentId: string;
  /** Provider model identifier. */
  modelId: string;
  /** Durable run identifier. */
  runId?: string;
  /** Identifier assigned to the streaming assistant message. */
  streamingMessageId?: string;
  /** Stream part that may carry final usage metadata. */
  part: StreamChunkMetadataPart;
  /** User-facing agent name. */
  agentName?: string;
  /** Public HTTP or HTTPS avatar URL. */
  agentAvatarUrl?: string;
}

type ReplayState = {
  content: string;
  replayOffset: number | null;
  started: boolean;
  ended: boolean;
};

const MAX_METADATA_STRING_LENGTH = 2_048;
const MAX_REPLAY_STATES = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

function readOwnDataProperty(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeNonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeMetadataString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_METADATA_STRING_LENGTH
    ? normalized
    : undefined;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const normalized = normalizeMetadataString(value);
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    return (url.protocol === "http:" || url.protocol === "https:") &&
        url.username.length === 0 && url.password.length === 0
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeUsageMetadata(value: unknown): ChatMessageMetadata["usage"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawInputTokenDetails = readOwnDataProperty(value, "inputTokenDetails");
  const rawOutputTokenDetails = readOwnDataProperty(value, "outputTokenDetails");
  const inputTokenDetails = isRecord(rawInputTokenDetails) ? rawInputTokenDetails : undefined;
  const outputTokenDetails = isRecord(rawOutputTokenDetails) ? rawOutputTokenDetails : undefined;
  const cacheCreationInputTokens = normalizeNonnegativeInteger(
    readOwnDataProperty(value, "cacheCreationInputTokens"),
  ) ??
    normalizeNonnegativeInteger(
      inputTokenDetails ? readOwnDataProperty(inputTokenDetails, "cacheWriteTokens") : undefined,
    );
  const cacheReadInputTokens = normalizeNonnegativeInteger(
    readOwnDataProperty(value, "cacheReadInputTokens"),
  ) ??
    normalizeNonnegativeInteger(
      inputTokenDetails ? readOwnDataProperty(inputTokenDetails, "cacheReadTokens") : undefined,
    );
  const cachedInputTokens = normalizeNonnegativeInteger(
    readOwnDataProperty(value, "cachedInputTokens"),
  ) ??
    cacheReadInputTokens;
  const reasoningTokens = normalizeNonnegativeInteger(
    readOwnDataProperty(value, "reasoningTokens"),
  ) ??
    normalizeNonnegativeInteger(
      outputTokenDetails ? readOwnDataProperty(outputTokenDetails, "reasoningTokens") : undefined,
    );
  const inputTokens = normalizeNonnegativeInteger(readOwnDataProperty(value, "inputTokens"));
  const outputTokens = normalizeNonnegativeInteger(readOwnDataProperty(value, "outputTokens"));

  const usage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
  };

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function normalizeBillingMetadata(
  value: unknown,
): Omit<
  ChatMessageMetadata,
  | "createdAt"
  | "isStopped"
  | "isCompleted"
  | "completedAt"
  | "agentId"
  | "agentName"
  | "agentAvatarUrl"
  | "conversationId"
  | "modelId"
  | "runId"
  | "streamingMessageId"
  | "childRunAudit"
  | "usage"
> {
  if (!isRecord(value)) {
    return {};
  }

  const billableInputTokens = normalizeNonnegativeInteger(
    readOwnDataProperty(value, "billableInputTokens"),
  );
  const billableOutputTokens = normalizeNonnegativeInteger(
    readOwnDataProperty(value, "billableOutputTokens"),
  );
  const costUsd = normalizeNonnegativeNumber(readOwnDataProperty(value, "costUsd"));
  const providerInputCostUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "providerInputCostUsd"),
  );
  const providerOutputCostUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "providerOutputCostUsd"),
  );
  const providerCostUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "providerCostUsd"),
  );
  const veryfrontInputChargeUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "veryfrontInputChargeUsd"),
  );
  const veryfrontOutputChargeUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "veryfrontOutputChargeUsd"),
  );
  const veryfrontChargeUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "veryfrontChargeUsd"),
  );
  const veryfrontBilledUsd = normalizeNonnegativeNumber(
    readOwnDataProperty(value, "veryfrontBilledUsd"),
  );
  const costCredits = normalizeNonnegativeNumber(readOwnDataProperty(value, "costCredits"));
  const costSource = readOwnDataProperty(value, "costSource");
  const billingMode = readOwnDataProperty(value, "billingMode");
  const usageCaptureStatus = readOwnDataProperty(value, "usageCaptureStatus");

  return {
    ...(billableInputTokens !== undefined ? { billableInputTokens } : {}),
    ...(billableOutputTokens !== undefined ? { billableOutputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(providerInputCostUsd !== undefined ? { providerInputCostUsd } : {}),
    ...(providerOutputCostUsd !== undefined ? { providerOutputCostUsd } : {}),
    ...(providerCostUsd !== undefined ? { providerCostUsd } : {}),
    ...(veryfrontInputChargeUsd !== undefined ? { veryfrontInputChargeUsd } : {}),
    ...(veryfrontOutputChargeUsd !== undefined ? { veryfrontOutputChargeUsd } : {}),
    ...(veryfrontChargeUsd !== undefined ? { veryfrontChargeUsd } : {}),
    ...(veryfrontBilledUsd !== undefined ? { veryfrontBilledUsd } : {}),
    ...(costCredits !== undefined ? { costCredits } : {}),
    ...(costSource === "gateway" || costSource === "missing" || costSource === "partial"
      ? { costSource }
      : {}),
    ...(billingMode === "direct" || billingMode === "deferred" ? { billingMode } : {}),
    ...(usageCaptureStatus === "complete" || usageCaptureStatus === "partial" ||
        usageCaptureStatus === "missing"
      ? { usageCaptureStatus }
      : {}),
  };
}

function splitReplayDelta(
  existing: string,
  replayOffset: number,
  delta: string,
): { emit: string; nextReplayOffset: number | null } {
  const remaining = existing.slice(replayOffset);

  if (!remaining) {
    return { emit: delta, nextReplayOffset: null };
  }

  if (delta === remaining.slice(0, delta.length)) {
    return { emit: "", nextReplayOffset: replayOffset + delta.length };
  }

  if (delta.startsWith(remaining)) {
    return { emit: delta.slice(remaining.length), nextReplayOffset: null };
  }

  if (remaining.startsWith(delta)) {
    return { emit: "", nextReplayOffset: replayOffset + delta.length };
  }

  return { emit: delta, nextReplayOffset: null };
}

function getReplayState(stateMap: Map<string, ReplayState>, id: string): ReplayState {
  const existing = stateMap.get(id);
  if (existing) {
    return existing;
  }

  const created: ReplayState = {
    content: "",
    replayOffset: null,
    started: false,
    ended: false,
  };
  if (stateMap.size >= MAX_REPLAY_STATES) {
    const oldestKey = stateMap.keys().next().value;
    if (oldestKey !== undefined) {
      stateMap.delete(oldestKey);
    }
  }
  stateMap.set(id, created);
  return created;
}

function firstStringField(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = readOwnDataProperty(value, key);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const normalized = normalizeMetadataString(candidate);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

/** Normalizes chat message metadata. */
export function normalizeChatMessageMetadata(value: unknown): ChatMessageMetadata {
  if (!isRecord(value)) {
    return {};
  }

  const usage = normalizeUsageMetadata(readOwnDataProperty(value, "usage"));
  const billingMetadata = normalizeBillingMetadata(value);
  const agentName = firstStringField(value, ["agentName", "agent_name"]);
  const agentAvatarUrl = normalizeHttpUrl(firstStringField(value, [
    "agentAvatarUrl",
    "agent_avatar_url",
    "avatar_url",
    "avatarUrl",
  ]));

  const createdAt = normalizeMetadataString(readOwnDataProperty(value, "createdAt"));
  const completedAt = normalizeMetadataString(readOwnDataProperty(value, "completedAt"));
  const agentId = normalizeMetadataString(readOwnDataProperty(value, "agentId"));
  const conversationId = normalizeMetadataString(readOwnDataProperty(value, "conversationId"));
  const modelId = normalizeMetadataString(readOwnDataProperty(value, "modelId"));
  const runId = normalizeMetadataString(readOwnDataProperty(value, "runId"));
  const streamingMessageId = normalizeMetadataString(
    readOwnDataProperty(value, "streamingMessageId"),
  );
  const isStopped = readOwnDataProperty(value, "isStopped");
  const isCompleted = readOwnDataProperty(value, "isCompleted");

  return {
    ...(createdAt ? { createdAt } : {}),
    ...(typeof isStopped === "boolean" ? { isStopped } : {}),
    ...(typeof isCompleted === "boolean" ? { isCompleted } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(agentId ? { agentId } : {}),
    ...(agentName ? { agentName } : {}),
    ...(agentAvatarUrl ? { agentAvatarUrl } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(runId ? { runId } : {}),
    ...(streamingMessageId ? { streamingMessageId } : {}),
    ...(usage ? { usage } : {}),
    ...billingMetadata,
  };
}

/** Extract chat message metadata. */
export function extractChatMessageMetadata(value: unknown): ChatMessageMetadata | undefined {
  const normalized = normalizeChatMessageMetadata(value);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Builds chat stream chunk message metadata. */
export function buildChatStreamChunkMessageMetadata(
  input: BuildChatStreamChunkMessageMetadataInput,
): ChatMessageMetadata {
  const baseMetadata = normalizeChatMessageMetadata({
    agentId: input.agentId,
    ...(input.agentName ? { agentName: input.agentName } : {}),
    ...(input.agentAvatarUrl ? { agentAvatarUrl: input.agentAvatarUrl } : {}),
    modelId: input.modelId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.streamingMessageId ? { streamingMessageId: input.streamingMessageId } : {}),
  });

  if (input.part.type !== "finish" || !input.part.totalUsage) {
    return baseMetadata;
  }

  const usage = normalizeUsageMetadata(input.part.totalUsage);
  const billingMetadata = normalizeBillingMetadata(input.part.totalUsage);
  return usage || Object.keys(billingMetadata).length > 0
    ? { ...baseMetadata, ...(usage ? { usage } : {}), ...billingMetadata }
    : baseMetadata;
}

/** Normalizes chat UI message chunk. */
export function normalizeChatUiMessageChunk(
  chunk: ChatUiMessageChunk<unknown>,
): ChatUiMessageChunk<ChatMessageMetadata> {
  switch (chunk.type) {
    case "start":
      return {
        type: "start",
        ...(chunk.messageId ? { messageId: chunk.messageId } : {}),
        ...(chunk.messageMetadata !== undefined
          ? { messageMetadata: normalizeChatMessageMetadata(chunk.messageMetadata) }
          : {}),
      };
    case "message-metadata":
      return {
        type: "message-metadata",
        messageMetadata: normalizeChatMessageMetadata(chunk.messageMetadata),
      };
    case "finish":
      return {
        type: "finish",
        ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
        ...(chunk.messageMetadata !== undefined
          ? { messageMetadata: normalizeChatMessageMetadata(chunk.messageMetadata) }
          : {}),
      };
    default:
      return chunk;
  }
}

/** Dedupe chat UI message chunks. */
export async function* dedupeChatUiMessageChunks<TMessageMetadata>(
  stream: AsyncIterable<ChatUiMessageChunk<TMessageMetadata>>,
): AsyncIterable<ChatUiMessageChunk<TMessageMetadata>> {
  const textStates = new Map<string, ReplayState>();
  const reasoningStates = new Map<string, ReplayState>();

  for await (const chunk of stream) {
    if (chunk.type === "text-start" || chunk.type === "reasoning-start") {
      const stateMap = chunk.type === "text-start" ? textStates : reasoningStates;
      const state = getReplayState(stateMap, chunk.id);

      if (state.started) {
        if (!state.ended) {
          state.replayOffset = 0;
        }
        continue;
      }

      state.started = true;
      state.ended = false;
      yield chunk;
      continue;
    }

    if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
      const stateMap = chunk.type === "text-delta" ? textStates : reasoningStates;
      const state = getReplayState(stateMap, chunk.id);
      if (state.ended) {
        continue;
      }
      const { emit, nextReplayOffset } = state.replayOffset === null
        ? { emit: chunk.delta, nextReplayOffset: null as number | null }
        : splitReplayDelta(state.content, state.replayOffset, chunk.delta);

      state.replayOffset = nextReplayOffset;
      if (!emit) {
        continue;
      }

      state.content += emit;
      yield {
        ...chunk,
        delta: emit,
      };
      continue;
    }

    if (chunk.type === "text-end" || chunk.type === "reasoning-end") {
      const stateMap = chunk.type === "text-end" ? textStates : reasoningStates;
      const state = stateMap.get(chunk.id);

      if (!state || state.ended) {
        continue;
      }

      state.replayOffset = null;
      state.ended = true;
      yield chunk;
      continue;
    }

    yield chunk;
  }
}

/** Normalizes chat UI message stream. */
export async function* normalizeChatUiMessageStream(
  stream: AsyncIterable<ChatUiMessageChunk<unknown>>,
): AsyncIterable<ChatUiMessageChunk<ChatMessageMetadata>> {
  for await (const chunk of dedupeChatUiMessageChunks(stream)) {
    yield normalizeChatUiMessageChunk(chunk);
  }
}
