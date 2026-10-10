import { execPrivateRegExp, testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
import type { RuntimeReasoningOption } from "../types.ts";

export type OpenAIReasoningEffort = "low" | "medium" | "high";

export type OpenAIProviderReasoningEffort = NonNullable<RuntimeReasoningOption["effort"]>;

export type OpenAIProviderReasoningOption = RuntimeReasoningOption;

export type ResolvedOpenAIReasoning = {
  effort: OpenAIReasoningEffort;
  source: "default" | "explicit";
};

const DEFAULT_REASONING_EFFORT: OpenAIReasoningEffort = "medium";
const ReflectApply = Reflect.apply;
const NumberParseInt = Number.parseInt;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;

function stringToLowerCase(value: string): string {
  return ReflectApply(StringPrototypeToLowerCase, value, []) as string;
}

function numberParseInt(value: string, radix: number): number {
  return ReflectApply(NumberParseInt, Number, [value, radix]) as number;
}

export function supportsDefaultReasoningParams(providerName: string): boolean {
  const normalizedProvider = stringToLowerCase(providerName);
  return normalizedProvider === "openai" || normalizedProvider === "veryfront-cloud";
}

function isGpt5ChatSnapshot(modelId: string): boolean {
  return testPrivateRegExp(/^gpt-5-chat($|-)/, modelId);
}

function isGpt51(modelId: string): boolean {
  return testPrivateRegExp(/^gpt-5\.1($|-)/, modelId);
}

function isReasoningCapableGpt5(modelId: string): boolean {
  if (isGpt5ChatSnapshot(modelId) || isGpt51(modelId)) {
    return false;
  }

  if (testPrivateRegExp(/^gpt-5(-|$)/, modelId)) {
    return true;
  }

  const gpt5Version = execPrivateRegExp(/^gpt-5\.(\d+)(-|$)/, modelId)?.[1];
  return gpt5Version !== undefined && numberParseInt(gpt5Version, 10) >= 2;
}

export function getDefaultOpenAIReasoningEffort(
  modelId: string,
  providerName = "openai",
): OpenAIReasoningEffort | undefined {
  const normalized = stringToLowerCase(modelId);
  if (!supportsDefaultReasoningParams(providerName)) {
    return undefined;
  }

  if (isGpt5ChatSnapshot(normalized)) {
    return undefined;
  }

  // GPT-5.1 defaults upstream reasoning to none unless callers opt in explicitly.
  if (isGpt51(normalized)) {
    return undefined;
  }

  if (
    testPrivateRegExp(/^o1($|-\d)/, normalized) || testPrivateRegExp(/^o[34](-|$)/, normalized)
  ) {
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
  // Default-reasoning BYOK "openai" requests must not ask for summaries:
  // unverified customer organizations get a 400 from the Responses API.
  return reasoning.source === "explicit" || stringToLowerCase(providerName) === "veryfront-cloud";
}

export function isOpenAIReasoningModel(modelId: string, providerName = "openai"): boolean {
  return getDefaultOpenAIReasoningEffort(modelId, providerName) !== undefined;
}

export function rejectsOpenAISamplingParams(modelId: string): boolean {
  const normalized = stringToLowerCase(modelId);

  return testPrivateRegExp(/^o[134]($|-)/, normalized) || isReasoningCapableGpt5(normalized);
}
