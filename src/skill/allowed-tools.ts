/**
 * Allowed-Tools Enforcement
 *
 * Dual-layer enforcement for skill tool access restrictions.
 * Layer 1: Filter tool definitions before sending to model (planning-time)
 * Layer 2: Check individual tool calls at execution time
 *
 * @module
 */

import { SKILL_ALLOWED_TOOL_PATTERN_REGEX, SKILL_TOOL_IDS } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

/** Active skill file-backed capabilities available to skill infrastructure tools. */
export type SkillToolAvailability = {
  hasActiveSkill?: boolean;
  references?: readonly string[];
  scripts?: readonly string[];
};

const LOAD_SKILL_TOOL_ID = "load_skill";
const LOAD_SKILL_REFERENCE_TOOL_ID = "load_skill_reference";
const EXECUTE_SKILL_SCRIPT_TOOL_ID = "execute_skill_script";

function isSkillInfrastructureToolAllowed(
  toolName: string,
  availability: SkillToolAvailability = {},
): boolean | undefined {
  if (!SKILL_TOOL_IDS.has(toolName)) {
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
 * Check if a tool name matches a single allowed-tools pattern.
 *
 * Supports:
 * - Exact match: "Read" matches "Read"
 * - Prefix wildcard: "api:*" matches "api:list-users"
 */
export function matchesAllowedTool(toolName: string, pattern: string): boolean {
  // Invalid patterns always fail (fail closed)
  if (!SKILL_ALLOWED_TOOL_PATTERN_REGEX.test(pattern)) {
    return false;
  }

  // Prefix wildcard
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -1); // keep the colon: "api:"
    return toolName.startsWith(prefix);
  }

  // Exact match
  return toolName === pattern;
}

/**
 * Layer 1: Filter tool definitions before sending to model.
 *
 * Removes tools not in the allowed list. Always-allowed tools
 * (skill system tools) pass through regardless.
 *
 * @param tools - Full list of tool definitions
 * @param allowedTools - Allowed tool patterns, or undefined for no restrictions
 * @returns Filtered tool definitions
 */
export function filterToolsForSkill<T extends { name: string }>(
  tools: T[],
  allowedTools: string[] | undefined,
  skillToolAvailability?: SkillToolAvailability,
): T[] {
  if (allowedTools === undefined) {
    if (!skillToolAvailability) {
      return tools;
    }

    return tools.filter((tool) => {
      const skillToolAllowed = isSkillInfrastructureToolAllowed(
        tool.name,
        skillToolAvailability,
      );
      return skillToolAllowed ?? true;
    });
  }

  return tools.filter((tool) => {
    const skillToolAllowed = isSkillInfrastructureToolAllowed(tool.name, skillToolAvailability);
    if (skillToolAllowed !== undefined) return skillToolAllowed;
    return allowedTools.some((pattern) => matchesAllowedTool(tool.name, pattern));
  });
}

/**
 * Layer 2: Check if a specific tool call is allowed at execution time.
 *
 * @param toolName - Name of the tool being called
 * @param allowedTools - Allowed tool patterns, or undefined for no restrictions
 * @returns true if the tool call is allowed
 */
export function isToolAllowedBySkill(
  toolName: string,
  allowedTools: string[] | undefined,
  skillToolAvailability?: SkillToolAvailability,
): boolean {
  const skillToolAllowed = isSkillInfrastructureToolAllowed(toolName, skillToolAvailability);
  if (skillToolAllowed !== undefined) return skillToolAllowed;
  if (allowedTools === undefined) return true;
  return allowedTools.some((pattern) => matchesAllowedTool(toolName, pattern));
}

/**
 * Validate allowed-tool patterns at parse time.
 *
 * Ensures each pattern matches the expected format.
 * Rejects unsupported patterns with a descriptive error (fail closed).
 *
 * @param patterns - Array of tool patterns to validate
 * @returns Validated patterns (same array if all valid)
 * @throws If any pattern is invalid
 */
export function validateAllowedToolPatterns(patterns: string[]): string[] {
  for (const pattern of patterns) {
    if (!SKILL_ALLOWED_TOOL_PATTERN_REGEX.test(pattern)) {
      throw toError(
        createError({
          type: "agent",
          message: `Invalid allowed-tools pattern "${pattern}". ` +
            `Only exact tool IDs (e.g. "Read") and prefix wildcards (e.g. "api:*") are supported.`,
        }),
      );
    }
  }
  return patterns;
}
