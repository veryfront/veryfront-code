import type { ChatMessageMetadata, ChatUiMessageChunk } from "./protocol.ts";

type StreamChunkMetadataPart = {
  type: string;
  totalUsage?: unknown;
};

/** Input payload for build chat stream chunk message metadata. */
export interface BuildChatStreamChunkMessageMetadataInput {
  agentId: string;
  modelId: string;
  runId?: string;
  streamingMessageId?: string;
  part: StreamChunkMetadataPart;
}

type ReplayState = {
  content: string;
  replayOffset: number | null;
  started: boolean;
  ended: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUsageMetadata(value: unknown): ChatMessageMetadata["usage"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokenDetails = isRecord(value.inputTokenDetails) ? value.inputTokenDetails : undefined;
  const outputTokenDetails = isRecord(value.outputTokenDetails)
    ? value.outputTokenDetails
    : undefined;
  const cacheCreationInputTokens = typeof value.cacheCreationInputTokens === "number"
    ? value.cacheCreationInputTokens
    : typeof inputTokenDetails?.cacheWriteTokens === "number"
    ? inputTokenDetails.cacheWriteTokens
    : undefined;
  const cacheReadInputTokens = typeof value.cacheReadInputTokens === "number"
    ? value.cacheReadInputTokens
    : typeof inputTokenDetails?.cacheReadTokens === "number"
    ? inputTokenDetails.cacheReadTokens
    : undefined;
  const cachedInputTokens = typeof value.cachedInputTokens === "number"
    ? value.cachedInputTokens
    : cacheReadInputTokens;
  const reasoningTokens = typeof value.reasoningTokens === "number"
    ? value.reasoningTokens
    : typeof outputTokenDetails?.reasoningTokens === "number"
    ? outputTokenDetails.reasoningTokens
    : undefined;

  const usage = {
    ...(typeof value.inputTokens === "number" ? { inputTokens: value.inputTokens } : {}),
    ...(typeof value.outputTokens === "number" ? { outputTokens: value.outputTokens } : {}),
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
    ...(typeof cachedInputTokens === "number" ? { cachedInputTokens } : {}),
    ...(typeof cacheCreationInputTokens === "number" ? { cacheCreationInputTokens } : {}),
    ...(typeof cacheReadInputTokens === "number" ? { cacheReadInputTokens } : {}),
  };

  return Object.keys(usage).length > 0 ? usage : undefined;
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
  stateMap.set(id, created);
  return created;
}

/** Normalizes chat message metadata. */
export function normalizeChatMessageMetadata(value: unknown): ChatMessageMetadata {
  if (!isRecord(value)) {
    return {};
  }

  const usage = normalizeUsageMetadata(value.usage);

  return {
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...(typeof value.isStopped === "boolean" ? { isStopped: value.isStopped } : {}),
    ...(typeof value.isCompleted === "boolean" ? { isCompleted: value.isCompleted } : {}),
    ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
    ...(typeof value.agentId === "string" ? { agentId: value.agentId } : {}),
    ...(typeof value.agentName === "string" ? { agentName: value.agentName } : {}),
    ...(typeof value.conversationId === "string" ? { conversationId: value.conversationId } : {}),
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
    ...(typeof value.streamingMessageId === "string"
      ? { streamingMessageId: value.streamingMessageId }
      : {}),
    ...(usage ? { usage } : {}),
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
  const baseMetadata: ChatMessageMetadata = {
    agentId: input.agentId,
    modelId: input.modelId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.streamingMessageId ? { streamingMessageId: input.streamingMessageId } : {}),
  };

  if (input.part.type !== "finish" || !input.part.totalUsage) {
    return baseMetadata;
  }

  const usage = normalizeUsageMetadata(input.part.totalUsage);
  return usage ? { ...baseMetadata, usage } : baseMetadata;
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
        state.replayOffset = 0;
        state.ended = false;
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
