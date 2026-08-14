/** Delegation overrides from the active loaded skill. */
import {
  isValidRuntimeSkillModel,
  MAX_RUNTIME_SKILL_STEPS,
  MAX_RUNTIME_SKILL_THINKING_TOKENS,
} from "./skill-metadata.ts";
import { readToolResultOwnDataProperty } from "#veryfront/tool/result.ts";
import { supportsSkillDelegationOverrides } from "./local-tool.ts";

export type SkillDelegationOverrides = {
  model?: string;
  thinking?: false | number;
  maxSteps?: number;
};

const INVOKE_AGENT_TOOL_ID = "invoke_agent";
const ArrayIsArray = Array.isArray;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    return !ArrayIsArray(value);
  } catch {
    return false;
  }
}

function getPositiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= max
    ? value
    : undefined;
}

/** Extract active skill delegation overrides from a load_skill result. */
export function extractSkillDelegationOverrides(result: unknown): SkillDelegationOverrides {
  if (!isRecord(result)) {
    return {};
  }

  const rawModel = readToolResultOwnDataProperty(result, "model");
  const rawThinking = readToolResultOwnDataProperty(result, "thinking");
  const model = isValidRuntimeSkillModel(rawModel) ? rawModel : undefined;
  const thinking = rawThinking === false
    ? rawThinking
    : getPositiveInteger(rawThinking, MAX_RUNTIME_SKILL_THINKING_TOKENS);
  const maxSteps = getPositiveInteger(
    readToolResultOwnDataProperty(result, "maxSteps"),
    MAX_RUNTIME_SKILL_STEPS,
  );

  return Object.freeze({
    ...(model ? { model } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  });
}

function isBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length === 0;
}

/** Apply active skill delegation overrides to invoke_agent tool input. */
export function applySkillDelegationOverridesToToolInput(
  toolName: string,
  input: Record<string, unknown>,
  overrides: SkillDelegationOverrides | undefined,
  tool?: unknown,
): Record<string, unknown> {
  if (
    toolName !== INVOKE_AGENT_TOOL_ID ||
    !overrides ||
    !supportsSkillDelegationOverrides(tool)
  ) {
    return input;
  }

  const next = { ...input };

  if (overrides.model && (typeof next.model !== "string" || isBlankString(next.model))) {
    next.model = overrides.model;
  }

  if (overrides.thinking !== undefined && next.thinking === undefined) {
    next.thinking = overrides.thinking === false ? 0 : overrides.thinking;
  }

  if (overrides.maxSteps !== undefined) {
    const requestedMaxSteps = getPositiveInteger(next.max_steps);
    next.max_steps = Math.max(requestedMaxSteps ?? 0, overrides.maxSteps);
  }

  return next;
}
