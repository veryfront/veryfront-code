import type { Message } from "../types.ts";
import { serverLogger } from "#veryfront/utils";
import {
  isToolAllowedBySkill,
  validateAllowedToolPatterns,
} from "#veryfront/skill/allowed-tools.ts";
import { isToolResultPart } from "./tool-result-continuation.ts";
import {
  extractSkillDelegationOverrides,
  type SkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";

const logger = serverLogger.component("agent");

export const LOAD_SKILL_TOOL_ID = "load_skill";

function getSkillActivationRequiredError(toolName: string): string {
  return `Tool "${toolName}" cannot run before load_skill succeeds in the same step. ` +
    `Call "${LOAD_SKILL_TOOL_ID}" first to establish the active skill context.`;
}

export function hydrateActiveSkillStateFromMessages(
  messages: readonly Message[],
): {
  activeSkillPolicy: string[] | undefined;
  activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;
} {
  let activeSkillPolicy: string[] | undefined;
  let activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolResultPart(part) || part.toolName !== LOAD_SKILL_TOOL_ID) continue;
      activeSkillPolicy = extractSkillPolicy(part.result);
      activeSkillDelegationOverrides = extractSkillDelegationOverrides(part.result);
    }
  }

  return { activeSkillPolicy, activeSkillDelegationOverrides };
}

export function extractSkillPolicy(result: unknown): string[] | undefined {
  if (!result || typeof result !== "object") return undefined;
  const skillResult = result as { allowedTools?: unknown };

  if (!("allowedTools" in skillResult) || skillResult.allowedTools === undefined) {
    return undefined;
  }

  const raw = skillResult.allowedTools;
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    logger.warn(
      "load_skill returned invalid allowedTools; falling back to empty policy (no tools)",
    );
    return [];
  }

  try {
    return validateAllowedToolPatterns(raw);
  } catch (error) {
    logger.warn(
      "load_skill returned invalid tool patterns; falling back to empty policy (no tools)",
      { error },
    );
    return [];
  }
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

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
