import { type AgUiEncoderStateOptions } from "./encoder.ts";
import type {
  AgUiEncodedEvent,
  AgUiEncoderState,
  AgUiRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "./encoder.ts";
import {
  type AgUiRuntimeEventEncoder,
  createAgUiRuntimeEventEncoder,
} from "./runtime-event-encoder.ts";
import type { AgentResponse } from "../types.ts";

/** Public API contract for AG-UI chunk encoder. */
export interface AgUiChunkEncoder<TChunk> {
  state: AgUiEncoderState;
  /** Optional timing anchor consumed by the response composition root. */
  timingState?: AgUiEncoderState;
  encode: (chunk: TChunk) => AgUiEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiEncodedEvent[];
}

/** Options accepted by create AG-UI chunk encoder. */
export interface CreateAgUiChunkEncoderOptions<TChunk> {
  /**
   * Timing clocks forwarded verbatim to the encoder state. A single object so
   * that adding a clock is one edit in `AgUiEncoderStateOptions`, not a
   * sweep through every wrapper that happens to sit in between.
   */
  timing?: AgUiEncoderStateOptions;
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
  getMetadataFromChunk?: (
    chunk: TChunk,
  ) => Partial<AgUiRunFinishedMetadata> | null | undefined;
  initialMetadata?: Partial<AgUiRunFinishedMetadata>;
}

function mergeMetadata(
  target: AgUiEncoderState["metadata"],
  metadata: Partial<AgUiRunFinishedMetadata> | null | undefined,
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

/** Create AG-UI chunk encoder. */
export function createAgUiChunkEncoder<TChunk>(
  options: CreateAgUiChunkEncoderOptions<TChunk>,
): AgUiChunkEncoder<TChunk> {
  const runtimeEventEncoder: AgUiRuntimeEventEncoder = createAgUiRuntimeEventEncoder({
    initialMetadata: options.initialMetadata,
    ...(options.timing === undefined ? {} : { timing: options.timing }),
  });

  return {
    state: runtimeEventEncoder.state,
    timingState: runtimeEventEncoder.state,
    encode: (chunk) => {
      mergeMetadata(runtimeEventEncoder.state.metadata, options.getMetadataFromChunk?.(chunk));
      return options.getRuntimeEvents(chunk).flatMap((event) => runtimeEventEncoder.encode(event));
    },
    finalize: (response) => runtimeEventEncoder.finalize(response),
  };
}
