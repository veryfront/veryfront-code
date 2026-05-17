import {
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserEncoderState,
  type AgUiRuntimeStreamEvent,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "./browser-encoder.ts";
import type { AgentResponse } from "../types.ts";

export interface AgUiChunkEncoderBridge<TChunk> {
  encode: (chunk: TChunk) => AgUiBrowserEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
  state: AgUiBrowserEncoderState;
}

export interface CreateAgUiChunkEncoderBridgeOptions<TChunk> {
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
}

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
