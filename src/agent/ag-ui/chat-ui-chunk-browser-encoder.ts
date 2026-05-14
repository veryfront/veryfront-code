import { tryGetVeryfrontCloudProviderFromModelId } from "#veryfront/provider";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { AgUiBrowserChunkEncoder } from "./browser-chunk-encoder.ts";
import { createAgUiBrowserFinalizeTracker } from "./browser-finalize-tracker.ts";
import {
  type AgUiBrowserRunFinishedMetadata,
  type AgUiRuntimeStreamEvent,
} from "./browser-encoder.ts";
import { createAgUiBrowserChunkEncoder } from "./browser-chunk-encoder.ts";
import {
  createAgUiTrackedBrowserResponse,
  type CreateAgUiTrackedBrowserResponseInput,
} from "./tracked-browser-response.ts";

export type AgUiChatUiChunkBrowserEncoder = Pick<
  AgUiBrowserChunkEncoder<ChatUiMessageChunk<ChatMessageMetadata>>,
  "encode" | "finalize"
>;

export interface CreateAgUiChatUiChunkBrowserEncoderOptions {
  modelId?: string;
  resolveProvider?: (modelId: string) => string | undefined;
}

export interface CreateAgUiChatUiTrackedBrowserResponseInput extends
  Omit<
    CreateAgUiTrackedBrowserResponseInput<ChatUiMessageChunk<ChatMessageMetadata>>,
    "chunkEncoder" | "finalizeTracker"
  > {
  modelId: string;
  resolveProvider?: CreateAgUiChatUiChunkBrowserEncoderOptions["resolveProvider"];
}

export function getAgUiChatUiMessageMetadataFromChunk(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): ChatMessageMetadata | undefined {
  if (chunk.type === "start" || chunk.type === "finish") {
    return chunk.messageMetadata;
  }

  if (chunk.type === "message-metadata") {
    return chunk.messageMetadata;
  }

  return undefined;
}

export function getAgUiChatUiMessageUsageMetadata(
  messageMetadata: ChatMessageMetadata | undefined,
): Pick<AgUiBrowserRunFinishedMetadata, "inputTokens" | "outputTokens" | "totalTokens"> {
  const inputTokens = messageMetadata?.usage?.inputTokens;
  const outputTokens = messageMetadata?.usage?.outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined,
  };
}

export function getAgUiChatUiMessageChunkMetadata(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  options: Pick<CreateAgUiChatUiChunkBrowserEncoderOptions, "resolveProvider"> = {},
): Partial<AgUiBrowserRunFinishedMetadata> | null {
  const messageMetadata = getAgUiChatUiMessageMetadataFromChunk(chunk);
  const modelId = messageMetadata?.modelId;
  const provider = modelId
    ? (options.resolveProvider ?? tryGetVeryfrontCloudProviderFromModelId)(modelId)
    : undefined;
  const usageMetadata = getAgUiChatUiMessageUsageMetadata(messageMetadata);

  if (
    !provider &&
    !modelId &&
    typeof usageMetadata.inputTokens !== "number" &&
    typeof usageMetadata.outputTokens !== "number" &&
    chunk.type !== "finish"
  ) {
    return null;
  }

  return {
    ...(provider ? { provider } : {}),
    ...(modelId ? { model: modelId } : {}),
    ...(typeof usageMetadata.inputTokens === "number"
      ? { inputTokens: usageMetadata.inputTokens }
      : {}),
    ...(typeof usageMetadata.outputTokens === "number"
      ? { outputTokens: usageMetadata.outputTokens }
      : {}),
    ...(typeof usageMetadata.totalTokens === "number"
      ? { totalTokens: usageMetadata.totalTokens }
      : {}),
    ...(chunk.type === "finish" && chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
  };
}

export function normalizeChatUiMessageChunkToAgUiRuntimeEvent(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): AgUiRuntimeStreamEvent {
  switch (chunk.type) {
    case "start":
      return {
        ...chunk,
        type: "message-start",
      };

    case "finish":
      return {
        ...chunk,
        type: "message-finish",
      };

    case "start-step":
      return { type: "step-start" };

    case "finish-step":
      return { type: "step-end" };

    case "error":
      return {
        type: "error",
        error: chunk.errorText,
      };

    default:
      return {
        ...chunk,
      };
  }
}

export function createAgUiChatUiChunkBrowserEncoder(
  options: CreateAgUiChatUiChunkBrowserEncoderOptions = {},
): AgUiChatUiChunkBrowserEncoder {
  const provider = options.modelId
    ? (options.resolveProvider ?? tryGetVeryfrontCloudProviderFromModelId)(options.modelId)
    : undefined;

  return createAgUiBrowserChunkEncoder({
    initialMetadata: {
      ...(provider ? { provider } : {}),
      ...(options.modelId ? { model: options.modelId } : {}),
    },
    getMetadataFromChunk: (chunk) => getAgUiChatUiMessageChunkMetadata(chunk, options),
    getRuntimeEvents: (chunk) => [normalizeChatUiMessageChunkToAgUiRuntimeEvent(chunk)],
  });
}

export function createAgUiChatUiTrackedBrowserResponse(
  input: CreateAgUiChatUiTrackedBrowserResponseInput,
): Response {
  const finalizeTracker = createAgUiBrowserFinalizeTracker<
    ChatUiMessageChunk<ChatMessageMetadata>
  >({
    getMetadataFromChunk: (chunk) =>
      getAgUiChatUiMessageChunkMetadata(chunk, {
        resolveProvider: input.resolveProvider,
      }),
  });

  return createAgUiTrackedBrowserResponse({
    ...input,
    chunkEncoder: createAgUiChatUiChunkBrowserEncoder({
      modelId: input.modelId,
      resolveProvider: input.resolveProvider,
    }),
    finalizeTracker,
  });
}
