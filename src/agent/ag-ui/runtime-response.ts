import {
  type AgUiResponseEncoder,
  type AgUiResponseExecution,
  createAgUiResponseStream,
} from "./response-stream.ts";
import { createAgUiSseResponse } from "./host-support.ts";
import {
  type AgUiRuntimeRequest,
  normalizeAgUiRuntimeRequest,
} from "#veryfront/agent/runtime/ag-ui-contract.ts";
import type { AgentResponse } from "#veryfront/agent/types.ts";

/** Input payload for create AG-UI runtime response. */
export interface CreateAgUiRuntimeResponseInput<TChunk, TState> {
  agUiInput: AgUiRuntimeRequest;
  defaults?: {
    threadId?: string;
    runId?: string;
  };
  agentId: string;
  /** Trusted resumed-segment marker. */
  resumed?: boolean;
  execution: AgUiResponseExecution<TChunk>;
  encoder: AgUiResponseEncoder<TChunk>;
  initialState: TState;
  onChunk?: (state: TState, chunk: TChunk) => void;
  getFinalResponse?: (state: TState) => AgentResponse | null;
}

/** Response payload for create AG-UI runtime response. */
export function createAgUiRuntimeResponse<TChunk, TState>(
  input: CreateAgUiRuntimeResponseInput<TChunk, TState>,
): Response {
  const stream = createAgUiResponseStream({
    agUiInput: normalizeAgUiRuntimeRequest(input.agUiInput, input.defaults),
    agentId: input.agentId,
    ...(input.resumed ? { resumed: true } : {}),
    execution: input.execution,
    encoder: input.encoder,
    initialState: input.initialState,
    ...(input.onChunk ? { onChunk: input.onChunk } : {}),
    ...(input.getFinalResponse ? { getFinalResponse: input.getFinalResponse } : {}),
  });

  return createAgUiSseResponse(stream);
}
