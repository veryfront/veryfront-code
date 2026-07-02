export type OpenAIReasoningEffort = "low" | "medium" | "high";

export type OpenAIProviderReasoningEffort = OpenAIReasoningEffort | "max";

export type OpenAIProviderReasoningOption = {
  enabled?: boolean;
  effort?: OpenAIProviderReasoningEffort;
  budgetTokens?: number;
};

export type ResolvedOpenAIReasoning = {
  effort: OpenAIReasoningEffort;
  source: "default" | "explicit";
};

const DEFAULT_REASONING_EFFORT: OpenAIReasoningEffort = "medium";

function supportsDefaultReasoningParams(providerName: string): boolean {
  return providerName === "openai" || providerName === "veryfront-cloud";
}

function isGpt5ChatSnapshot(modelId: string): boolean {
  return /^gpt-5-chat($|-)/.test(modelId);
}

function isGpt51(modelId: string): boolean {
  return /^gpt-5\.1($|-)/.test(modelId);
}

function isReasoningCapableGpt5(modelId: string): boolean {
  if (isGpt5ChatSnapshot(modelId) || isGpt51(modelId)) {
    return false;
  }

  if (/^gpt-5(-|$)/.test(modelId)) {
    return true;
  }

  const gpt5Version = /^gpt-5\.(\d+)(-|$)/.exec(modelId)?.[1];
  return gpt5Version !== undefined && Number.parseInt(gpt5Version, 10) >= 2;
}

export function getDefaultOpenAIReasoningEffort(
  modelId: string,
  providerName = "openai",
): OpenAIReasoningEffort | undefined {
  const normalized = modelId.toLowerCase();
  const normalizedProvider = providerName.toLowerCase();

  if (!supportsDefaultReasoningParams(normalizedProvider)) {
    return undefined;
  }

  if (isGpt5ChatSnapshot(normalized)) {
    return undefined;
  }

  // GPT-5.1 defaults upstream reasoning to none unless callers opt in explicitly.
  if (isGpt51(normalized)) {
    return undefined;
  }

  if (/^o1($|-\d)/.test(normalized) || /^o[34](-|$)/.test(normalized)) {
    return DEFAULT_REASONING_EFFORT;
  }

  if (isReasoningCapableGpt5(normalized)) {
    return DEFAULT_REASONING_EFFORT;
  }

  return undefined;
}

export function resolveOpenAIReasoningConfig(
  modelId: string,
  providerName: string,
  option: OpenAIProviderReasoningOption | undefined,
): ResolvedOpenAIReasoning | undefined {
  if (!option) {
    const effort = getDefaultOpenAIReasoningEffort(modelId, providerName);
    return effort === undefined ? undefined : { effort, source: "default" };
  }

  if (option.enabled !== true) {
    return undefined;
  }

  switch (option.effort) {
    case "low":
      return { effort: "low", source: "explicit" };
    case "high":
    case "max":
      return { effort: "high", source: "explicit" };
    case "medium":
    default:
      return { effort: "medium", source: "explicit" };
  }
}

export function shouldRequestOpenAIReasoningSummary(
  providerName: string,
  reasoning: ResolvedOpenAIReasoning,
): boolean {
  return reasoning.source === "explicit" || providerName.toLowerCase() === "veryfront-cloud";
}

export function isOpenAIReasoningModel(modelId: string, providerName = "openai"): boolean {
  return getDefaultOpenAIReasoningEffort(modelId, providerName) !== undefined;
}

export function rejectsOpenAISamplingParams(modelId: string): boolean {
  const normalized = modelId.toLowerCase();

  return /^o[134]($|-)/.test(normalized) || isReasoningCapableGpt5(normalized);
}
