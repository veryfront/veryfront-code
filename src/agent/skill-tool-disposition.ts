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

/**
 * - `disable`: skills were turned off on purpose. Remove the tools even if the
 *   author also configured one, so `skills: false` cannot be worked around.
 * - `omit`: nothing declared them and there is nothing to load, so do not
 *   inject.
 * - `inject`: attach the framework tools, keeping any concrete override.
 */
export type SkillToolDisposition = "disable" | "omit" | "inject";

function isExplicitNoneSkillSelector(skills: AgentConfig["skills"]): boolean {
  return skills === false || (Array.isArray(skills) && skills.length === 0);
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
