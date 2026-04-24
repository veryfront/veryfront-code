import {
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserRunFinishedMetadata,
  buildAgUiBrowserFinalizeResponse,
} from "./ag-ui-browser-encoder.ts";
import type { AgentResponse } from "./types.ts";

export interface AgUiBrowserFinalizeTracker<TChunk> {
  observeChunk: (chunk: TChunk) => void;
  observeEncodedEvents: (events: readonly AgUiBrowserEncodedEvent[]) => void;
  getFinalResponse: () => AgentResponse | null;
}

export interface CreateAgUiBrowserFinalizeTrackerOptions<TChunk> {
  getMetadataFromChunk: (
    chunk: TChunk,
  ) => Partial<AgUiBrowserRunFinishedMetadata> | null | undefined;
}

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
