import { agent } from "../factory.ts";
import type { Agent } from "../types.ts";
import type { RuntimeAgentMarkdownDefinition } from "./agent-definition.ts";
import { buildAgentDelegateTools } from "./agent-delegation.ts";

const markdownDefinitionByAgent = new WeakMap<Agent, RuntimeAgentMarkdownDefinition>();

/** Definition for create runtime agent from markdown. */
export function createRuntimeAgentFromMarkdownDefinition(
  definition: RuntimeAgentMarkdownDefinition,
): Agent {
  const delegateTools = definition.delegates && definition.delegates.length > 0
    ? buildAgentDelegateTools({ delegates: definition.delegates, selfId: definition.id })
    : undefined;

  const runtimeAgent = agent({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    system: definition.instructions,
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
    ...(definition.maxSteps === undefined ? {} : { maxSteps: definition.maxSteps }),
    ...(definition.providerTools ? { providerTools: definition.providerTools } : {}),
    ...(delegateTools && Object.keys(delegateTools).length > 0 ? { tools: delegateTools } : {}),
  });

  markdownDefinitionByAgent.set(runtimeAgent, definition);
  return runtimeAgent;
}

/** Definition for get runtime agent markdown. */
export function getRuntimeAgentMarkdownDefinition(
  runtimeAgent: Agent,
): RuntimeAgentMarkdownDefinition | null {
  return markdownDefinitionByAgent.get(runtimeAgent) ?? null;
}

/** Check whether a runtime agent uses markdown configuration. */
export function isRuntimeAgentMarkdownAgent(runtimeAgent: Agent): boolean {
  return markdownDefinitionByAgent.has(runtimeAgent);
}
