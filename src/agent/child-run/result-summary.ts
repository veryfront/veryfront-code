const CHILD_RUN_RESULT_TEXT_LIMIT = 4_000;
const CHILD_RUN_VALUE_STRING_LIMIT = 500;
const CHILD_RUN_VALUE_SUMMARY_MAX_DEPTH = 5;
const MALFORMED_TOOL_RESPONSE_PATTERN = /<tool_response(?:\s[^>]*)?>([\s\S]*?)<\/tool_response>/gi;
const MALFORMED_TOOL_COMMAND_PREFIX_PATTERN =
  /<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?(?=<(?:tool_response|function_result)(?:\s[^>]*)?>)/gi;
const MALFORMED_TOOL_CALL_PATTERN =
  /<(tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;
const MALFORMED_TOOL_TAG_PATTERN =
  /<\/?(tool_call|tool_response|function_calls|invoke|parameter|function_result)(?:\s[^>]*)?>/gi;
const MALFORMED_TOOL_TRANSCRIPT_FENCE_PATTERN =
  /```[ \t]*(?:\r?\n)?[ \t]*(?:bash|sh|shell|zsh)[ \t]*(?:\r?\n)?```(?=\s*<(?:tool_call|tool_response|function_calls|invoke|function_result)\b)/gi;
const ROOT_RESPONSE_PROCESS_PREFIX_PATTERNS = [
  /^let me [^.?!]+[.?!]\s*/i,
  /^i(?:'|’)ll [^.?!]+[.?!]\s*/i,
  /^i will [^.?!]+[.?!]\s*/i,
  /^now i have [^.?!]+[.?!]\s*/i,
  /^first,? [^.?!]+[.?!]\s*/i,
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeMalformedToolTranscriptText(text: string): string {
  return text
    .replace(MALFORMED_TOOL_TRANSCRIPT_FENCE_PATTERN, "")
    .replace(MALFORMED_TOOL_RESPONSE_PATTERN, "\n$1\n")
    .replace(MALFORMED_TOOL_COMMAND_PREFIX_PATTERN, "\n")
    .replace(MALFORMED_TOOL_CALL_PATTERN, "\n")
    .replace(MALFORMED_TOOL_TAG_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Summarize child run result text helper. */
export function summarizeChildRunResultText(
  text: string,
  maxLength = CHILD_RUN_RESULT_TEXT_LIMIT,
): string {
  const normalized = sanitizeMalformedToolTranscriptText(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}… [truncated ${normalized.length - maxLength} chars]`;
}

/** Builds child run result summary. */
export function buildChildRunResultSummary(text: string): { text: string } {
  return { text: summarizeChildRunResultText(text) };
}

/** Builds root owned child run result text. */
export function buildRootOwnedChildRunResultText(text: string): string {
  let normalized = text.trim();

  for (const pattern of ROOT_RESPONSE_PROCESS_PREFIX_PATTERNS) {
    normalized = normalized.replace(pattern, "").trimStart();
  }

  if (normalized.length === 0) {
    return text.trim();
  }

  return normalized;
}

/** Builds root owned child run result hint. */
export function buildRootOwnedChildRunResultHint(
  input: { text: string; instruction: string },
): { instruction: string; suggestedText: string } {
  return {
    instruction: input.instruction,
    suggestedText: summarizeChildRunResultText(buildRootOwnedChildRunResultText(input.text)),
  };
}

/** Summarize child run result value helper. */
export function summarizeChildRunResultValue(output: unknown, depth = 0): unknown {
  if (typeof output === "string") {
    return summarizeChildRunResultText(output, CHILD_RUN_VALUE_STRING_LIMIT);
  }

  if (output == null || typeof output !== "object") {
    return output;
  }

  if (depth >= CHILD_RUN_VALUE_SUMMARY_MAX_DEPTH) {
    return "[truncated nested data]";
  }

  if (Array.isArray(output)) {
    return output.map((item) => summarizeChildRunResultValue(item, depth + 1));
  }

  if (!isPlainRecord(output)) {
    return output;
  }

  if ("content" in output && typeof output.content === "string" && output.content.length > 200) {
    const { content: _content, ...rest } = output;
    return Object.fromEntries(
      Object.entries(rest).map((
        [key, value],
      ) => [key, summarizeChildRunResultValue(value, depth + 1)]),
    );
  }

  if ("files" in output && Array.isArray(output.files)) {
    const files = output.files.map((file) => {
      if (!isPlainRecord(file)) {
        return summarizeChildRunResultValue(file, depth + 1);
      }

      return Object.fromEntries(
        Object.entries(file)
          .filter(([key]) => key !== "content")
          .map(([key, value]) => [key, summarizeChildRunResultValue(value, depth + 1)]),
      );
    });

    return {
      ...Object.fromEntries(
        Object.entries(output)
          .filter(([key]) => key !== "files")
          .map(([key, value]) => [key, summarizeChildRunResultValue(value, depth + 1)]),
      ),
      files,
    };
  }

  if ("chunks" in output && Array.isArray(output.chunks)) {
    const chunks = output.chunks.map((chunk) => {
      if (!isPlainRecord(chunk)) {
        return summarizeChildRunResultValue(chunk, depth + 1);
      }

      return Object.fromEntries(
        Object.entries(chunk)
          .filter(([key]) => key !== "content")
          .map(([key, value]) => [key, summarizeChildRunResultValue(value, depth + 1)]),
      );
    });

    return {
      ...Object.fromEntries(
        Object.entries(output)
          .filter(([key]) => key !== "chunks")
          .map(([key, value]) => [key, summarizeChildRunResultValue(value, depth + 1)]),
      ),
      chunks,
    };
  }

  return Object.fromEntries(
    Object.entries(output).map((
      [key, value],
    ) => [key, summarizeChildRunResultValue(value, depth + 1)]),
  );
}
