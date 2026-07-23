import {
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserEncoderState,
  type AgUiRuntimeStreamEvent,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "./browser-encoder.ts";
import type { AgentResponse } from "../types.ts";

/** Public API contract for AG-UI chunk encoder bridge. */
export interface AgUiChunkEncoderBridge<TChunk> {
  /** Encodes one stream value. */
  encode: (chunk: TChunk) => AgUiBrowserEncodedEvent[];
  /** Finalizes the associated lifecycle. */
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
  /** State value. */
  state: AgUiBrowserEncoderState;
}

/** Options accepted by create AG-UI chunk encoder bridge. */
export interface CreateAgUiChunkEncoderBridgeOptions<TChunk> {
  /** Callback that handles get runtime events. */
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
}

/** Create AG-UI chunk encoder bridge. */
export function createAgUiChunkEncoderBridge<TChunk>(
  options: CreateAgUiChunkEncoderBridgeOptions<TChunk>,
): AgUiChunkEncoderBridge<TChunk> {
  const state = createAgUiBrowserEncoderState();

  return {
    state,
    encode: (chunk) =>
      options.getRuntimeEvents(chunk).flatMap((event) =>
        mapRuntimeStreamEventToAgUiBrowserEvents(state, event)
      ),
    finalize: (response) => finalizeAgUiBrowserEvents(state, response),
  };
}
