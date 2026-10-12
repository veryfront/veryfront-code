/**
 * Whether an agent carries the `load_skill` family, and why.
 *
 * The rule is shared because two independent paths ask it. An agent with a
 * concrete tool map has its tools resolved once at construction; an agent with
 * `tools: true` draws from the registry on every step. Both must reach the same
 * answer, or a bare agent keeps the tools on one path and loses them on the
 * other.
 *
 * @module agent/skill-tool-disposition
 */

import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import type { AgentConfig } from "./types.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { hasTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import type { RuntimeSkillLoaderToolName } from "./runtime/skill-prompt.ts";

const IntrinsicReflectApply = Reflect.apply;
const IntrinsicToolRegistryGet = toolRegistry.get;

/**
 * - `disable`: skills were turned off on purpose. Remove the tools even if the
 *   author also configured one, so `skills: false` cannot be worked around.
 * - `omit`: nothing declared them and there is nothing to load, so do not
 *   inject.
 * - `inject`: attach the framework tools, keeping any concrete override.
 */
export type SkillToolDisposition = "disable" | "omit" | "inject";

function isExplicitNoneSkillSelector(skills: AgentConfig["skills"]): boolean {
  if (skills === false || (Array.isArray(skills) && skills.length === 0)) {
    return true;
  }
  return typeof skills === "object" && skills !== null && !Array.isArray(skills) &&
    Object.values(skills).every((enabled) => enabled === false);
}

/**
 * Any entry under a skill tool's name counts, `true` included: `true` asks for
 * the framework's own tool by name, which is as explicit a request for the
 * skill infrastructure as passing a concrete one.
 */
function hasConfiguredSkillTool(tools: AgentConfig["tools"]): boolean {
  if (tools === undefined || tools === true) return false;
  return Object.keys(tools).some((name) =>
    isSkillInfrastructureToolId(name) && tools[name] !== undefined
  );
}

function hasVisibleSkill(agentId: string | undefined): boolean {
  const scope = agentId === undefined ? undefined : { agentId };
  return skillRegistryInternal.resolveSelectorForAgent(undefined, scope).definitions.length > 0;
}

/**
 * An undeclared `skills` means "every visible skill", which is usually right --
 * but in a project with no skills it resolves to nothing while the tools get
 * attached anyway, spending prompt budget every request on a tool that could
 * only answer "no such skill".
 *
 * Declaring `skills` at all counts as intent and still injects, `true` against
 * an empty registry included: that author is opting in deliberately, possibly
 * before the skills they expect have registered.
 */
export function resolveSkillToolDisposition(
  config: Pick<AgentConfig, "skills" | "tools">,
  agentId: string | undefined,
): SkillToolDisposition {
  if (isExplicitNoneSkillSelector(config.skills)) return "disable";
  if (config.skills !== undefined) return "inject";
  if (hasConfiguredSkillTool(config.tools)) return "inject";
  return hasVisibleSkill(agentId) ? "inject" : "omit";
}

/**
 * The framework skill loader the agent exposes, chosen by provenance rather
 * than by name: a project tool may own either loader spelling. Catalog prompts
 * and deferred tool bootstrap both use this, so they always name the same tool.
 */
export function resolveTrustedSkillLoaderToolName(
  tools: AgentConfig["tools"],
): RuntimeSkillLoaderToolName | undefined {
  if (tools === true) {
    return hasTrustedHostToolProvenance(
        IntrinsicReflectApply(IntrinsicToolRegistryGet, toolRegistry, ["load_skill"]),
      )
      ? "load_skill"
      : undefined;
  }
  if (!tools) return undefined;
  const names = ["veryfront__load_skill", "load_skill"] as const;
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    if (hasTrustedHostToolProvenance(tools[name])) return name;
  }
  return undefined;
}
