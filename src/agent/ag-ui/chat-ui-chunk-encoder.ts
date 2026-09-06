import { tryGetVeryfrontCloudProviderFromModelId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { AgUiChunkEncoder } from "./chunk-encoder.ts";
import { createAgUiFinalizeTracker } from "./finalize-tracker.ts";
import {
  type AgUiEncoderStateOptions,
  type AgUiRunFinishedMetadata,
  type AgUiRuntimeStreamEvent,
} from "./encoder.ts";
import { createAgUiChunkEncoder } from "./chunk-encoder.ts";
import {
  createAgUiTrackedResponse,
  type CreateAgUiTrackedResponseInput,
} from "./tracked-response.ts";

/** Public API contract for AG-UI chat UI chunk encoder. */
export type AgUiChatUiChunkEncoder = Pick<
  AgUiChunkEncoder<ChatUiMessageChunk<ChatMessageMetadata>>,
  "encode" | "finalize" | "timingState"
>;

/** Options accepted by create AG-UI chat UI chunk encoder. */
export interface CreateAgUiChatUiChunkEncoderOptions {
  /**
   * Timing clocks forwarded verbatim to the encoder state. A single object so
   * that adding a clock is one edit in `AgUiEncoderStateOptions`, not a
   * sweep through every wrapper that happens to sit in between.
   */
  timing?: AgUiEncoderStateOptions;
  modelId?: string;
  resolveProvider?: (modelId: string) => string | undefined;
}

/** Input payload for create AG-UI chat UI tracked response. */
export interface CreateAgUiChatUiTrackedResponseInput extends
  Omit<
    CreateAgUiTrackedResponseInput<ChatUiMessageChunk<ChatMessageMetadata>>,
    "chunkEncoder" | "finalizeTracker"
  > {
  modelId: string;
  resolveProvider?: CreateAgUiChatUiChunkEncoderOptions["resolveProvider"];
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
): Pick<
  AgUiRunFinishedMetadata,
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "cachedInputTokens"
  | "cacheCreationInputTokens"
  | "cacheReadInputTokens"
  | "reasoningTokens"
> {
  const inputTokens = messageMetadata?.usage?.inputTokens;
  const outputTokens = messageMetadata?.usage?.outputTokens;
  const cachedInputTokens = messageMetadata?.usage?.cachedInputTokens;
  const cacheCreationInputTokens = messageMetadata?.usage?.cacheCreationInputTokens;
  const cacheReadInputTokens = messageMetadata?.usage?.cacheReadInputTokens;
  const reasoningTokens = messageMetadata?.usage?.reasoningTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined,
    cachedInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    reasoningTokens,
  };
}

function getAgUiChatUiMessageBillingMetadata(
  messageMetadata: ChatMessageMetadata | undefined,
): Pick<
  AgUiRunFinishedMetadata,
  | "billableInputTokens"
  | "billableOutputTokens"
  | "costUsd"
  | "providerInputCostUsd"
  | "providerOutputCostUsd"
  | "providerCostUsd"
  | "veryfrontInputChargeUsd"
  | "veryfrontOutputChargeUsd"
  | "veryfrontChargeUsd"
  | "veryfrontBilledUsd"
  | "costCredits"
  | "costSource"
  | "billingMode"
  | "usageCaptureStatus"
> {
  return {
    billableInputTokens: messageMetadata?.billableInputTokens,
    billableOutputTokens: messageMetadata?.billableOutputTokens,
    costUsd: messageMetadata?.costUsd,
    providerInputCostUsd: messageMetadata?.providerInputCostUsd,
    providerOutputCostUsd: messageMetadata?.providerOutputCostUsd,
    providerCostUsd: messageMetadata?.providerCostUsd,
    veryfrontInputChargeUsd: messageMetadata?.veryfrontInputChargeUsd,
    veryfrontOutputChargeUsd: messageMetadata?.veryfrontOutputChargeUsd,
    veryfrontChargeUsd: messageMetadata?.veryfrontChargeUsd,
    veryfrontBilledUsd: messageMetadata?.veryfrontBilledUsd,
    costCredits: messageMetadata?.costCredits,
    costSource: messageMetadata?.costSource,
    billingMode: messageMetadata?.billingMode,
    usageCaptureStatus: messageMetadata?.usageCaptureStatus,
  };
}

function hasAgUiChatUiMessageBillingMetadata(
  metadata: ReturnType<typeof getAgUiChatUiMessageBillingMetadata>,
): boolean {
  return Object.values(metadata).some((value) => value !== undefined);
}

