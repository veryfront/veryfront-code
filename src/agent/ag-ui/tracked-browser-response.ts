import type { AgUiBrowserEncodedEvent } from "./browser-encoder.ts";
import type { AgUiBrowserFinalizeTracker } from "./browser-finalize-tracker.ts";
import type { AgUiChunkEncoderBridge } from "./chunk-encoder-bridge.ts";
import {
  createAgUiRuntimeBrowserResponse,
  type CreateAgUiRuntimeBrowserResponseInput,
} from "./runtime-browser-response.ts";
import type { AgentResponse } from "../types.ts";

/** Input payload for create AG-UI tracked browser response. */
export interface CreateAgUiTrackedBrowserResponseInput<TChunk> extends
  Omit<
    CreateAgUiRuntimeBrowserResponseInput<TChunk, null>,
    "encoder" | "initialState" | "onChunk" | "getFinalResponse"
  > {
  chunkEncoder:
    & Pick<AgUiChunkEncoderBridge<TChunk>, "encode" | "finalize">
    & Partial<Pick<AgUiChunkEncoderBridge<TChunk>, "timingState">>;
  finalizeTracker: Pick<
    AgUiBrowserFinalizeTracker<TChunk>,
    "observeChunk" | "observeEncodedEvents" | "getFinalResponse"
  >;
}

/** Response payload for create AG-UI tracked browser. */
export function createAgUiTrackedBrowserResponse<TChunk>(
  input: CreateAgUiTrackedBrowserResponseInput<TChunk>,
): Response {
  const timingState = input.chunkEncoder.timingState;

  return createAgUiRuntimeBrowserResponse({
    ...input,
    encoder: {
      ...(timingState === undefined ? {} : { timingState }),
      encode: (chunk) => {
        const events = input.chunkEncoder.encode(chunk);
        input.finalizeTracker.observeEncodedEvents(events);
        return events;
      },
      finalize: (response: AgentResponse | null): AgUiBrowserEncodedEvent[] =>
        input.chunkEncoder.finalize(response),
    },
    initialState: null,
    onChunk: (_state, chunk) => {
      input.finalizeTracker.observeChunk(chunk);
    },
    getFinalResponse: () => input.finalizeTracker.getFinalResponse(),
  });
}
