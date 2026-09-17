import { agentLogger } from "#veryfront/utils/logger/index.ts";
import { AGENT_DEFAULTS, STREAMING_DEFAULTS } from "./defaults.ts";

export const DEFAULT_MAX_TOKENS = AGENT_DEFAULTS.maxTokens;
export const DEFAULT_TEMPERATURE = AGENT_DEFAULTS.temperature;
export const MAX_STREAM_BUFFER_SIZE = STREAMING_DEFAULTS.maxBufferSize;
export const DEFAULT_MAX_STEPS = 20;

/**
 * Max output token limits per model (normalized IDs without `veryfront-cloud/` prefix).
 *
 * MAINTENANCE: This table must be updated whenever a new model is added or an existing
 * model's limit changes. Models absent from the table fall back to FALLBACK_MODEL_MAX_OUTPUT_TOKENS
 * and log UNKNOWN_MODEL_MAX_OUTPUT_TOKENS_WARNING. Entries may carry a `-YYYYMMDD` snapshot date:
 * lookups match that date-stripped, so a snapshot and its undated id resolve identically.
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "anthropic/claude-opus-4-8": 128_000,
  "anthropic/claude-opus-4-6": 128_000,
  "anthropic/claude-sonnet-4-6": 64_000,
  "anthropic/claude-haiku-4-5-20251001": 64_000,
  "openai/gpt-5.5": 128_000,
  "openai/gpt-5.4": 128_000,
  "openai/gpt-5.4-mini": 128_000,
  "openai/gpt-5.4-nano": 128_000,
  "openai/gpt-5.2": 128_000,
  "google-ai-studio/gemini-3.1-pro-preview": 65_536,
  "google-ai-studio/gemini-3.5-flash": 65_536,
  "google-ai-studio/gemini-3-flash-preview": 65_536,
  "google-ai-studio/gemini-3.1-flash-lite": 65_536,
  "google-ai-studio/gemini-2.5-pro": 65_536,
  "google-ai-studio/gemini-2.5-flash": 65_536,
  "mistral/mistral-large-2512": 1_024,
  "moonshotai/kimi-k2": 32_000,
  "moonshotai/kimi-k2.6": 32_000,
  "moonshotai/kimi-k2.5": 32_000,
};

const MODEL_MAX_OUTPUT_TOKEN_ALIASES: Record<string, string> = {
  "google/gemini-3.1-pro": "google-ai-studio/gemini-3.1-pro-preview",
  "google/gemini-3.1-pro-preview": "google-ai-studio/gemini-3.1-pro-preview",
  "google/gemini-3.5-flash": "google-ai-studio/gemini-3.5-flash",
  "google/gemini-3-flash-preview": "google-ai-studio/gemini-3-flash-preview",
  "google/gemini-3.1-flash-lite": "google-ai-studio/gemini-3.1-flash-lite",
  "google/gemini-2.5-pro": "google-ai-studio/gemini-2.5-pro",
  "google/gemini-2.5-flash": "google-ai-studio/gemini-2.5-flash",
};

/**
 * Conservative fallback max output token limit for models not in MODEL_MAX_OUTPUT_TOKENS.
 * Using a lower bound prevents unbounded generation on unknown models; update the table
 * with the actual limit once the model is confirmed.
 */
export const FALLBACK_MODEL_MAX_OUTPUT_TOKENS = 4_096;

/** Logged when a model id misses the table and has to take the conservative fallback. */
export const UNKNOWN_MODEL_MAX_OUTPUT_TOKENS_WARNING =
  "Model is missing from the max output token table; applying the conservative fallback limit";

/** Trailing provider snapshot date, as in `anthropic/claude-haiku-4-5-20251001`. */
const MODEL_SNAPSHOT_DATE_SUFFIX = /-\d{8}$/;

