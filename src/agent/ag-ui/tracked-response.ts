import type { AgUiEncodedEvent } from "./encoder.ts";
import type { AgUiFinalizeTracker } from "./finalize-tracker.ts";
import type { AgUiChunkEncoderBridge } from "./chunk-encoder-bridge.ts";
import {
  createAgUiRuntimeResponse,
  type CreateAgUiRuntimeResponseInput,
} from "./runtime-response.ts";
import type { AgentResponse } from "../types.ts";

/** Input payload for create AG-UI tracked response. */
export interface CreateAgUiTrackedResponseInput<TChunk> extends
  Omit<
    CreateAgUiRuntimeResponseInput<TChunk, null>,
    "encoder" | "initialState" | "onChunk" | "getFinalResponse"
  > {
  chunkEncoder:
    & Pick<AgUiChunkEncoderBridge<TChunk>, "encode" | "finalize">
    & Partial<Pick<AgUiChunkEncoderBridge<TChunk>, "timingState">>;
  finalizeTracker: Pick<
    AgUiFinalizeTracker<TChunk>,
    "observeChunk" | "observeEncodedEvents" | "getFinalResponse"
  >;
}

/** Response payload for create AG-UI tracked response. */
export function createAgUiTrackedResponse<TChunk>(
  input: CreateAgUiTrackedResponseInput<TChunk>,
): Response {
  const timingState = input.chunkEncoder.timingState;

  return createAgUiRuntimeResponse({
    ...input,
    encoder: {
      ...(timingState === undefined ? {} : { timingState }),
      encode: (chunk) => {
        const events = input.chunkEncoder.encode(chunk);
        input.finalizeTracker.observeEncodedEvents(events);
        return events;
      },
      finalize: (response: AgentResponse | null): AgUiEncodedEvent[] =>
        input.chunkEncoder.finalize(response),
    },
    initialState: null,
    onChunk: (_state, chunk) => {
      input.finalizeTracker.observeChunk(chunk);
    },
    getFinalResponse: () => input.finalizeTracker.getFinalResponse(),
  });
}
