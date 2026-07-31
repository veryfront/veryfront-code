import { agent } from "../factory.ts";
import type { Agent } from "../types.ts";
import type { RuntimeAgentMarkdownDefinition } from "./agent-definition.ts";

const markdownDefinitionByAgent = new WeakMap<Agent, RuntimeAgentMarkdownDefinition>();

/** Definition for create runtime agent from markdown. */
export function createRuntimeAgentFromMarkdownDefinition(
  definition: RuntimeAgentMarkdownDefinition,
): Agent {
  // `tools:` is a binding selector resolved at invocation time by the
  // owner-aware resolver: `true` binds all visible tools; a list binds each
  // entry (own short name first, then exact global id). The factory adds the
  // scoped tools derived from `delegates` for both code and markdown agents.
  const selectedTools: true | Record<string, true> | undefined = definition.tools === true
    ? true
    : definition.tools
    ? Object.fromEntries(definition.tools.map((name) => [name, true as const]))
    : undefined;

  const runtimeAgent = agent({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    ...(definition.avatarUrl ? { avatarUrl: definition.avatarUrl } : {}),
    system: definition.instructions,
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
    ...(definition.maxSteps === undefined ? {} : { maxSteps: definition.maxSteps }),
    ...(definition.providerTools ? { providerTools: definition.providerTools } : {}),
    ...(definition.skills === undefined ? {} : { skills: definition.skills }),
    ...(definition.delegates === undefined ? {} : { delegates: definition.delegates }),
    ...(definition.mcpServers === undefined ? {} : { mcpServers: definition.mcpServers }),
    ...(selectedTools !== undefined &&
        (selectedTools === true || Object.keys(selectedTools).length > 0)
      ? { tools: selectedTools }
      : {}),
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
