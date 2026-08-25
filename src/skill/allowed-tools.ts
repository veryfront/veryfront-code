/**
 * Skill Tool Availability
 *
 * Gates the skill infrastructure tools by what the active skill actually
 * advertises: `load_skill_reference` needs a reference file, and
 * `execute_skill_script` needs a script. Ordinary tools are never gated here.
 *
 * A skill's `allowed-tools` frontmatter is deliberately *not* enforced. The
 * Agent Skills specification defines that field as pre-approval: tools the
 * agent may run without prompting, not an authorization boundary. See
 * veryfront/veryfront-issue-inbox#406.
 *
 * @module
 */

import { isSkillInfrastructureToolId } from "./types.ts";

/** Active skill file-backed capabilities available to skill infrastructure tools. */
export type SkillToolAvailability = {
  readonly hasActiveSkill?: boolean;
  readonly references?: readonly string[];
  readonly scripts?: readonly string[];
};

const LOAD_SKILL_TOOL_ID = "load_skill";
const LOAD_SKILL_REFERENCE_TOOL_ID = "load_skill_reference";
const EXECUTE_SKILL_SCRIPT_TOOL_ID = "execute_skill_script";
const apply = Reflect.apply;
const arrayFilter = Array.prototype.filter;

function isSkillInfrastructureToolAllowed(
  toolName: string,
  availability: SkillToolAvailability = {},
): boolean | undefined {
  if (!isSkillInfrastructureToolId(toolName)) {
    return undefined;
  }

  if (toolName === LOAD_SKILL_TOOL_ID) {
    return true;
  }

  if (toolName === LOAD_SKILL_REFERENCE_TOOL_ID) {
    return availability.hasActiveSkill === true && (availability.references?.length ?? 0) > 0;
  }

  if (toolName === EXECUTE_SKILL_SCRIPT_TOOL_ID) {
    return availability.hasActiveSkill === true && (availability.scripts?.length ?? 0) > 0;
  }

  return false;
}

/**
 * Filter tool definitions before sending them to the model.
 *
 * Only skill infrastructure tools are affected; every other tool passes
 * through untouched.
 *
 * @param tools - Full list of tool definitions
 * @param skillToolAvailability - Files the active skill advertises
 * @returns Filtered tool definitions
 */
export function filterToolsForSkill<T extends { name: string }>(
  tools: T[],
  skillToolAvailability?: SkillToolAvailability,
): T[] {
  if (!skillToolAvailability) {
    return tools;
  }

  return apply(arrayFilter, tools, [
    (tool: T) => isSkillInfrastructureToolAllowed(tool.name, skillToolAvailability) ?? true,
  ]) as T[];
}

/** Check whether a specific tool call is available at execution time. */
export function isSkillToolAvailable(
  toolName: string,
  skillToolAvailability?: SkillToolAvailability,
): boolean {
  return isSkillInfrastructureToolAllowed(toolName, skillToolAvailability) ?? true;
}

/** Filter provider-native or other name-only tool inventories through the same boundary. */
export function filterToolNamesForSkill(
  toolNames: readonly string[],
  skillToolAvailability?: SkillToolAvailability,
): string[] {
  return apply(arrayFilter, toolNames, [
    (toolName: string) => isSkillInfrastructureToolAllowed(toolName, skillToolAvailability) ?? true,
  ]) as string[];
}
