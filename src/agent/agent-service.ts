import type { Agent } from "./types.ts";

/**
 * Transport-neutral durable run lifecycle sink reserved for hosted agent-service
 * adoption work.
 */
export interface DurableRunSink<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  startRun(input: TStartInput): Promise<TRun> | TRun;
  appendEvents(run: TRun, events: TEvent[]): Promise<void> | void;
  finalizeRun(run: TRun, terminalState: TTerminalState): Promise<void> | void;
  cancelRun(run: TRun, terminalState: TTerminalState): Promise<void> | void;
}

/**
 * Phase-0 contract draft for the future framework-owned hosted agent service.
 */
export interface AgentContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  agent: Agent;
  durableRunSink?: DurableRunSink<TStartInput, TRun, TEvent, TTerminalState>;
}

/**
 * Type-preserving service definition reserved ahead of the runtime
 * implementation landing in a later migration phase.
 */
export interface AgentServiceDefinition<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  contract: AgentContract<TStartInput, TRun, TEvent, TTerminalState>;
}

const DEFINE_AGENT_SERVICE_STUB_ERROR =
  "defineAgentService() is a Phase 0 stub. The framework contract is reserved, but the hosted runtime implementation has not landed yet.";

/**
 * Reserve the public hosted agent-service signature before the runtime
 * implementation lands.
 */
export function defineAgentService<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
>(
  contract: AgentContract<TStartInput, TRun, TEvent, TTerminalState>,
): AgentServiceDefinition<TStartInput, TRun, TEvent, TTerminalState> {
  void contract;
  throw new Error(DEFINE_AGENT_SERVICE_STUB_ERROR);
}
