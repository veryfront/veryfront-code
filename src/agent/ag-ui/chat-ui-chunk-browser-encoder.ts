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

/** Public API contract for AG-UI chat UI chunk browser encoder. */
export type AgUiChatUiChunkBrowserEncoder = Pick<
  AgUiBrowserChunkEncoder<ChatUiMessageChunk<ChatMessageMetadata>>,
  "encode" | "finalize"
>;

/** Options accepted by create AG-UI chat UI chunk browser encoder. */
export interface CreateAgUiChatUiChunkBrowserEncoderOptions {
  modelId?: string;
  resolveProvider?: (modelId: string) => string | undefined;
}

/** Input payload for create AG-UI chat UI tracked browser response. */
export interface CreateAgUiChatUiTrackedBrowserResponseInput extends
  Omit<
    CreateAgUiTrackedBrowserResponseInput<ChatUiMessageChunk<ChatMessageMetadata>>,
    "chunkEncoder" | "finalizeTracker"
  > {
  modelId: string;
  resolveProvider?: CreateAgUiChatUiChunkBrowserEncoderOptions["resolveProvider"];
}

/** Return AG-UI chat UI message metadata from chunk. */
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

/** Return AG-UI chat UI message usage metadata. */
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

/** Return AG-UI chat UI message chunk metadata. */
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

/** Event emitted for normalize chat UI message chunk to AG-UI runtime. */
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

/** Create AG-UI chat UI chunk browser encoder. */
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

/** Response payload for create AG-UI chat UI tracked browser. */
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
