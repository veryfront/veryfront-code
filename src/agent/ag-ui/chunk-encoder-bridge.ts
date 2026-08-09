import {
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserEncoderState,
  type AgUiBrowserEncoderStateOptions,
  type AgUiRuntimeStreamEvent,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "./browser-encoder.ts";
import type { AgentResponse } from "../types.ts";

/** Public API contract for AG-UI chunk encoder bridge. */
export interface AgUiChunkEncoderBridge<TChunk> {
  encode: (chunk: TChunk) => AgUiBrowserEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
  state: AgUiBrowserEncoderState;
}

/** Options accepted by create AG-UI chunk encoder bridge. */
export interface CreateAgUiChunkEncoderBridgeOptions<TChunk> {
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
  /**
   * Timing clocks forwarded verbatim to the encoder state. A single object so
   * that adding a clock is one edit in `AgUiBrowserEncoderStateOptions`, not a
   * sweep through every wrapper that happens to sit in between.
   */
  timing?: AgUiBrowserEncoderStateOptions;
}

/** Create AG-UI chunk encoder bridge. */
export function createAgUiChunkEncoderBridge<TChunk>(
  options: CreateAgUiChunkEncoderBridgeOptions<TChunk>,
): AgUiChunkEncoderBridge<TChunk> {
  const state = createAgUiBrowserEncoderState(options.timing ?? {});

  return {
    state,
    encode: (chunk) =>
      options.getRuntimeEvents(chunk).flatMap((event) =>
        mapRuntimeStreamEventToAgUiBrowserEvents(state, event)
      ),
    finalize: (response) => finalizeAgUiBrowserEvents(state, response),
  };
}
