const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";

const MODELS_WITHOUT_TEMPERATURE_PARAMETER = new Set([
  "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-8",
]);

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
