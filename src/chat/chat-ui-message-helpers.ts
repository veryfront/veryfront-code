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
  agentName?: string;
  agentAvatarUrl?: string;
}

type ReplayState = {
  content: string;
  outputId: string;
  replayCount: number;
  replayOffset: number | null;
  started: boolean;
  ended: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeChildRunAudit(
  value: unknown,
): ChatMessageMetadata["childRunAudit"] | undefined {
  if (
    !isRecord(value) ||
    (value.status !== "completed" &&
      value.status !== "failed" &&
      value.status !== "cancelled" &&
      value.status !== "stopped")
  ) {
    return undefined;
  }

  const toolCalls = Array.isArray(value.toolCalls)
    ? value.toolCalls.flatMap((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.toolName !== "string" ||
        typeof entry.toolCallId !== "string"
      ) {
        return [];
      }
      return [{
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        ...("input" in entry ? { input: entry.input } : {}),
      }];
    })
    : undefined;
  const toolResults = Array.isArray(value.toolResults)
    ? value.toolResults.flatMap((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.toolName !== "string" ||
        typeof entry.toolCallId !== "string" ||
        !("input" in entry) ||
        !("output" in entry)
      ) {
        return [];
      }
      return [{
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        input: entry.input,
        output: entry.output,
      }];
    })
    : undefined;

  return {
    status: value.status,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(isNonNegativeInteger(value.steps) ? { steps: value.steps } : {}),
    ...(isNonNegativeFiniteNumber(value.durationMs) ? { durationMs: value.durationMs } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(toolResults ? { toolResults } : {}),
    ...(typeof value.terminalErrorCode === "string" || value.terminalErrorCode === null
      ? { terminalErrorCode: value.terminalErrorCode }
      : {}),
    ...(typeof value.terminalErrorMessage === "string" || value.terminalErrorMessage === null
      ? { terminalErrorMessage: value.terminalErrorMessage }
      : {}),
  };
}

