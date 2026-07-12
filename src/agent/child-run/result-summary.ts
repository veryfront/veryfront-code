const CHILD_RUN_RESULT_TEXT_LIMIT = 64_000;
const CHILD_RUN_VALUE_STRING_LIMIT = 500;
const CHILD_RUN_VALUE_SUMMARY_MAX_DEPTH = 5;
const CHILD_RUN_CONTRACT_FACT_LIMIT = 50;
const CHILD_RUN_CONTRACT_FACT_VALUE_MAX_LENGTH = 200;
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
const MODEL_FIELD_PATTERN = /(?:^|[,{(\s])["']?model["']?\s*[:=]\s*["']([^"'`\s]+)["']/gim;
const MODEL_ID_PATTERN =
  /\b(?:veryfront-cloud\/)?(?:anthropic|openai|google|mistral|xai|deepseek|moonshot|cohere|perplexity|groq|azure)\/[A-Za-z0-9._:-]+\b/g;
const TOOL_IDS_FIELD_PATTERN =
  /(?:^|[,{(\s])["']?(?:tool_ids|tools)["']?\s*[:=]\s*\[([\s\S]*?)\]/gim;
const PROVIDER_TOOL_IDS_FIELD_PATTERN =
  /(?:^|[,{(\s])["']?provider_tool_ids["']?\s*[:=]\s*\[([\s\S]*?)\]/gim;
const INTEGRATION_TOOL_ID_PATTERN = /\b[a-z][a-z0-9-]*__[a-z][a-z0-9_-]*\b/g;
const IMPORT_FROM_PATTERN = /\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_PATTERN = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const QUOTED_VALUE_PATTERN = /["']([^"']+)["']/g;

/** Result return modes supported by delegated child runs. */
export type ChildRunResultMode = "summary" | "full" | "structured";

/** Options accepted when building child run result summaries. */
export type BuildChildRunResultSummaryOptions = {
  mode?: ChildRunResultMode;
};

/** Structured contract facts extracted from delegated result text. */
export type ChildRunContractFacts = {
  modelIds?: string[];
  toolIds?: string[];
  providerToolIds?: string[];
  importPaths?: string[];
};

/** Summary metadata returned to parent runs after child delegation. */
export type ChildRunResultSummary = {
  text: string;
  status?: "complete" | "truncated";
  truncated?: boolean;
  originalChars?: number;
  returnedChars?: number;
  omittedChars?: number;
  limitChars?: number;
  contractFacts?: ChildRunContractFacts;
};

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

function summarizeNormalizedChildRunResultTextWithMetadata(
  normalized: string,
  maxLength: number,
): ChildRunResultSummary {
  if (normalized.length <= maxLength) {
    return {
      text: normalized,
      status: "complete",
      truncated: false,
      originalChars: normalized.length,
      returnedChars: normalized.length,
      omittedChars: 0,
      limitChars: maxLength,
    };
  }

  const omittedChars = normalized.length - maxLength;
  const summaryText = `${normalized.slice(0, maxLength)}… [truncated ${omittedChars} chars]`;

  return {
    text: summaryText,
    status: "truncated",
    truncated: true,
    originalChars: normalized.length,
    returnedChars: summaryText.length,
    omittedChars,
    limitChars: maxLength,
  };
}

function isContractFactValue(value: string): boolean {
  return value.length > 0 &&
    value.length <= CHILD_RUN_CONTRACT_FACT_VALUE_MAX_LENGTH &&
    !/\s/.test(value);
}

function addContractFact(target: string[], value: string): void {
  if (
    target.length >= CHILD_RUN_CONTRACT_FACT_LIMIT ||
    !isContractFactValue(value) ||
    target.includes(value)
  ) {
    return;
  }

  target.push(value);
}

function addPatternMatches(
  target: string[],
  text: string,
  pattern: RegExp,
  group = 0,
): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[group];
    if (typeof value === "string") {
      addContractFact(target, value);
    }
  }
}

function extractQuotedValues(text: string): string[] {
  const values: string[] = [];
  addPatternMatches(values, text, QUOTED_VALUE_PATTERN, 1);
  return values;
}

function addArrayFieldValues(
  target: string[],
  text: string,
  pattern: RegExp,
): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const fieldBody = match[1];
    if (typeof fieldBody !== "string") {
      continue;
    }
    for (const value of extractQuotedValues(fieldBody)) {
      addContractFact(target, value);
    }
  }
}

function contractFactsOrUndefined(input: {
  modelIds: string[];
  toolIds: string[];
  providerToolIds: string[];
  importPaths: string[];
}): ChildRunContractFacts | undefined {
  const facts: ChildRunContractFacts = {};
  if (input.modelIds.length > 0) {
    facts.modelIds = input.modelIds;
  }
  if (input.toolIds.length > 0) {
    facts.toolIds = input.toolIds;
  }
  if (input.providerToolIds.length > 0) {
    facts.providerToolIds = input.providerToolIds;
  }
  if (input.importPaths.length > 0) {
    facts.importPaths = input.importPaths;
  }

  return Object.keys(facts).length > 0 ? facts : undefined;
}

/** Extract structured contract facts from delegated result text. */
export function extractChildRunContractFacts(text: string): ChildRunContractFacts | undefined {
  const modelIds: string[] = [];
  const toolIds: string[] = [];
  const providerToolIds: string[] = [];
  const importPaths: string[] = [];

  addPatternMatches(modelIds, text, MODEL_FIELD_PATTERN, 1);
  addPatternMatches(modelIds, text, MODEL_ID_PATTERN);
  addArrayFieldValues(toolIds, text, TOOL_IDS_FIELD_PATTERN);
  addArrayFieldValues(providerToolIds, text, PROVIDER_TOOL_IDS_FIELD_PATTERN);
  addPatternMatches(toolIds, text, INTEGRATION_TOOL_ID_PATTERN);
  addPatternMatches(importPaths, text, IMPORT_FROM_PATTERN, 1);
  addPatternMatches(importPaths, text, BARE_IMPORT_PATTERN, 1);
  addPatternMatches(importPaths, text, DYNAMIC_IMPORT_PATTERN, 1);

  return contractFactsOrUndefined({
    modelIds,
    toolIds,
    providerToolIds,
    importPaths,
  });
}

function withContractFacts(
  summary: ChildRunResultSummary,
  text: string,
): ChildRunResultSummary {
  const contractFacts = extractChildRunContractFacts(text);
  return contractFacts ? { ...summary, contractFacts } : summary;
}

/** Summarize child run result text helper. */
export function summarizeChildRunResultText(
  text: string,
  maxLength = CHILD_RUN_RESULT_TEXT_LIMIT,
): string {
  return summarizeChildRunResultTextWithMetadata(text, maxLength).text;
}

/** Summarize child run result text with machine-readable truncation metadata. */
export function summarizeChildRunResultTextWithMetadata(
  text: string,
  maxLength = CHILD_RUN_RESULT_TEXT_LIMIT,
): ChildRunResultSummary {
  const normalized = sanitizeMalformedToolTranscriptText(text);
  return summarizeNormalizedChildRunResultTextWithMetadata(normalized, maxLength);
}

/** Builds child run result summary. */
export function buildChildRunResultSummary(
  text: string,
  options: BuildChildRunResultSummaryOptions = {},
): ChildRunResultSummary {
  const normalized = options.mode === "full" ? text : sanitizeMalformedToolTranscriptText(text);
  const maxLength = options.mode === "full" ? normalized.length : CHILD_RUN_RESULT_TEXT_LIMIT;
  const summary = summarizeNormalizedChildRunResultTextWithMetadata(normalized, maxLength);

  return options.mode === "structured" ? withContractFacts(summary, normalized) : summary;
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
