import {
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserRunFinishedMetadata,
  buildAgUiBrowserFinalizeResponse,
} from "./browser-encoder.ts";
import type { AgentResponse } from "../types.ts";

/** Public API contract for AG-UI browser finalize tracker. */
export interface AgUiBrowserFinalizeTracker<TChunk> {
  observeChunk: (chunk: TChunk) => void;
  observeEncodedEvents: (events: readonly AgUiBrowserEncodedEvent[]) => void;
  getFinalResponse: () => AgentResponse | null;
}

/** Options accepted by create AG-UI browser finalize tracker. */
export interface CreateAgUiBrowserFinalizeTrackerOptions<TChunk> {
  getMetadataFromChunk: (
    chunk: TChunk,
  ) => Partial<AgUiBrowserRunFinishedMetadata> | null | undefined;
}

/** Create AG-UI browser finalize tracker. */
export function createAgUiBrowserFinalizeTracker<TChunk>(
  options: CreateAgUiBrowserFinalizeTrackerOptions<TChunk>,
): AgUiBrowserFinalizeTracker<TChunk> {
  let sawRunError = false;
  const metadata: AgUiBrowserRunFinishedMetadata = {};

  return {
    observeChunk: (chunk) => {
      const nextMetadata = options.getMetadataFromChunk(chunk);
      if (!nextMetadata) {
        return;
      }

      if (typeof nextMetadata.provider === "string") {
        metadata.provider = nextMetadata.provider;
      }
      if (typeof nextMetadata.model === "string") {
        metadata.model = nextMetadata.model;
      }
      if (typeof nextMetadata.inputTokens === "number") {
        metadata.inputTokens = nextMetadata.inputTokens;
      }
      if (typeof nextMetadata.outputTokens === "number") {
        metadata.outputTokens = nextMetadata.outputTokens;
      }
      if (typeof nextMetadata.totalTokens === "number") {
        metadata.totalTokens = nextMetadata.totalTokens;
      }
      if (typeof nextMetadata.cachedInputTokens === "number") {
        metadata.cachedInputTokens = nextMetadata.cachedInputTokens;
      }
      if (typeof nextMetadata.cacheCreationInputTokens === "number") {
        metadata.cacheCreationInputTokens = nextMetadata.cacheCreationInputTokens;
      }
      if (typeof nextMetadata.cacheReadInputTokens === "number") {
        metadata.cacheReadInputTokens = nextMetadata.cacheReadInputTokens;
      }
      if (typeof nextMetadata.reasoningTokens === "number") {
        metadata.reasoningTokens = nextMetadata.reasoningTokens;
      }
      if (typeof nextMetadata.billableInputTokens === "number") {
        metadata.billableInputTokens = nextMetadata.billableInputTokens;
      }
      if (typeof nextMetadata.billableOutputTokens === "number") {
        metadata.billableOutputTokens = nextMetadata.billableOutputTokens;
      }
      if (typeof nextMetadata.costUsd === "number") {
        metadata.costUsd = nextMetadata.costUsd;
      }
      if (typeof nextMetadata.providerCostUsd === "number") {
        metadata.providerCostUsd = nextMetadata.providerCostUsd;
      }
      if (typeof nextMetadata.providerInputCostUsd === "number") {
        metadata.providerInputCostUsd = nextMetadata.providerInputCostUsd;
      }
      if (typeof nextMetadata.providerOutputCostUsd === "number") {
        metadata.providerOutputCostUsd = nextMetadata.providerOutputCostUsd;
      }
      if (typeof nextMetadata.veryfrontChargeUsd === "number") {
        metadata.veryfrontChargeUsd = nextMetadata.veryfrontChargeUsd;
      }
      if (typeof nextMetadata.veryfrontInputChargeUsd === "number") {
        metadata.veryfrontInputChargeUsd = nextMetadata.veryfrontInputChargeUsd;
      }
      if (typeof nextMetadata.veryfrontOutputChargeUsd === "number") {
        metadata.veryfrontOutputChargeUsd = nextMetadata.veryfrontOutputChargeUsd;
      }
      if (typeof nextMetadata.veryfrontBilledUsd === "number") {
        metadata.veryfrontBilledUsd = nextMetadata.veryfrontBilledUsd;
      }
      if (typeof nextMetadata.costCredits === "number") {
        metadata.costCredits = nextMetadata.costCredits;
      }
      if (nextMetadata.costSource) {
        metadata.costSource = nextMetadata.costSource;
      }
      if (nextMetadata.billingMode) {
        metadata.billingMode = metadata.billingMode === "deferred" ||
            nextMetadata.billingMode === "deferred"
          ? "deferred"
          : nextMetadata.billingMode;
      }
      if (nextMetadata.usageCaptureStatus) {
        metadata.usageCaptureStatus = nextMetadata.usageCaptureStatus;
      }
      if (typeof nextMetadata.finishReason === "string") {
        metadata.finishReason = nextMetadata.finishReason;
      }
    },
    observeEncodedEvents: (events) => {
      if (events.some((event) => event.event === "RunError")) {
        sawRunError = true;
      }
    },
    getFinalResponse: () => {
      if (sawRunError) {
        return null;
      }

      return buildAgUiBrowserFinalizeResponse(metadata);
    },
  };
}
