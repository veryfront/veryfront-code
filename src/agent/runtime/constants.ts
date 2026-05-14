import { AGENT_DEFAULTS, STREAMING_DEFAULTS } from "../../agent/defaults.ts";

export const DEFAULT_MAX_TOKENS = AGENT_DEFAULTS.maxTokens;
export const DEFAULT_TEMPERATURE = AGENT_DEFAULTS.temperature;
export const MAX_STREAM_BUFFER_SIZE = STREAMING_DEFAULTS.maxBufferSize;
export const DEFAULT_MAX_STEPS = 20;

/** Max output token limits per model (normalized IDs without `veryfront-cloud/` prefix). */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "anthropic/claude-opus-4-6": 32_768,
  "anthropic/claude-sonnet-4-6": 16_384,
  "anthropic/claude-haiku-4-5-20251001": 8_192,
  "openai/gpt-5.2": 16_384,
  "google-ai-studio/gemini-2.5-pro": 65_536,
  "google-ai-studio/gemini-2.5-flash": 8_192,
};

const MODEL_MAX_OUTPUT_TOKEN_ALIASES: Record<string, string> = {
  "google/gemini-2.5-pro": "google-ai-studio/gemini-2.5-pro",
  "google/gemini-2.5-flash": "google-ai-studio/gemini-2.5-flash",
};

/** Look up max output tokens for a model, stripping the `veryfront-cloud/` prefix. */
export function getModelMaxOutputTokens(modelString: string): number | undefined {
  const normalized = modelString.startsWith("veryfront-cloud/")
    ? modelString.slice("veryfront-cloud/".length)
    : modelString;
  return MODEL_MAX_OUTPUT_TOKENS[MODEL_MAX_OUTPUT_TOKEN_ALIASES[normalized] ?? normalized];
}
