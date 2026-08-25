import type { Agent, AgentSystem as AgentSystemValue } from "../types.ts";

const EFFECTIVE_AGENT_SYSTEM = Symbol("veryfront.effectiveAgentSystem");
const providerAwareResolvers = new WeakMap<
  AgentSystemResolver,
  (providerOptionKey: string | undefined) => Promise<AgentSystemValue>
>();
const providerAwareResolvedBaseResolvers = new WeakMap<
  AgentSystemResolver,
  (
    resolvedBase: AgentSystemValue,
    providerOptionKey: string | undefined,
    options: ResolveAgentSystemFromResolvedBaseOptions | undefined,
  ) => Promise<AgentSystemValue>
>();

export type ResolveAgentSystemFromResolvedBaseOptions = {
  preserveRuntimeContextMarker?: boolean;
};

type AgentSystemResolver = Extract<AgentSystemConfig, (...args: never[]) => unknown>;
type AgentSystemConfig = Agent["config"]["system"];

type EffectiveSystemAgent = Agent & {
  config: Agent["config"] & {
    [EFFECTIVE_AGENT_SYSTEM]?: AgentSystemConfig;
  };
};

/** Creates an internal system resolver that can use the effective runtime provider key. */
export function createProviderAwareAgentSystemResolver(
  resolve: (providerOptionKey: string | undefined) => Promise<AgentSystemValue>,
  resolveFromResolvedBase?: (
    resolvedBase: AgentSystemValue,
    providerOptionKey: string | undefined,
    options?: ResolveAgentSystemFromResolvedBaseOptions,
  ) => Promise<AgentSystemValue>,
): () => Promise<AgentSystemValue> {
  const resolver = () => resolve(undefined);
  providerAwareResolvers.set(resolver, resolve);
  if (resolveFromResolvedBase) {
    providerAwareResolvedBaseResolvers.set(resolver, resolveFromResolvedBase);
  }
  return resolver;
}

/** Resolves authored or framework-composed system instructions for one provider call. */
export function resolveAgentSystem(
  system: AgentSystemConfig,
  providerOptionKey: string | undefined,
): AgentSystemValue | Promise<AgentSystemValue> {
  if (typeof system !== "function") {
    return system;
  }
  const providerAwareResolver = providerAwareResolvers.get(system as AgentSystemResolver);
  return providerAwareResolver ? providerAwareResolver(providerOptionKey) : system();
}

/** Reapplies framework composition to an authored system value without resolving it again. */
export function resolveAgentSystemFromResolvedBase(
  system: AgentSystemConfig,
  resolvedBase: AgentSystemValue,
  providerOptionKey: string | undefined,
  options?: ResolveAgentSystemFromResolvedBaseOptions,
): AgentSystemValue | Promise<AgentSystemValue> {
  if (typeof system !== "function") {
    return resolvedBase;
  }
  const resolveFromResolvedBase = providerAwareResolvedBaseResolvers.get(
    system as AgentSystemResolver,
  );
  return resolveFromResolvedBase
    ? resolveFromResolvedBase(resolvedBase, providerOptionKey, options)
    : resolvedBase;
}

/** Records the system resolver used by an agent's private runtime. */
export function setEffectiveAgentSystem(agent: Agent, system: AgentSystemConfig): void {
  (agent as EffectiveSystemAgent).config[EFFECTIVE_AGENT_SYSTEM] = system;
}

/** Returns the effective runtime system resolver, including through config-preserving wrappers. */
export function getEffectiveAgentSystem(agent: Agent): AgentSystemConfig {
  return (agent as EffectiveSystemAgent).config[EFFECTIVE_AGENT_SYSTEM] ?? agent.config.system;
}
