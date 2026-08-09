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
  encode: (chunk: TChunk) => AgUiBrowserEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
  state: AgUiBrowserEncoderState;
}

/** Options accepted by create AG-UI chunk encoder bridge. */
export interface CreateAgUiChunkEncoderBridgeOptions<TChunk> {
  getRuntimeEvents: (chunk: TChunk) => readonly AgUiRuntimeStreamEvent[];
  /** Clock for `elapsedMs`; forwarded to the encoder state. */
  nowMs?: (() => number) | null;
  /** Wall clock for `emittedAt`; forwarded to the encoder state. */
  epochMs?: (() => number) | null;
}

/** Create AG-UI chunk encoder bridge. */
export function createAgUiChunkEncoderBridge<TChunk>(
  options: CreateAgUiChunkEncoderBridgeOptions<TChunk>,
): AgUiChunkEncoderBridge<TChunk> {
  const state = createAgUiBrowserEncoderState(
    {
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
      ...(options.epochMs === undefined ? {} : { epochMs: options.epochMs }),
    },
  );

  return {
    state,
    encode: (chunk) =>
      options.getRuntimeEvents(chunk).flatMap((event) =>
        mapRuntimeStreamEventToAgUiBrowserEvents(state, event)
      ),
    finalize: (response) => finalizeAgUiBrowserEvents(state, response),
  };
}
