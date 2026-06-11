import { agent } from "../factory.ts";
import type { Agent } from "../types.ts";
import type { Tool } from "#veryfront/tool";
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

/** Options for create runtime agent from markdown (colocated capabilities). */
export type CreateRuntimeAgentFromMarkdownOptions = {
  rootPath?: string;
  /**
   * Explicit colocated skill registry ids resolved at discovery. Takes
   * precedence over `definition.skills` so a colocated agent only sees its own
   * skills (never the registry-wide `true`, which would leak other agents').
   */
  resolvedSkillIds?: string[];
  /** Colocated tool objects (namespaced) to merge into the agent's tools. */
  tools?: Record<string, Tool>;
};

function resolveSkillsConfig(
  definition: RuntimeAgentMarkdownDefinition,
  resolvedSkillIds: string[] | undefined,
): true | string[] | undefined {
  if (resolvedSkillIds && resolvedSkillIds.length > 0) {
    return resolvedSkillIds;
  }
  // A colocated agent whose skills resolved to nothing must not fall back to
  // the registry-wide `true`, which would surface other agents' skills.
  if (resolvedSkillIds) {
    return undefined;
  }
  return definition.skills;
}

function mergeAgentTools(
  ...sources: Array<Record<string, Tool> | undefined>
): Record<string, Tool> | undefined {
  const merged: Record<string, Tool> = {};
  for (const source of sources) {
    for (const [name, tool] of Object.entries(source ?? {})) {
      merged[name] = tool;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Definition for create runtime agent from markdown. */
export function createRuntimeAgentFromMarkdownDefinition(
  definition: RuntimeAgentMarkdownDefinition,
  options: CreateRuntimeAgentFromMarkdownOptions = {},
): Agent {
  const { rootPath, resolvedSkillIds, tools } = options;

  const delegateTools = definition.delegates && definition.delegates.length > 0
    ? buildAgentDelegateTools({ delegates: definition.delegates, selfId: definition.id })
    : undefined;
  const skillsConfig = resolveSkillsConfig(definition, resolvedSkillIds);
  // Colocated tools take precedence over delegate tools on key collision (the
  // agent owns its colocated tools); in practice keys never overlap because
  // colocated use `{id}__name` and delegates use `agent_{id}`.
  const mergedTools = mergeAgentTools(delegateTools, tools);

  const runtimeAgent = agent({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    system: definition.instructions,
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
    ...(definition.maxSteps === undefined ? {} : { maxSteps: definition.maxSteps }),
    ...(definition.providerTools ? { providerTools: definition.providerTools } : {}),
    ...(skillsConfig === undefined ? {} : { skills: skillsConfig }),
    ...(mergedTools ? { tools: mergedTools } : {}),
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