/** Return AG-UI chat UI message chunk metadata. */
export function getAgUiChatUiMessageChunkMetadata(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  options: Pick<CreateAgUiChatUiChunkEncoderOptions, "resolveProvider"> = {},
): Partial<AgUiRunFinishedMetadata> | null {
  const messageMetadata = getAgUiChatUiMessageMetadataFromChunk(chunk);
  const modelId = messageMetadata?.modelId;
  const provider = modelId
    ? (options.resolveProvider ?? tryGetVeryfrontCloudProviderFromModelId)(modelId)
    : undefined;
  const usageMetadata = getAgUiChatUiMessageUsageMetadata(messageMetadata);
  const billingMetadata = getAgUiChatUiMessageBillingMetadata(messageMetadata);

  if (
    !provider &&
    !modelId &&
    typeof usageMetadata.inputTokens !== "number" &&
    typeof usageMetadata.outputTokens !== "number" &&
    !hasAgUiChatUiMessageBillingMetadata(billingMetadata) &&
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
    ...(typeof usageMetadata.cachedInputTokens === "number"
      ? { cachedInputTokens: usageMetadata.cachedInputTokens }
      : {}),
    ...(typeof usageMetadata.cacheCreationInputTokens === "number"
      ? { cacheCreationInputTokens: usageMetadata.cacheCreationInputTokens }
      : {}),
    ...(typeof usageMetadata.cacheReadInputTokens === "number"
      ? { cacheReadInputTokens: usageMetadata.cacheReadInputTokens }
      : {}),
    ...(typeof usageMetadata.reasoningTokens === "number"
      ? { reasoningTokens: usageMetadata.reasoningTokens }
      : {}),
    ...(typeof billingMetadata.billableInputTokens === "number"
      ? { billableInputTokens: billingMetadata.billableInputTokens }
      : {}),
    ...(typeof billingMetadata.billableOutputTokens === "number"
      ? { billableOutputTokens: billingMetadata.billableOutputTokens }
      : {}),
    ...(typeof billingMetadata.costUsd === "number" ? { costUsd: billingMetadata.costUsd } : {}),
    ...(typeof billingMetadata.providerInputCostUsd === "number"
      ? { providerInputCostUsd: billingMetadata.providerInputCostUsd }
      : {}),
    ...(typeof billingMetadata.providerOutputCostUsd === "number"
      ? { providerOutputCostUsd: billingMetadata.providerOutputCostUsd }
      : {}),
    ...(typeof billingMetadata.providerCostUsd === "number"
      ? { providerCostUsd: billingMetadata.providerCostUsd }
      : {}),
    ...(typeof billingMetadata.veryfrontInputChargeUsd === "number"
      ? { veryfrontInputChargeUsd: billingMetadata.veryfrontInputChargeUsd }
      : {}),
    ...(typeof billingMetadata.veryfrontOutputChargeUsd === "number"
      ? { veryfrontOutputChargeUsd: billingMetadata.veryfrontOutputChargeUsd }
      : {}),
    ...(typeof billingMetadata.veryfrontChargeUsd === "number"
      ? { veryfrontChargeUsd: billingMetadata.veryfrontChargeUsd }
      : {}),
    ...(typeof billingMetadata.veryfrontBilledUsd === "number"
      ? { veryfrontBilledUsd: billingMetadata.veryfrontBilledUsd }
      : {}),
    ...(typeof billingMetadata.costCredits === "number"
      ? { costCredits: billingMetadata.costCredits }
      : {}),
    ...(billingMetadata.costSource ? { costSource: billingMetadata.costSource } : {}),
    ...(billingMetadata.billingMode ? { billingMode: billingMetadata.billingMode } : {}),
    ...(billingMetadata.usageCaptureStatus
      ? { usageCaptureStatus: billingMetadata.usageCaptureStatus }
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
        ...(chunk.code ? { code: chunk.code } : {}),
      };

    default:
      return {
        ...chunk,
      };
  }
}

/** Create AG-UI chat UI chunk encoder. */
export function createAgUiChatUiChunkEncoder(
  options: CreateAgUiChatUiChunkEncoderOptions = {},
): AgUiChatUiChunkEncoder {
  const provider = options.modelId
    ? (options.resolveProvider ?? tryGetVeryfrontCloudProviderFromModelId)(options.modelId)
    : undefined;

  return createAgUiChunkEncoder({
    initialMetadata: {
      ...(provider ? { provider } : {}),
      ...(options.modelId ? { model: options.modelId } : {}),
    },
    getMetadataFromChunk: (chunk) => getAgUiChatUiMessageChunkMetadata(chunk, options),
    getRuntimeEvents: (chunk) => [normalizeChatUiMessageChunkToAgUiRuntimeEvent(chunk)],
    ...(options.timing === undefined ? {} : { timing: options.timing }),
  });
}

/** Response payload for create AG-UI chat UI tracked response. */
export function createAgUiChatUiTrackedResponse(
  input: CreateAgUiChatUiTrackedResponseInput,
): Response {
  const finalizeTracker = createAgUiFinalizeTracker<
    ChatUiMessageChunk<ChatMessageMetadata>
  >({
    getMetadataFromChunk: (chunk) =>
      getAgUiChatUiMessageChunkMetadata(chunk, {
        resolveProvider: input.resolveProvider,
      }),
  });

  return createAgUiTrackedResponse({
    ...input,
    chunkEncoder: createAgUiChatUiChunkEncoder({
      modelId: input.modelId,
      resolveProvider: input.resolveProvider,
    }),
    finalizeTracker,
  });
}
