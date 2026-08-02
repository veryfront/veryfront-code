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
  if (budget.fragments >= MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS) {
    return "fragments";
  }

  const fragmentBytes = TOOL_ARGUMENT_ENCODER.encode(fragment).byteLength;
  if (fragmentBytes > MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES - budget.bytes) {
    return "bytes";
  }

  budget.fragments++;
  budget.bytes += fragmentBytes;
  if (fragment.length > 0) {
    chunks.push(fragment);
  }
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