/** Read a table without consulting object prototypes. */
function readTable<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * The cap table indexed by date-stripped id. A snapshot date names a release of
 * the same model, not a different model, so `anthropic/claude-haiku-4-5` and
 * `anthropic/claude-haiku-4-5-20251001` must share a ceiling. Two snapshots that
 * collapse to one id keep the lower ceiling, so an undated id can never raise a
 * snapshot's ceiling. This is not a family fallback: `gpt-4` and `gpt-4-turbo`
 * stay separate because neither carries a snapshot date.
 */
const UNDATED_MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = (() => {
  const index: Record<string, number> = Object.create(null);
  for (const [modelId, maxOutputTokens] of Object.entries(MODEL_MAX_OUTPUT_TOKENS)) {
    const undated = modelId.replace(MODEL_SNAPSHOT_DATE_SUFFIX, "");
    const existing = readTable(index, undated);
    index[undated] = existing === undefined ? maxOutputTokens : Math.min(existing, maxOutputTokens);
  }
  return index;
})();

function lookupModelMaxOutputTokens(modelString: string): number | undefined {
  // Lowercase first: stripping the prefix case-sensitively would leave
  // "Veryfront-Cloud/..." unmatched and fall through to the fallback.
  const lowered = modelString.toLowerCase();
  const normalized = lowered.startsWith("veryfront-cloud/")
    ? lowered.slice("veryfront-cloud/".length)
    : lowered;
  const canonical = readTable(MODEL_MAX_OUTPUT_TOKEN_ALIASES, normalized) ?? normalized;
  const exact = readTable(MODEL_MAX_OUTPUT_TOKENS, canonical);
  if (exact !== undefined) return exact;

  const undated = canonical.replace(MODEL_SNAPSHOT_DATE_SUFFIX, "");
  const undatedCanonical = readTable(MODEL_MAX_OUTPUT_TOKEN_ALIASES, undated) ?? undated;
  return readTable(UNDATED_MODEL_MAX_OUTPUT_TOKENS, undatedCanonical);
}

/**
 * Providers the cloud catalog is not expected to cover. A self-hosted or
 * bring-your-own-endpoint model has no entry here by design, so warning about
 * it every turn is noise rather than signal.
 */
const UNCATALOGUED_MODEL_PREFIXES = ["local/", "custom/", "openai-compatible/"];

/** Ids already warned about, so a long-running agent warns once, not per step. */
const warnedUnknownModels = new Set<string>();
/** Bound the set so an attacker-supplied id cannot grow it without limit. */
const MAX_WARNED_UNKNOWN_MODELS = 256;

function shouldWarnUnknownModel(modelString: string): boolean {
  const normalized = modelString.toLowerCase();
  if (UNCATALOGUED_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (warnedUnknownModels.has(normalized)) return false;
  if (warnedUnknownModels.size < MAX_WARNED_UNKNOWN_MODELS) {
    warnedUnknownModels.add(normalized);
  }
  return true;
}

/** Test-only: forget which ids have already warned. */
export function __resetUnknownModelWarningsForTests(): void {
  warnedUnknownModels.clear();
}

/**
 * Look up max output tokens for a model, stripping the `veryfront-cloud/` prefix
 * and any trailing snapshot date.
 *
 * An id the table does not cover takes FALLBACK_MODEL_MAX_OUTPUT_TOKENS, which
 * truncates output mid-response. That fallback is loud: it logs the model id so
 * the missing entry is visible in logs and traces instead of surfacing later as
 * a malformed provider stream.
 */
export function getModelMaxOutputTokens(modelString: string): number {
  const maxOutputTokens = lookupModelMaxOutputTokens(modelString);
  if (maxOutputTokens !== undefined) return maxOutputTokens;

  if (shouldWarnUnknownModel(modelString)) {
    // The log redactor masks any context key containing "token", so the applied
    // limit is reported as `max_output_limit` to stay readable in logs.
    agentLogger.warn(UNKNOWN_MODEL_MAX_OUTPUT_TOKENS_WARNING, {
      model: modelString,
      max_output_limit: FALLBACK_MODEL_MAX_OUTPUT_TOKENS,
    });
  }
  return FALLBACK_MODEL_MAX_OUTPUT_TOKENS;
}
