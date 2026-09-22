import {
  reserveStreamRetention,
  type StreamRetentionBudget,
  type StreamRetentionLimits,
} from "veryfront/provider/shared";

export const MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES = 1_048_576;
/** Zero-byte argument fragments accepted per tool call; see {@link appendOpenAIStreamToolArgument}. */
export const MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS = 4_096;

export type OpenAIStreamToolArgumentBudget = StreamRetentionBudget;

const TOOL_ARGUMENT_LIMITS: StreamRetentionLimits = {
  maxBytes: MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
  maxEmptyFragments: MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS,
};

/**
 * Retain one streamed tool-argument fragment.
 *
 * Fragment count is chosen by the provider's tokenizer rather than by the
 * caller, so arguments are bounded by UTF-8 bytes. Only zero-byte fragments,
 * which never advance the byte budget, count against the fragment limit.
 */
export function appendOpenAIStreamToolArgument(
  budget: OpenAIStreamToolArgumentBudget,
  chunks: string[],
  fragment: string,
): "bytes" | "fragments" | undefined {
  const overflow = reserveStreamRetention(budget, fragment, TOOL_ARGUMENT_LIMITS);
  if (overflow === "empty-fragments") return "fragments";
  if (overflow === "bytes") return "bytes";
  if (fragment.length > 0) chunks.push(fragment);
  return undefined;
}

export function joinOpenAIStreamToolArguments(chunks: readonly string[]): string {
  return chunks.join("");
}

export function isJsonObjectText(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
