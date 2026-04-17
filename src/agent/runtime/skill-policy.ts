import { serverLogger } from "#veryfront/utils";
import {
  isToolAllowedBySkill,
  validateAllowedToolPatterns,
} from "#veryfront/skill/allowed-tools.ts";

const logger = serverLogger.component("agent");

export const LOAD_SKILL_TOOL_ID = "load-skill";

function getSkillActivationRequiredError(toolName: string): string {
  return `Tool "${toolName}" cannot run before load-skill succeeds in the same step. ` +
    `Call "${LOAD_SKILL_TOOL_ID}" first to establish the active skill context.`;
}

/**
 * Extract and validate the skill policy from a load-skill tool result.
 * Returns `[]` (no tools allowed) for invalid/missing policies instead of
 * `undefined` (no restrictions), preventing accidental policy bypass.
 */
export function extractSkillPolicy(result: unknown): string[] | undefined {
  if (!result || typeof result !== "object") return undefined;
  const skillResult = result as { allowedTools?: unknown };

  if (!("allowedTools" in skillResult) || skillResult.allowedTools === undefined) {
    return undefined;
  }

  const raw = skillResult.allowedTools;
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    logger.warn(
      "load-skill returned invalid allowedTools; falling back to empty policy (no tools)",
    );
    return [];
  }

  try {
    return validateAllowedToolPatterns(raw);
  } catch (error) {
    logger.warn(
      "load-skill returned invalid tool patterns; falling back to empty policy (no tools)",
      { error },
    );
    return [];
  }
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

/**
 * Enforce skill policy on a single tool call.
 * Shared between generate() and stream() paths.
 */
export function enforceSkillPolicy(
  toolName: string,
  activeSkillPolicy: string[] | undefined,
  mustLoadSkillFirst: boolean,
): SkillPolicyResult {
  if (mustLoadSkillFirst && toolName !== LOAD_SKILL_TOOL_ID) {
    return { allowed: false, error: getSkillActivationRequiredError(toolName) };
  }

  if (activeSkillPolicy && !isToolAllowedBySkill(toolName, activeSkillPolicy)) {
    return {
      allowed: false,
      error: `Tool "${toolName}" is not allowed by the active skill policy. Allowed: ${
        activeSkillPolicy.join(", ")
      }`,
    };
  }

  return { allowed: true };
}
