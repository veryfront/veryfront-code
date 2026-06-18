import type { Message } from "../types.ts";
import type { ToolDefinition } from "#veryfront/tool";
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
export const INVOKE_AGENT_TOOL_ID = "invoke_agent";
export const SUBMITTED_FORM_INPUT_CONTEXT_KEY = "hasSubmittedFormInputResult";

const POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS = new Set([
  FORM_INPUT_TOOL_ID,
  LOAD_SKILL_TOOL_ID,
]);

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
    activeSkillId === "create-agent" ||
    activeSkillId === "create-agentic-workflow"
  ) {
    return activeSkillPolicy.filter((allowedToolName) => allowedToolName !== FORM_INPUT_TOOL_ID);
  }

  if (activeSkillId === "plan") {
    return activeSkillPolicy.filter((allowedToolName) =>
      [
        "studio_suggestions",
        "list_files",
        "get_file",
        "search_files",
        "create_file",
        "update_file",
      ].includes(allowedToolName)
    );
  }

  return activeSkillPolicy.filter((allowedToolName) => allowedToolName !== FORM_INPUT_TOOL_ID);
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

export type SkillPolicyOptions = {
  hasSubmittedFormInput?: boolean;
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
