import type { Message } from "../types.ts";
import type { ToolDefinition } from "#veryfront/tool";
import { serverLogger } from "#veryfront/utils";
import {
  isToolAllowedBySkill,
  type SkillToolAvailability,
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
export const INVOKE_AGENT_TOOL_ID = "invoke_agent";
export const SUBMITTED_FORM_INPUT_CONTEXT_KEY = "hasSubmittedFormInputResult";

export const INACTIVE_SKILL_TOOL_AVAILABILITY: SkillToolAvailability = Object.freeze({
  hasActiveSkill: false,
  references: Object.freeze([] as string[]),
  scripts: Object.freeze([] as string[]),
});

/** Runtime-owned capability state for the Skill active in one invocation. */
export type ActiveSkillState = {
  activeSkillId: string | undefined;
  activeSkillPolicy: string[] | undefined;
  activeSkillToolAvailability: SkillToolAvailability;
  activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;
};

const POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS = new Set([
  FORM_INPUT_TOOL_ID,
  LOAD_SKILL_TOOL_ID,
]);

function getSkillActivationRequiredError(toolName: string): string {
  return `Tool "${toolName}" cannot run before load_skill succeeds in the current invocation. ` +
    `Call "${LOAD_SKILL_TOOL_ID}" first to establish the active skill context.`;
}

/** Create fail-closed Skill state at the start of an invocation. */
export function createInactiveSkillState(): ActiveSkillState {
  return {
    activeSkillId: undefined,
    activeSkillPolicy: undefined,
    activeSkillToolAvailability: INACTIVE_SKILL_TOOL_AVAILABILITY,
    activeSkillDelegationOverrides: undefined,
  };
}

/** Derive active state only from a successful load_skill result executed by this runtime. */
export function createRuntimeLoadedSkillState(result: unknown): ActiveSkillState {
  return {
    activeSkillId: extractSkillId(result),
    activeSkillPolicy: extractSkillPolicy(result),
    activeSkillToolAvailability: extractSkillToolAvailability(result) ??
      INACTIVE_SKILL_TOOL_AVAILABILITY,
    activeSkillDelegationOverrides: extractSkillDelegationOverrides(result),
  };
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

function extractStringArrayField(result: Record<string, unknown>, field: string): string[] {
  const raw = result[field];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string");
}

export function extractSkillToolAvailability(
  result: unknown,
): SkillToolAvailability | undefined {
  if (!result || typeof result !== "object") return undefined;
  const skillResult = result as Record<string, unknown>;
  if (typeof skillResult.error === "string") return undefined;

  const looksLikeLoadedSkill = typeof skillResult.instructions === "string" ||
    typeof skillResult.skillId === "string" ||
    "allowedTools" in skillResult ||
    "references" in skillResult ||
    "scripts" in skillResult;

  if (!looksLikeLoadedSkill) return undefined;

  return {
    hasActiveSkill: true,
    references: extractStringArrayField(skillResult, "references"),
    scripts: extractStringArrayField(skillResult, "scripts"),
  };
}

function parseToolResultJson(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function containsSubmittedFormInputResult(result: unknown, depth = 0): boolean {
  const normalized = typeof result === "string" ? parseToolResultJson(result) : result;
  if (!normalized || typeof normalized !== "object" || depth > 3) {
    return false;
  }
  if ((normalized as { submitted?: unknown }).submitted === true) {
    return true;
  }
  return Object.values(normalized).some((value) =>
    containsSubmittedFormInputResult(value, depth + 1)
  );
}

function isSubmittedFormInputResult(result: unknown): boolean {
  return containsSubmittedFormInputResult(result);
}

function latestUserMessageIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

export function hasSubmittedFormInputResult(messages: readonly Message[]): boolean {
  const startIndex = latestUserMessageIndex(messages) + 1;

  return messages.slice(startIndex).some((message) =>
    message.parts.some((part) =>
      isToolResultPart(part) &&
      part.toolName === FORM_INPUT_TOOL_ID &&
      isSubmittedFormInputResult(part.result)
    )
  );
}

export function filterToolsAfterSubmittedFormInput(
  tools: readonly ToolDefinition[],
  messages: readonly Message[],
  runtimeContext?: Record<string, unknown>,
): ToolDefinition[] {
  const hasSubmittedFormInput = hasSubmittedFormInputResult(messages) ||
    runtimeContext?.[SUBMITTED_FORM_INPUT_CONTEXT_KEY] === true;
  if (!hasSubmittedFormInput) {
    return [...tools];
  }

  return tools.filter((tool) => !POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS.has(tool.name));
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
  // Retained for API compatibility. Generic policy must not branch on Skill IDs.
  _activeSkillId: string | undefined,
  activeSkillPolicy: string[] | undefined,
): string[] | undefined {
  if (!activeSkillPolicy) return activeSkillPolicy;
  return activeSkillPolicy.filter((allowedToolName) => allowedToolName !== FORM_INPUT_TOOL_ID);
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

export type SkillPolicyOptions = {
  hasSubmittedFormInput?: boolean;
  skillToolAvailability?: SkillToolAvailability;
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
    options.hasSubmittedFormInput === true &&
    POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS.has(toolName)
  ) {
    return {
      allowed: false,
      error:
        `Tool "${toolName}" cannot run after a submitted form_input result exists. Continue with the submitted values.`,
    };
  }

  if (
    !isToolAllowedBySkill(toolName, activeSkillPolicy, options.skillToolAvailability)
  ) {
    return {
      allowed: false,
      error: `Tool "${toolName}" is not allowed by the active skill policy. Allowed: ${
        activeSkillPolicy?.join(", ") ?? "none"
      }`,
    };
  }

  return { allowed: true };
}
