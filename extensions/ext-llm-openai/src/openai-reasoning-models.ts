export type OpenAIReasoningEffort = "low" | "medium" | "high";

const DEFAULT_REASONING_EFFORT: OpenAIReasoningEffort = "medium";

export function getDefaultOpenAIReasoningEffort(
  modelId: string,
): OpenAIReasoningEffort | undefined {
  const normalized = modelId.toLowerCase();

  if (/^o[134](-|$)/.test(normalized)) {
    return DEFAULT_REASONING_EFFORT;
  }

  if (/^gpt-5(-|$)/.test(normalized)) {
    return DEFAULT_REASONING_EFFORT;
  }

  const gpt5Version = /^gpt-5\.(\d+)(-|$)/.exec(normalized)?.[1];
  if (gpt5Version && Number.parseInt(gpt5Version, 10) >= 2) {
    return DEFAULT_REASONING_EFFORT;
  }

  return undefined;
}

export function isOpenAIReasoningModel(modelId: string): boolean {
  return getDefaultOpenAIReasoningEffort(modelId) !== undefined;
}
