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
 * Placeholder host-facing server config reserved for the future hosted service
 * implementation.
 */
export interface AgentServiceServerConfig {
  port?: number;
  basePath?: string;
  cors?: boolean;
}

export type AgentRegistry = Record<string, Agent>;

export interface AgentServiceContractBase<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  serviceName: string;
  server?: AgentServiceServerConfig;
  durableRunSink?: DurableRunSink<TStartInput, TRun, TEvent, TTerminalState>;
}

/**
 * Multi-agent hosted-service contract. Framework services route to
 * `defaultAgentId` unless the host chooses another registered agent.
 */
export interface AgentServiceRegistryContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> extends AgentServiceContractBase<TStartInput, TRun, TEvent, TTerminalState> {
  agents: AgentRegistry;
  defaultAgentId: string;
}

/**
 * Single-agent convenience accepted by `defineAgentService()`. Implementations
 * must normalize this shape into the same registry path used by multi-agent
 * services so framework users are not boxed into one-agent-per-process.
 */
export interface AgentServiceSingleAgentContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> extends AgentServiceContractBase<TStartInput, TRun, TEvent, TTerminalState> {
  agent: Agent;
  defaultAgentId?: string;
}

/**
 * Phase-0 contract draft for the future framework-owned hosted agent service.
 */
export type AgentContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> =
  | AgentServiceRegistryContract<TStartInput, TRun, TEvent, TTerminalState>
  | AgentServiceSingleAgentContract<TStartInput, TRun, TEvent, TTerminalState>;

export interface NormalizedAgentServiceContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> extends AgentServiceContractBase<TStartInput, TRun, TEvent, TTerminalState> {
  agents: AgentRegistry;
  defaultAgentId: string;
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
  contract: NormalizedAgentServiceContract<TStartInput, TRun, TEvent, TTerminalState>;
}

const DEFINE_AGENT_SERVICE_STUB_ERROR =
  "defineAgentService() is a Phase 0 stub. The framework contract is reserved, but the hosted runtime implementation has not landed yet.";

function getSingleAgentDefaultId(contract: {
  agent: Agent;
  defaultAgentId?: string;
}): string {
  return contract.defaultAgentId ?? contract.agent.id ?? "default";
}

function normalizeAgentServiceContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
>(
  contract: AgentContract<TStartInput, TRun, TEvent, TTerminalState>,
): NormalizedAgentServiceContract<TStartInput, TRun, TEvent, TTerminalState> {
  if ("agents" in contract) {
    return {
      serviceName: contract.serviceName,
      agents: contract.agents,
      defaultAgentId: contract.defaultAgentId,
      server: contract.server,
      durableRunSink: contract.durableRunSink,
    };
  }

  const defaultAgentId = getSingleAgentDefaultId(contract);
  return {
    serviceName: contract.serviceName,
    agents: { [defaultAgentId]: contract.agent },
    defaultAgentId,
    server: contract.server,
    durableRunSink: contract.durableRunSink,
  };
}

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
  void normalizeAgentServiceContract(contract);
  throw new Error(DEFINE_AGENT_SERVICE_STUB_ERROR);
}
