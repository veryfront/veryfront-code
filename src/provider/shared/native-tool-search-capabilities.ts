const ANTHROPIC_NATIVE_TOOL_SEARCH_MODEL_PREFIXES = [
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

const OPENAI_NATIVE_TOOL_SEARCH_MODEL_IDS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

/** Whether an Anthropic model ID accepts the provider-native tool-search tool. */
export function supportsAnthropicNativeToolSearchModel(modelId: string): boolean {
  const baseModelId = modelId.replace(/-\d{8}$/, "");
  return ANTHROPIC_NATIVE_TOOL_SEARCH_MODEL_PREFIXES.some((prefix) => baseModelId === prefix);
}

/** Whether an OpenAI model ID accepts the Responses API tool-search tool. */
export function supportsOpenAINativeToolSearchModel(modelId: string): boolean {
  const baseModelId = modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return OPENAI_NATIVE_TOOL_SEARCH_MODEL_IDS.some((supportedModelId) =>
    baseModelId === supportedModelId
  );
}