function normalizeUsageMetadata(value: unknown): ChatMessageMetadata["usage"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokenDetails = isRecord(value.inputTokenDetails) ? value.inputTokenDetails : undefined;
  const outputTokenDetails = isRecord(value.outputTokenDetails)
    ? value.outputTokenDetails
    : undefined;
  const cacheCreationInputTokens = isNonNegativeInteger(value.cacheCreationInputTokens)
    ? value.cacheCreationInputTokens
    : isNonNegativeInteger(inputTokenDetails?.cacheWriteTokens)
    ? inputTokenDetails.cacheWriteTokens
    : undefined;
  const cacheReadInputTokens = isNonNegativeInteger(value.cacheReadInputTokens)
    ? value.cacheReadInputTokens
    : isNonNegativeInteger(inputTokenDetails?.cacheReadTokens)
    ? inputTokenDetails.cacheReadTokens
    : undefined;
  const cachedInputTokens = isNonNegativeInteger(value.cachedInputTokens)
    ? value.cachedInputTokens
    : cacheReadInputTokens;
  const reasoningTokens = isNonNegativeInteger(value.reasoningTokens)
    ? value.reasoningTokens
    : isNonNegativeInteger(outputTokenDetails?.reasoningTokens)
    ? outputTokenDetails.reasoningTokens
    : undefined;

  const usage = {
    ...(isNonNegativeInteger(value.inputTokens) ? { inputTokens: value.inputTokens } : {}),
    ...(isNonNegativeInteger(value.outputTokens) ? { outputTokens: value.outputTokens } : {}),
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

  return {
    ...(isNonNegativeInteger(value.billableInputTokens)
      ? { billableInputTokens: value.billableInputTokens }
      : {}),
    ...(isNonNegativeInteger(value.billableOutputTokens)
      ? { billableOutputTokens: value.billableOutputTokens }
      : {}),
    ...(isNonNegativeFiniteNumber(value.costUsd) ? { costUsd: value.costUsd } : {}),
    ...(isNonNegativeFiniteNumber(value.providerInputCostUsd)
      ? { providerInputCostUsd: value.providerInputCostUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.providerOutputCostUsd)
      ? { providerOutputCostUsd: value.providerOutputCostUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.providerCostUsd)
      ? { providerCostUsd: value.providerCostUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.veryfrontInputChargeUsd)
      ? { veryfrontInputChargeUsd: value.veryfrontInputChargeUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.veryfrontOutputChargeUsd)
      ? { veryfrontOutputChargeUsd: value.veryfrontOutputChargeUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.veryfrontChargeUsd)
      ? { veryfrontChargeUsd: value.veryfrontChargeUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.veryfrontBilledUsd)
      ? { veryfrontBilledUsd: value.veryfrontBilledUsd }
      : {}),
    ...(isNonNegativeFiniteNumber(value.costCredits) ? { costCredits: value.costCredits } : {}),
    ...(value.costSource === "gateway" || value.costSource === "missing" ||
        value.costSource === "partial"
      ? { costSource: value.costSource }
      : {}),
    ...(value.billingMode === "direct" || value.billingMode === "deferred"
      ? { billingMode: value.billingMode }
      : {}),
    ...(value.usageCaptureStatus === "complete" || value.usageCaptureStatus === "partial" ||
        value.usageCaptureStatus === "missing"
      ? { usageCaptureStatus: value.usageCaptureStatus }
      : {}),
  };
}

function splitReplayDelta(
  existing: string,
  replayOffset: number,
  delta: string,
): { emit: string; nextReplayOffset: number | null; restart: boolean } {
  const remaining = existing.slice(replayOffset);

  if (!remaining) {
    return { emit: delta, nextReplayOffset: null, restart: false };
  }

  if (delta === remaining.slice(0, delta.length)) {
    return { emit: "", nextReplayOffset: replayOffset + delta.length, restart: false };
  }

  if (delta.startsWith(remaining)) {
    return { emit: delta.slice(remaining.length), nextReplayOffset: null, restart: false };
  }

  if (remaining.startsWith(delta)) {
    return { emit: "", nextReplayOffset: replayOffset + delta.length, restart: false };
  }

  return {
    emit: existing.slice(0, replayOffset) + delta,
    nextReplayOffset: null,
    restart: true,
  };
}

function getReplayState(stateMap: Map<string, ReplayState>, id: string): ReplayState {
  const existing = stateMap.get(id);
  if (existing) {
    return existing;
  }

  const created: ReplayState = {
    content: "",
    outputId: id,
    replayCount: 0,
    replayOffset: null,
    started: false,
    ended: false,
  };
  stateMap.set(id, created);
  return created;
}

function firstStringField(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/** Normalizes chat message metadata. */
export function normalizeChatMessageMetadata(value: unknown): ChatMessageMetadata {
  if (!isRecord(value)) {
    return {};
  }

  const usage = normalizeUsageMetadata(value.usage);
  const billingMetadata = normalizeBillingMetadata(value);
  const agentName = firstStringField(value, ["agentName", "agent_name"]);
  const agentAvatarUrl = firstStringField(value, [
    "agentAvatarUrl",
    "agent_avatar_url",
    "avatar_url",
    "avatarUrl",
  ]);
  const childRunAudit = normalizeChildRunAudit(value.childRunAudit);

  return {
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...(typeof value.isStopped === "boolean" ? { isStopped: value.isStopped } : {}),
    ...(typeof value.isCompleted === "boolean" ? { isCompleted: value.isCompleted } : {}),
    ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
    ...(typeof value.agentId === "string" ? { agentId: value.agentId } : {}),
    ...(agentName ? { agentName } : {}),
    ...(agentAvatarUrl ? { agentAvatarUrl } : {}),
    ...(typeof value.conversationId === "string" ? { conversationId: value.conversationId } : {}),
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
    ...(typeof value.streamingMessageId === "string"
      ? { streamingMessageId: value.streamingMessageId }
      : {}),
    ...(childRunAudit ? { childRunAudit } : {}),
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
  const baseMetadata: ChatMessageMetadata = {
    agentId: input.agentId,
    ...(input.agentName ? { agentName: input.agentName } : {}),
    ...(input.agentAvatarUrl ? { agentAvatarUrl: input.agentAvatarUrl } : {}),
    modelId: input.modelId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.streamingMessageId ? { streamingMessageId: input.streamingMessageId } : {}),
  };

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
        state.replayOffset = 0;
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
      const { emit, nextReplayOffset, restart } = state.replayOffset === null
        ? { emit: chunk.delta, nextReplayOffset: null as number | null, restart: false }
        : splitReplayDelta(state.content, state.replayOffset, chunk.delta);

      state.replayOffset = nextReplayOffset;
      if (!emit) {
        continue;
      }

      if (restart) {
        if (!state.ended) {
          if (chunk.type === "text-delta") {
            yield { type: "text-end", id: state.outputId };
          } else {
            yield { type: "reasoning-end", id: state.outputId };
          }
        }
        state.replayCount++;
        state.outputId = `${chunk.id}:replay:${state.replayCount}`;
        state.content = emit;
        state.ended = false;
        if (chunk.type === "text-delta") {
          yield { type: "text-start", id: state.outputId };
          yield { type: "text-delta", id: state.outputId, delta: emit };
        } else {
          yield { type: "reasoning-start", id: state.outputId };
          yield { type: "reasoning-delta", id: state.outputId, delta: emit };
        }
        continue;
      }

      state.content += emit;
      yield {
        ...chunk,
        id: state.outputId,
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
      yield { ...chunk, id: state.outputId };
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
