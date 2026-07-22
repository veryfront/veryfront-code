import type { Agent } from "../types.ts";

type AgentSystem = Agent["config"]["system"];

const EFFECTIVE_AGENT_SYSTEM = Symbol("veryfront.effectiveAgentSystem");

type EffectiveSystemAgent = Agent & {
  config: Agent["config"] & {
    [EFFECTIVE_AGENT_SYSTEM]?: AgentSystem;
  };
};

/** Records the system resolver used by an agent's private runtime. */
export function setEffectiveAgentSystem(agent: Agent, system: AgentSystem): void {
  (agent as EffectiveSystemAgent).config[EFFECTIVE_AGENT_SYSTEM] = system;
}

/** Returns the effective runtime system resolver, including through config-preserving wrappers. */
export function getEffectiveAgentSystem(agent: Agent): AgentSystem {
  return (agent as EffectiveSystemAgent).config[EFFECTIVE_AGENT_SYSTEM] ?? agent.config.system;
}
