import { AGENT_DEFAULTS, STREAMING_DEFAULTS } from "../../agent/defaults.ts";

export const DEFAULT_MAX_TOKENS = AGENT_DEFAULTS.maxTokens;
export const DEFAULT_TEMPERATURE = AGENT_DEFAULTS.temperature;
export const MAX_STREAM_BUFFER_SIZE = STREAMING_DEFAULTS.maxBufferSize;
export const DEFAULT_MAX_STEPS = 20;

/**
 * Known max output token limits per model. Used to set a sensible
 * `maxOutputTokens` default when the consumer doesn't specify one,
 * avoiding truncated tool calls on models that support higher limits.
 *
 * Keys are normalized model IDs (without `veryfront-cloud/` prefix).
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "anthropic/claude-opus-4-6": 32_768,
  "anthropic/claude-sonnet-4-6": 16_384,
  "anthropic/claude-haiku-4-5-20251001": 8_192,
  "openai/gpt-5.2": 16_384,
  "google-ai-studio/gemini-2.5-pro": 65_536,
  "google-ai-studio/gemini-2.5-flash": 8_192,
};

/**
 * Look up the max output token limit for a model string.
 * Strips the `veryfront-cloud/` routing prefix before matching.
 */
export function getModelMaxOutputTokens(modelString: string): number | undefined {
  const normalized = modelString.startsWith("veryfront-cloud/")
    ? modelString.slice("veryfront-cloud/".length)
    : modelString;
  return MODEL_MAX_OUTPUT_TOKENS[normalized];
}
