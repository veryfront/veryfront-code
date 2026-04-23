import type { ChatMessageMetadata, ChatUiMessageChunk } from "./protocol.ts";

type StreamChunkMetadataPart = {
  type: string;
  totalUsage?: unknown;
};

export interface BuildChatStreamChunkMessageMetadataInput {
  agentId: string;
  modelId: string;
  runId?: string;
  streamingMessageId?: string;
  part: StreamChunkMetadataPart;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUsageMetadata(value: unknown): ChatMessageMetadata["usage"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage = {
    ...(typeof value.inputTokens === "number" ? { inputTokens: value.inputTokens } : {}),
    ...(typeof value.outputTokens === "number" ? { outputTokens: value.outputTokens } : {}),
    ...(typeof value.reasoningTokens === "number"
      ? { reasoningTokens: value.reasoningTokens }
      : {}),
    ...(typeof value.cachedInputTokens === "number"
      ? { cachedInputTokens: value.cachedInputTokens }
      : {}),
  };

  return Object.keys(usage).length > 0 ? usage : undefined;
}

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

export function extractChatMessageMetadata(value: unknown): ChatMessageMetadata | undefined {
  const normalized = normalizeChatMessageMetadata(value);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

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
