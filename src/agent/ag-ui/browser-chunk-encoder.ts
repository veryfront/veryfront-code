import type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "./browser-encoder.ts";
import {
  type AgUiRuntimeEventEncoder,
  createAgUiRuntimeEventEncoder,
} from "./runtime-event-encoder.ts";
import type { AgentResponse } from "../types.ts";

/** Public API contract for AG-UI browser chunk encoder. */
export interface AgUiBrowserChunkEncoder<TChunk> {
  /** State value. */
  state: AgUiBrowserEncoderState;
  /** Encodes one stream value. */
  encode: (chunk: TChunk) => AgUiBrowserEncodedEvent[];
  /** Finalizes the associated lifecycle. */
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
}

/** Options accepted by create AG-UI browser chunk encoder. */
export interface CreateAgUiBrowserChunkEncoderOptions<TChunk> {
  /** Callback that handles get runtime events. */
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
  /** Get metadata from chunk value. */
  getMetadataFromChunk?: (
    chunk: TChunk,
  ) => Partial<AgUiBrowserRunFinishedMetadata> | null | undefined;
  /** Initial metadata value. */
  initialMetadata?: Partial<AgUiBrowserRunFinishedMetadata>;
}

function mergeMetadata(
  target: AgUiBrowserEncoderState["metadata"],
  metadata: Partial<AgUiBrowserRunFinishedMetadata> | null | undefined,
): void {
  if (!metadata) {
    return;
  }

  if (typeof metadata.provider === "string") target.provider = metadata.provider;
  if (typeof metadata.model === "string") target.model = metadata.model;
  if (typeof metadata.inputTokens === "number") target.inputTokens = metadata.inputTokens;
  if (typeof metadata.outputTokens === "number") target.outputTokens = metadata.outputTokens;
  if (typeof metadata.totalTokens === "number") target.totalTokens = metadata.totalTokens;
  if (typeof metadata.cachedInputTokens === "number") {
    target.cachedInputTokens = metadata.cachedInputTokens;
  }
  if (typeof metadata.cacheCreationInputTokens === "number") {
    target.cacheCreationInputTokens = metadata.cacheCreationInputTokens;
  }
  if (typeof metadata.cacheReadInputTokens === "number") {
    target.cacheReadInputTokens = metadata.cacheReadInputTokens;
  }
  if (typeof metadata.reasoningTokens === "number") {
    target.reasoningTokens = metadata.reasoningTokens;
  }
  if (typeof metadata.billableInputTokens === "number") {
    target.billableInputTokens = metadata.billableInputTokens;
  }
  if (typeof metadata.billableOutputTokens === "number") {
    target.billableOutputTokens = metadata.billableOutputTokens;
  }
  if (typeof metadata.costUsd === "number") target.costUsd = metadata.costUsd;
  if (typeof metadata.providerInputCostUsd === "number") {
    target.providerInputCostUsd = metadata.providerInputCostUsd;
  }
  if (typeof metadata.providerOutputCostUsd === "number") {
    target.providerOutputCostUsd = metadata.providerOutputCostUsd;
  }
  if (typeof metadata.providerCostUsd === "number") {
    target.providerCostUsd = metadata.providerCostUsd;
  }
  if (typeof metadata.veryfrontInputChargeUsd === "number") {
    target.veryfrontInputChargeUsd = metadata.veryfrontInputChargeUsd;
  }
  if (typeof metadata.veryfrontOutputChargeUsd === "number") {
    target.veryfrontOutputChargeUsd = metadata.veryfrontOutputChargeUsd;
  }
  if (typeof metadata.veryfrontChargeUsd === "number") {
    target.veryfrontChargeUsd = metadata.veryfrontChargeUsd;
  }
  if (typeof metadata.veryfrontBilledUsd === "number") {
    target.veryfrontBilledUsd = metadata.veryfrontBilledUsd;
  }
  if (typeof metadata.costCredits === "number") target.costCredits = metadata.costCredits;
  if (metadata.costSource) target.costSource = metadata.costSource;
  if (metadata.billingMode) {
    target.billingMode = target.billingMode === "deferred" || metadata.billingMode === "deferred"
      ? "deferred"
      : metadata.billingMode;
  }
  if (metadata.usageCaptureStatus) target.usageCaptureStatus = metadata.usageCaptureStatus;
  if (typeof metadata.finishReason === "string") target.finishReason = metadata.finishReason;
}

/** Create AG-UI browser chunk encoder. */
export function createAgUiBrowserChunkEncoder<TChunk>(
  options: CreateAgUiBrowserChunkEncoderOptions<TChunk>,
): AgUiBrowserChunkEncoder<TChunk> {
  const runtimeEventEncoder: AgUiRuntimeEventEncoder = createAgUiRuntimeEventEncoder({
    initialMetadata: options.initialMetadata,
  });

  return {
    state: runtimeEventEncoder.state,
    encode: (chunk) => {
      mergeMetadata(runtimeEventEncoder.state.metadata, options.getMetadataFromChunk?.(chunk));
      return options.getRuntimeEvents(chunk).flatMap((event) => runtimeEventEncoder.encode(event));
    },
    finalize: (response) => runtimeEventEncoder.finalize(response),
  };
}
