const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";

const MODELS_WITHOUT_TEMPERATURE_PARAMETER = new Set([
  "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-8",
]);

const KIMI_K2_6_MODEL_ID = "moonshotai/kimi-k2.6";
const KIMI_K2_6_THINKING_TEMPERATURE = 1;
const KIMI_K2_6_NON_THINKING_TEMPERATURE = 0.6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function isThinkingDisabled(options: Record<string, unknown> | undefined): boolean {
  const thinking = options ? getRecord(options, "thinking") : undefined;
  return thinking?.type === "disabled";
}

export function hasDisabledThinking(providerOptions?: Record<string, unknown>): boolean {
  if (!providerOptions) return false;
  if (isThinkingDisabled(providerOptions)) return true;

  for (const providerKey of ["moonshotai", "openai"]) {
    const provider = getRecord(providerOptions, providerKey);
    if (!provider) continue;
    if (isThinkingDisabled(provider)) return true;

    for (const bodyKey of ["extraBody", "extra_body"]) {
      if (isThinkingDisabled(getRecord(provider, bodyKey))) return true;
    }
  }

  return false;
}

export function normalizeModelCapabilityId(modelString?: string): string | undefined {
  if (!modelString) return undefined;
  return modelString.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)
    ? modelString.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length)
    : modelString;
}

export function supportsTemperatureParameter(modelString?: string): boolean {
  const normalizedModel = normalizeModelCapabilityId(modelString);
  if (!normalizedModel) return true;
  return !MODELS_WITHOUT_TEMPERATURE_PARAMETER.has(normalizedModel);
}

export function getFixedTemperatureParameter(
  modelString?: string,
  providerOptions?: Record<string, unknown>,
): number | undefined {
  const normalizedModel = normalizeModelCapabilityId(modelString);
  if (!normalizedModel) return undefined;
  if (normalizedModel === KIMI_K2_6_MODEL_ID) {
    return hasDisabledThinking(providerOptions)
      ? KIMI_K2_6_NON_THINKING_TEMPERATURE
      : KIMI_K2_6_THINKING_TEMPERATURE;
  }
  return undefined;
}

export function resolveTemperatureParameter(
  modelString: string | undefined,
  requestedTemperature: number | undefined,
  defaultTemperature: number,
  providerOptions?: Record<string, unknown>,
): number | undefined {
  if (!supportsTemperatureParameter(modelString)) {
    return undefined;
  }

  const fixedTemperature = getFixedTemperatureParameter(modelString, providerOptions);
  if (fixedTemperature !== undefined) {
    return fixedTemperature;
  }

  return requestedTemperature ?? defaultTemperature;
}
