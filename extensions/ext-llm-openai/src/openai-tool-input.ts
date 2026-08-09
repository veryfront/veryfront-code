export const MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES = 1_048_576;
export const MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS = 4_096;

export type OpenAIStreamToolArgumentBudget = {
  bytes: number;
  fragments: number;
};

const TOOL_ARGUMENT_ENCODER = new TextEncoder();

export function appendOpenAIStreamToolArgument(
  budget: OpenAIStreamToolArgumentBudget,
  chunks: string[],
  fragment: string,
): "bytes" | "fragments" | undefined {
  const fragmentBytes = TOOL_ARGUMENT_ENCODER.encode(fragment).byteLength;

  // Zero-byte fragments never advance the byte budget, so they are the only
  // ones that can arrive without bound -- and they are what the fragment cap
  // exists to stop. Both provider streams exercise it exactly that way, by
  // flooding empty deltas.
  //
  // Counting non-empty fragments here too made the cap bind long before the
  // byte budget: at typical delta sizes, 4096 fragments is roughly 2-8% of the
  // 1 MiB a tool call is nominally allowed, which left the byte limit
  // unreachable. Fragment count is chosen by the provider's tokenizer rather
  // than by the caller, so the same tool call passed or failed depending on how
  // the stream happened to be chunked.
  if (fragmentBytes === 0) {
    if (budget.fragments >= MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS) {
      return "fragments";
    }
    budget.fragments++;
    return undefined;
  }

  if (fragmentBytes > MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES - budget.bytes) {
    return "bytes";
  }

  // Content is bounded by bytes: every fragment kept here is at least one byte,
  // so the array cannot outgrow the byte budget.
  budget.bytes += fragmentBytes;
  chunks.push(fragment);
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
