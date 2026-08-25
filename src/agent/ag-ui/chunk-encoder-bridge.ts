import {
  type AgUiEncodedEvent,
  type AgUiEncoderState,
  type AgUiEncoderStateOptions,
  type AgUiRuntimeStreamEvent,
  createAgUiEncoderState,
  finalizeAgUiEvents,
  mapRuntimeStreamEventToAgUiEvents,
} from "./encoder.ts";
import type { AgentResponse } from "../types.ts";

/** Public API contract for AG-UI chunk encoder bridge. */
export interface AgUiChunkEncoderBridge<TChunk> {
  encode: (chunk: TChunk) => AgUiEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiEncodedEvent[];
  state: AgUiEncoderState;
  /** Timing anchor consumed by the response composition root. */
  timingState: AgUiEncoderState;
}

/** Options accepted by create AG-UI chunk encoder bridge. */
export interface CreateAgUiChunkEncoderBridgeOptions<TChunk> {
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
  /**
   * Timing clocks forwarded verbatim to the encoder state. A single object so
   * that adding a clock is one edit in `AgUiEncoderStateOptions`, not a
   * sweep through every wrapper that happens to sit in between.
   */
  timing?: AgUiEncoderStateOptions;
}

/** Create AG-UI chunk encoder bridge. */
export function createAgUiChunkEncoderBridge<TChunk>(
  options: CreateAgUiChunkEncoderBridgeOptions<TChunk>,
): AgUiChunkEncoderBridge<TChunk> {
  const state = createAgUiEncoderState(options.timing ?? {});

  return {
    state,
    timingState: state,
    encode: (chunk) =>
      options.getRuntimeEvents(chunk).flatMap((event) =>
        mapRuntimeStreamEventToAgUiEvents(state, event)
      ),
    finalize: (response) => finalizeAgUiEvents(state, response),
  };
}
