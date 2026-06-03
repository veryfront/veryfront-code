/** Delegation overrides from the active loaded skill. */
export type SkillDelegationOverrides = {
  model?: string;
  thinking?: false | number;
  maxSteps?: number;
};

const INVOKE_AGENT_TOOL_ID = "invoke_agent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Extract active skill delegation overrides from a load_skill result. */
export function extractSkillDelegationOverrides(result: unknown): SkillDelegationOverrides {
  if (!isRecord(result)) {
    return {};
  }

  const model = typeof result.model === "string" && result.model.trim().length > 0
    ? result.model.trim()
    : undefined;
  const thinking = result.thinking === false
    ? result.thinking
    : getPositiveInteger(result.thinking);
  const maxSteps = getPositiveInteger(result.maxSteps);

  return {
    ...(model ? { model } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
}

function isBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length === 0;
}

/** Apply active skill delegation overrides to invoke_agent tool input. */
export function applySkillDelegationOverridesToToolInput(
  toolName: string,
  input: Record<string, unknown>,
  overrides: SkillDelegationOverrides | undefined,
): Record<string, unknown> {
  if (toolName !== INVOKE_AGENT_TOOL_ID || !overrides) {
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
