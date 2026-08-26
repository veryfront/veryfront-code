import { agent } from "../factory.ts";
import type { Agent } from "../types.ts";
import type { RuntimeAgentMarkdownDefinition } from "./agent-definition.ts";
import { AGENT_DELEGATE_TOOL_PREFIX } from "./agent-delegation-names.ts";

const markdownDefinitionByAgent = new WeakMap<Agent, RuntimeAgentMarkdownDefinition>();

/** Definition for create runtime agent from markdown. */
export function createRuntimeAgentFromMarkdownDefinition(
  definition: RuntimeAgentMarkdownDefinition,
): Agent {
  // `tools:` is a binding selector resolved at invocation time by the
  // owner-aware resolver: `true` binds all visible tools; a list binds each
  // entry (own short name first, then exact global id). The factory adds the
  // scoped tools derived from `delegates` for both code and markdown agents.
  // `deniedTools` names rebuild as explicit `false` entries: the positive
  // selector cannot express a denial, and dropping them would let the factory
  // re-add runtime-essential skill tools the agent author switched off.
  const deniedToolEntries: Array<[string, false]> = (definition.deniedTools ?? []).map(
    (name) => [name, false as const],
  );
  const selectedToolMap: Record<string, boolean> = {
    ...(definition.tools !== undefined && definition.tools !== true
      ? Object.fromEntries(definition.tools.map((name) => [name, true as const]))
      : {}),
    ...Object.fromEntries(deniedToolEntries),
  };
  // AgentConfig cannot express "all except". When an unrestricted serialized
  // selector also carries denials, retain the false-only map and fail closed.
  const selectedTools: true | Record<string, boolean> | undefined = definition.tools === true &&
      deniedToolEntries.length === 0
    ? true
    : Object.keys(selectedToolMap).length > 0
    ? selectedToolMap
    : undefined;
  const deniedToolNames = new Set(definition.deniedTools ?? []);
  const providerTools = definition.providerTools?.filter(
    (toolName) => !deniedToolNames.has(toolName),
  );
  const delegates = definition.delegates?.filter(
    (delegateId) => !deniedToolNames.has(`${AGENT_DELEGATE_TOOL_PREFIX}${delegateId}`),
  );

  const runtimeAgent = agent({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    ...(definition.avatarUrl ? { avatarUrl: definition.avatarUrl } : {}),
    system: definition.system ?? definition.instructions,
    ...(definition.model ? { model: definition.model } : {}),
    ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
    ...(definition.maxSteps === undefined ? {} : { maxSteps: definition.maxSteps }),
    ...(providerTools ? { providerTools } : {}),
    ...(definition.skills === undefined ? {} : { skills: definition.skills }),
    ...(delegates === undefined ? {} : { delegates }),
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
