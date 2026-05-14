import { agent } from "./factory.ts";
import type { Agent } from "./types.ts";
import type { RuntimeAgentMarkdownDefinition } from "./runtime-agent-definition.ts";

const markdownDefinitionByAgent = new WeakMap<Agent, RuntimeAgentMarkdownDefinition>();

export function createRuntimeAgentFromMarkdownDefinition(
  definition: RuntimeAgentMarkdownDefinition,
): Agent {
  const runtimeAgent = agent({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    system: definition.instructions,
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.maxSteps === undefined ? {} : { maxSteps: definition.maxSteps }),
  });

  markdownDefinitionByAgent.set(runtimeAgent, definition);
  return runtimeAgent;
}

export function getRuntimeAgentMarkdownDefinition(
  runtimeAgent: Agent,
): RuntimeAgentMarkdownDefinition | null {
  return markdownDefinitionByAgent.get(runtimeAgent) ?? null;
}

export function isRuntimeAgentMarkdownAgent(runtimeAgent: Agent): boolean {
  return markdownDefinitionByAgent.has(runtimeAgent);
}
