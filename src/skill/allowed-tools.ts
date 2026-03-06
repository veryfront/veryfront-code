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

/** Skill-system tools that are always allowed regardless of policy */
const ALWAYS_ALLOWED_TOOLS = SKILL_TOOL_IDS;

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

/** Minimal tool definition shape for filtering */
export interface FilterableToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
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
export function filterToolsForSkill<T extends FilterableToolDefinition>(
  tools: T[],
  allowedTools: string[] | undefined,
): T[] {
  if (allowedTools === undefined) {
    return tools;
  }

  return tools.filter((tool) => {
    if (ALWAYS_ALLOWED_TOOLS.has(tool.name)) return true;
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
): boolean {
  if (allowedTools === undefined) return true;
  if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return true;
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
