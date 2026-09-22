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

function isWhitespaceCharacter(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

/**
 * Drop the empty JSON string some providers append after a complete tool call.
 *
 * DeepSeek on Azure AI Foundry closes a call that takes no arguments twice: its
 * tool parser writes the object `{}` and then the JSON encoding of an empty
 * string, so `function.arguments` reads `{}""` and no longer parses. The stream
 * surface delivers the two pieces as separate fragments and the non-streaming
 * surface delivers them already joined, so both need the same repair.
 *
 * The suffix is removed only when the text in front of it already parses as a
 * JSON object and the whole text does not. Arguments that genuinely end in an
 * empty string value, such as `{"path":""}`, parse on their own and are
 * returned unchanged.
 */
export function stripDoubleClosedToolArguments(text: string): string {
  if (isJsonObjectText(text)) {
    return text;
  }

  let suffixEnd = text.length;
  while (suffixEnd > 0 && isWhitespaceCharacter(text[suffixEnd - 1])) suffixEnd--;
  if (suffixEnd < 2 || text[suffixEnd - 1] !== '"' || text[suffixEnd - 2] !== '"') {
    return text;
  }

  let headEnd = suffixEnd - 2;
  while (headEnd > 0 && isWhitespaceCharacter(text[headEnd - 1])) headEnd--;
  const head = text.slice(0, headEnd);
  return isJsonObjectText(head) ? head : text;
}
