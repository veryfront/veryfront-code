import {
  type AgUiBrowserResponseEncoder,
  type AgUiBrowserResponseExecution,
  createAgUiBrowserResponseStream,
} from "./browser-response-stream.ts";
import { createAgUiSseResponse } from "./host-support.ts";
import {
  type AgUiRuntimeRequest,
  normalizeAgUiBrowserRuntimeRequest,
} from "../runtime/ag-ui-contract.ts";
import type { AgentResponse } from "../types.ts";

/** Input payload for create AG-UI runtime browser response. */
export interface CreateAgUiRuntimeBrowserResponseInput<TChunk, TState> {
  agUiInput: AgUiRuntimeRequest;
  defaults?: {
    threadId?: string;
    runId?: string;
  };
  agentId: string;
  execution: AgUiBrowserResponseExecution<TChunk>;
  encoder: AgUiBrowserResponseEncoder<TChunk>;
  initialState: TState;
  onChunk?: (state: TState, chunk: TChunk) => void;
  getFinalResponse?: (state: TState) => AgentResponse | null;
}

/** Response payload for create AG-UI runtime browser. */
export function createAgUiRuntimeBrowserResponse<TChunk, TState>(
  input: CreateAgUiRuntimeBrowserResponseInput<TChunk, TState>,
): Response {
  const stream = createAgUiBrowserResponseStream({
    agUiInput: normalizeAgUiBrowserRuntimeRequest(input.agUiInput, input.defaults),
    agentId: input.agentId,
    execution: input.execution,
    encoder: input.encoder,
    initialState: input.initialState,
    ...(input.onChunk ? { onChunk: input.onChunk } : {}),
    ...(input.getFinalResponse ? { getFinalResponse: input.getFinalResponse } : {}),
  });

  return createAgUiSseResponse(stream);
}
