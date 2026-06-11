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

  // `tools:` is a binding selector resolved at invocation time by the
  // owner-aware resolver: `true` binds all visible tools; a list binds each
  // entry (own short name first, then exact global id). Delegate tools merge
  // on top; on key collision the delegate tool wins (keys never overlap in
  // practice: selectors use tool ids, delegates use `agent_{id}`).
  const selectedTools: true | Record<string, true> | undefined = definition.tools === true
    ? true
    : definition.tools
    ? Object.fromEntries(definition.tools.map((name) => [name, true as const]))
    : undefined;
  const mergedTools = selectedTools === true
    ? true
    : selectedTools || delegateTools
    ? { ...(selectedTools ?? {}), ...(delegateTools ?? {}) }
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
    ...(mergedTools !== undefined &&
        (mergedTools === true || Object.keys(mergedTools).length > 0)
      ? { tools: mergedTools }
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
