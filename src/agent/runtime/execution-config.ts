import type { AgentConfig } from "../types.ts";

const omittedModels = new WeakMap<AgentConfig, string | undefined>();

/** Retain omitted model intent without changing the public resolved config. */
export function registerOmittedModelConfig(config: AgentConfig): void {
  omittedModels.set(config, config.model);
}

/** Restore omission when framework paths rebuild an existing agent. */
export function getAgentExecutionConfig(config: AgentConfig): AgentConfig {
  if (omittedModels.has(config) && omittedModels.get(config) === config.model) {
    return { ...config, model: undefined };
  }
  return config;
}
