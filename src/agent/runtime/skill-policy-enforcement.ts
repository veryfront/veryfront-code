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
export const FORM_INPUT_TOOL_ID = "form_input";

function getSkillActivationRequiredError(toolName: string): string {
  return `Tool "${toolName}" cannot run before load_skill succeeds in the same step. ` +
    `Call "${LOAD_SKILL_TOOL_ID}" first to establish the active skill context.`;
}

export function hydrateActiveSkillStateFromMessages(
  messages: readonly Message[],
): {
  activeSkillId: string | undefined;
  activeSkillPolicy: string[] | undefined;
  activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;
} {
  let activeSkillId: string | undefined;
  let activeSkillPolicy: string[] | undefined;
  let activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolResultPart(part) || part.toolName !== LOAD_SKILL_TOOL_ID) continue;
      activeSkillId = extractSkillId(part.result);
      activeSkillPolicy = extractSkillPolicy(part.result);
      activeSkillDelegationOverrides = extractSkillDelegationOverrides(part.result);
    }
  }

  return { activeSkillId, activeSkillPolicy, activeSkillDelegationOverrides };
}

export function extractSkillId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const skillResult = result as { skillId?: unknown };
  return typeof skillResult.skillId === "string" ? skillResult.skillId : undefined;
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

function isSubmittedFormInputResult(result: unknown): boolean {
  return Boolean(result) && typeof result === "object" &&
    (result as { submitted?: unknown }).submitted === true;
}

export function hasSubmittedFormInputResult(messages: readonly Message[]): boolean {
  return messages.some((message) =>
    message.parts.some((part) =>
      isToolResultPart(part) &&
      part.toolName === FORM_INPUT_TOOL_ID &&
      isSubmittedFormInputResult(part.result)
    )
  );
}

export function removeFormInputAfterSubmission(
  toolName: string,
  result: unknown,
  activeSkillId: string | undefined,
  activeSkillPolicy: string[] | undefined,
): string[] | undefined {
  if (
    toolName !== FORM_INPUT_TOOL_ID || !isSubmittedFormInputResult(result) ||
    activeSkillPolicy === undefined
  ) {
    return activeSkillPolicy;
  }

  return narrowPolicyAfterSubmittedForm(activeSkillId, activeSkillPolicy);
}

export function narrowPolicyAfterSubmittedForm(
  activeSkillId: string | undefined,
  activeSkillPolicy: string[] | undefined,
): string[] | undefined {
  if (!activeSkillPolicy) return activeSkillPolicy;

  if (activeSkillId === "research") {
    return activeSkillPolicy.filter((allowedToolName) =>
      [
        "studio_suggestions",
        "web_search",
        "web_fetch",
        "create_file",
        "update_file",
      ].includes(allowedToolName)
    );
  }

  if (
    activeSkillId === "plan" ||
    activeSkillId === "create-agent" ||
    activeSkillId === "create-agentic-workflow"
  ) {
    return activeSkillPolicy.filter((allowedToolName) =>
      ["studio_suggestions", "create_file", "update_file"].includes(allowedToolName)
    );
  }

  return activeSkillPolicy.filter((allowedToolName) => allowedToolName !== FORM_INPUT_TOOL_ID);
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

export type SkillPolicyOptions = {
  allowSubmittedFormInputReuse?: boolean;
};

export function enforceSkillPolicy(
  toolName: string,
  activeSkillPolicy: string[] | undefined,
  mustLoadSkillFirst: boolean,
  options: SkillPolicyOptions = {},
): SkillPolicyResult {
  if (mustLoadSkillFirst && toolName !== LOAD_SKILL_TOOL_ID) {
    return { allowed: false, error: getSkillActivationRequiredError(toolName) };
  }

  if (
    toolName === FORM_INPUT_TOOL_ID &&
    options.allowSubmittedFormInputReuse === true
  ) {
    return { allowed: true };
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
