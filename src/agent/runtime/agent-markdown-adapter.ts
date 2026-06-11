import { agent } from "../factory.ts";
import type { Agent } from "../types.ts";
import type { RuntimeAgentMarkdownDefinition } from "./agent-definition.ts";
import { buildAgentDelegateTools } from "./agent-delegation.ts";

/** Metadata attached to a runtime agent created from a markdown definition. */
export type RuntimeAgentMarkdownAgentMeta = {
  definition: RuntimeAgentMarkdownDefinition;
  /**
   * Root directory of a directory-layout agent (`agents/{id}/`), when known.
   * Colocated skills live under `{rootPath}/SKILL.md` and `{rootPath}/skills/`.
   * Undefined for flat `agents/{id}.md` agents.
   */
  rootPath?: string;
};

const markdownMetaByAgent = new WeakMap<Agent, RuntimeAgentMarkdownAgentMeta>();

/** Input payload for create runtime agent from markdown. */
export type CreateRuntimeAgentFromMarkdownDefinitionInput = {
  definition: RuntimeAgentMarkdownDefinition;
  rootPath?: string;
};

/** Definition for create runtime agent from markdown. */
export function createRuntimeAgentFromMarkdownDefinition(
  input: RuntimeAgentMarkdownDefinition | CreateRuntimeAgentFromMarkdownDefinitionInput,
): Agent {
  const { definition, rootPath } = "definition" in input
    ? input
    : { definition: input, rootPath: undefined };

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
    ...(definition.skills === undefined ? {} : { skills: definition.skills }),
    ...(delegateTools ? { tools: delegateTools } : {}),
  });

  markdownMetaByAgent.set(runtimeAgent, {
    definition,
    ...(rootPath ? { rootPath } : {}),
  });
  return runtimeAgent;
}

/** Definition for get runtime agent markdown. */
export function getRuntimeAgentMarkdownDefinition(
  runtimeAgent: Agent,
): RuntimeAgentMarkdownDefinition | null {
  return markdownMetaByAgent.get(runtimeAgent)?.definition ?? null;
}

/** Returns the full markdown metadata (definition + root path) for an agent. */
export function getRuntimeAgentMarkdownMeta(
  runtimeAgent: Agent,
): RuntimeAgentMarkdownAgentMeta | null {
  return markdownMetaByAgent.get(runtimeAgent) ?? null;
}

/** Returns the colocated root directory of a markdown agent, if any. */
export function getRuntimeAgentMarkdownRootPath(runtimeAgent: Agent): string | null {
  return markdownMetaByAgent.get(runtimeAgent)?.rootPath ?? null;
}

/** Check whether a runtime agent uses markdown configuration. */
export function isRuntimeAgentMarkdownAgent(runtimeAgent: Agent): boolean {
  return markdownMetaByAgent.has(runtimeAgent);
}
