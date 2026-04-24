import type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "./ag-ui-browser-encoder.ts";
import {
  type AgUiRuntimeEventEncoder,
  createAgUiRuntimeEventEncoder,
} from "./ag-ui-runtime-event-encoder.ts";
import type { AgentResponse } from "./types.ts";

export interface AgUiBrowserChunkEncoder<TChunk> {
  state: AgUiBrowserEncoderState;
  encode: (chunk: TChunk) => AgUiBrowserEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
}

export interface CreateAgUiBrowserChunkEncoderOptions<TChunk> {
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
  getMetadataFromChunk?: (
    chunk: TChunk,
  ) => Partial<AgUiBrowserRunFinishedMetadata> | null | undefined;
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
  if (typeof metadata.finishReason === "string") target.finishReason = metadata.finishReason;
}

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
