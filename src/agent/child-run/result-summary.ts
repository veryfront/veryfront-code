const CHILD_RUN_RESULT_TEXT_LIMIT = 64_000;
const CHILD_RUN_VALUE_STRING_LIMIT = 500;
const CHILD_RUN_VALUE_SUMMARY_MAX_DEPTH = 5;
const CHILD_RUN_CONTRACT_FACT_LIMIT = 50;
const CHILD_RUN_CONTRACT_FACT_VALUE_MAX_LENGTH = 200;
const CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT = 128_000;
const CHILD_RUN_CONTRACT_FACT_ARRAY_BODY_LIMIT = 2_000;
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
  /\b(?:veryfront-cloud\/)?(?:anthropic|openai|google|google-ai-studio|mistral|xai|deepseek|moonshot|moonshotai|cohere|perplexity|groq|azure)\/[A-Za-z0-9._:-]+\b/g;
const TOOL_IDS_FIELD_PATTERN = /(?:^|[,{(\s])["']?(tool_ids|tools)["']?\s*[:=]\s*\[/gim;
const PROVIDER_TOOL_IDS_FIELD_PATTERN = /(?:^|[,{(\s])["']?provider_tool_ids["']?\s*[:=]\s*\[/gim;
const INTEGRATION_TOOL_ID_PATTERN = /\b[a-z][a-z0-9-]*__[a-z][a-z0-9_-]*\b/g;
const TOOL_ID_VALUE_PATTERN = /^[a-z][a-z0-9]*(?:(?:__|[_-])[a-z0-9]+)+$/;
const IMPORT_FROM_PATTERN = /\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_PATTERN = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

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

function addToolIdFact(target: string[], value: string): void {
  if (TOOL_ID_VALUE_PATTERN.test(value)) {
    addContractFact(target, value);
  }
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

function parseJsonArrayFieldBody(fieldBody: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(`[${fieldBody}]`);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function scanQuotedValueEnd(text: string, start: number, quote: string): number | undefined {
  let escaped = false;
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote) {
      return index + 1;
    }
  }
  return undefined;
}

function findOuterArrayClosingBracket(text: string): number {
  let depth = 1;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' || character === "'") {
      const end = scanQuotedValueEnd(text, index, character);
      if (end === undefined) return -1;
      index = end - 1;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseCompleteArrayValue(
  text: string,
  start: number,
  end: number,
  quote: string | undefined,
): { ok: true; value: unknown } | { ok: false } {
  const candidate = text.slice(start, end);
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    // Continue with the bounded pseudo-JSON compatibility path below.
  }
  if (quote === "'") {
    const value = decodeSingleQuotedString(candidate.slice(1, -1));
    return value === undefined ? { ok: false } : { ok: true, value };
  }
  if (text[start] === "{") {
    const normalized = normalizeSingleQuotedJson(candidate);
    try {
      return { ok: true, value: JSON.parse(normalized) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

function decodeSingleQuotedString(value: string): string | undefined {
  let decoded = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const escaped = value[++index];
    if (escaped === undefined) return undefined;
    const simpleEscapes: Record<string, string> = {
      "\\": "\\",
      "'": "'",
      '"': '"',
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped in simpleEscapes) {
      decoded += simpleEscapes[escaped];
      continue;
    }
    if (escaped === "u") {
      const hex = value.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return undefined;
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
      continue;
    }
    return undefined;
  }
  return decoded;
}

function parseQuotedScalar(
  text: string,
  start: number,
  end: number,
  quote: string,
): string | undefined {
  const value = text.slice(start + 1, end - 1);
  if (quote === "'") return decodeSingleQuotedString(value);
  try {
    const parsed = JSON.parse(text.slice(start, end));
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSingleQuotedJson(text: string): string {
  let normalized = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '"') {
      const end = scanQuotedValueEnd(text, index, '"');
      if (end === undefined) return text;
      normalized += text.slice(index, end);
      index = end - 1;
      continue;
    }
    if (character !== "'") {
      normalized += character;
      continue;
    }
    const end = scanQuotedValueEnd(text, index, "'");
    if (end === undefined) return text;
    const value = text.slice(index + 1, end - 1);
    const decoded = decodeSingleQuotedString(value);
    if (decoded === undefined) return text;
    normalized += JSON.stringify(decoded);
    index = end - 1;
  }
  return normalized;
}

function addToolIdsFromLeadingObjectFields(target: string[], fieldBody: string): void {
  let objectDepth = 0;
  let arrayDepth = 0;

  for (let index = 0; index < fieldBody.length;) {
    const character = fieldBody[index]!;
    if (character === '"' || character === "'") {
      const end = scanQuotedValueEnd(fieldBody, index, character);
      if (end === undefined) return;
      if (objectDepth === 1 && arrayDepth === 0) {
        const key = parseQuotedScalar(fieldBody, index, end, character);
        let valueStart = end;
        while (/\s/.test(fieldBody[valueStart] ?? "")) valueStart += 1;
        if ((key === "id" || key === "name") && fieldBody[valueStart] === ":") {
          valueStart += 1;
          while (/\s/.test(fieldBody[valueStart] ?? "")) valueStart += 1;
          const valueQuote = fieldBody[valueStart];
          if (valueQuote === '"' || valueQuote === "'") {
            const valueEnd = scanQuotedValueEnd(fieldBody, valueStart, valueQuote);
            if (valueEnd === undefined) return;
            const value = parseQuotedScalar(fieldBody, valueStart, valueEnd, valueQuote);
            if (value !== undefined) addToolIdFact(target, value);
            index = valueEnd;
            continue;
          }
        }
      }
      index = end;
      continue;
    }
    if (character === "{") objectDepth += 1;
    else if (character === "}") objectDepth = Math.max(0, objectDepth - 1);
    else if (objectDepth > 0 && character === "[") arrayDepth += 1;
    else if (objectDepth > 0 && character === "]") arrayDepth = Math.max(0, arrayDepth - 1);
    index += 1;
  }
}

function parseCompleteLeadingArrayValues(fieldBody: string): unknown[] {
  const values: unknown[] = [];
  let index = 0;

  while (index < fieldBody.length) {
    while (/\s/.test(fieldBody[index] ?? "")) index += 1;
    if (index >= fieldBody.length) break;

    const valueStart = index;
    const opening = fieldBody[index];
    let valueEnd: number;
    if (opening === '"' || opening === "'") {
      const end = scanQuotedValueEnd(fieldBody, index, opening);
      if (end === undefined) break;
      index = end;
      valueEnd = end;
    } else if (opening === "{" || opening === "[") {
      const closings = [opening === "{" ? "}" : "]"];
      index += 1;
      while (index < fieldBody.length && closings.length > 0) {
        const character = fieldBody[index];
        if (character === '"' || character === "'") {
          const end = scanQuotedValueEnd(fieldBody, index, character);
          if (end === undefined) break;
          index = end;
          continue;
        }
        index += 1;
        if (character === "{") closings.push("}");
        else if (character === "[") closings.push("]");
        else if (character === closings[closings.length - 1]) closings.pop();
      }
      if (closings.length > 0) break;
      valueEnd = index;
    } else {
      while (index < fieldBody.length && fieldBody[index] !== ",") index += 1;
      valueEnd = index;
    }

    while (/\s/.test(fieldBody[index] ?? "")) index += 1;
    if (index < fieldBody.length && fieldBody[index] !== ",") break;

    const parsed = parseCompleteArrayValue(fieldBody, valueStart, valueEnd, opening);
    if (!parsed.ok) break;
    values.push(parsed.value);

    if (index >= fieldBody.length) break;
    index += 1;
  }

  return values;
}

function addToolIdsFromParsedArray(
  target: string[],
  values: unknown[],
  includeObjectFields: boolean,
): void {
  for (const value of values) {
    if (typeof value === "string") {
      addToolIdFact(target, value);
      continue;
    }

    if (!includeObjectFields || !isPlainRecord(value)) {
      continue;
    }

    for (const key of ["id", "name"] as const) {
      const fieldValue = value[key];
      if (typeof fieldValue === "string") {
        addToolIdFact(target, fieldValue);
      }
    }
  }
}

function addToolIdsFromFieldBody(
  target: string[],
  fieldBody: string,
  includeObjectFields: boolean,
): void {
  const parsedValues = parseJsonArrayFieldBody(fieldBody);
  if (parsedValues) {
    addToolIdsFromParsedArray(target, parsedValues, includeObjectFields);
    return;
  }

  addToolIdsFromParsedArray(
    target,
    parseCompleteLeadingArrayValues(fieldBody),
    includeObjectFields,
  );
  if (includeObjectFields) addToolIdsFromLeadingObjectFields(target, fieldBody);
}

function addToolArrayFieldValues(
  target: string[],
  text: string,
  pattern: RegExp,
): void {
  pattern.lastIndex = 0;
  let inspectedFields = 0;
  for (const match of text.matchAll(pattern)) {
    if (inspectedFields >= CHILD_RUN_CONTRACT_FACT_LIMIT) return;
    inspectedFields += 1;
    const fieldName = match[1];
    const bodyStart = match.index + match[0].length;
    const boundedBody = text.slice(
      bodyStart,
      bodyStart + CHILD_RUN_CONTRACT_FACT_ARRAY_BODY_LIMIT,
    );
    const closingBracket = findOuterArrayClosingBracket(boundedBody);
    const fieldBody = closingBracket === -1 ? boundedBody : boundedBody.slice(0, closingBracket);
    addToolIdsFromFieldBody(target, fieldBody, fieldName === "tools");
    if (fieldName === "tools" && target.length < CHILD_RUN_CONTRACT_FACT_LIMIT) {
      // Full JSON parsing stays under the small per-field cap above. A tool
      // object's top-level id/name can safely be scanned farther within the
      // already bounded head/tail window, so long descriptions or schemas do
      // not hide an identifier that follows them.
      const windowBody = text.slice(bodyStart);
      const windowClosingBracket = findOuterArrayClosingBracket(windowBody);
      addToolIdsFromLeadingObjectFields(
        target,
        windowClosingBracket === -1 ? windowBody : windowBody.slice(0, windowClosingBracket),
      );
    }
    if (target.length >= CHILD_RUN_CONTRACT_FACT_LIMIT) return;
  }
}

function addProviderToolArrayFieldValues(
  target: string[],
  text: string,
  pattern: RegExp,
): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const bodyStart = match.index + match[0].length;
    const boundedBody = text.slice(
      bodyStart,
      bodyStart + CHILD_RUN_CONTRACT_FACT_ARRAY_BODY_LIMIT,
    );
    const closingBracket = findOuterArrayClosingBracket(boundedBody);
    const fieldBody = closingBracket === -1 ? boundedBody : boundedBody.slice(0, closingBracket);
    addToolIdsFromParsedArray(target, parseCompleteLeadingArrayValues(fieldBody), false);
    if (target.length >= CHILD_RUN_CONTRACT_FACT_LIMIT) return;
  }
}

function isContractFactTokenCharacter(value: string | undefined): boolean {
  return value !== undefined && !/[\s"'`]/.test(value);
}

function boundedContractFactWindows(text: string): string[] {
  if (text.length <= CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT) return [text];

  const windowLength = CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT / 2;
  let headEnd = windowLength;
  while (
    headEnd > 0 && isContractFactTokenCharacter(text[headEnd - 1]) &&
    isContractFactTokenCharacter(text[headEnd])
  ) {
    headEnd -= 1;
  }

  let tailStart = text.length - windowLength;
  while (
    tailStart < text.length && isContractFactTokenCharacter(text[tailStart - 1]) &&
    isContractFactTokenCharacter(text[tailStart])
  ) {
    tailStart += 1;
  }

  return [text.slice(0, headEnd), text.slice(tailStart)];
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

/** Extract structured contract facts from a bounded head-and-tail text window. */
export function extractChildRunContractFacts(text: string): ChildRunContractFacts | undefined {
  const modelIds: string[] = [];
  const toolIds: string[] = [];
  const providerToolIds: string[] = [];
  const importPaths: string[] = [];

  const windows = boundedContractFactWindows(text);
  for (const boundedText of windows) {
    addPatternMatches(modelIds, boundedText, MODEL_FIELD_PATTERN, 1);
  }
  for (const boundedText of windows) {
    addPatternMatches(modelIds, boundedText, MODEL_ID_PATTERN);
  }
  for (const boundedText of windows) {
    addToolArrayFieldValues(toolIds, boundedText, TOOL_IDS_FIELD_PATTERN);
  }
  for (const boundedText of windows) {
    addProviderToolArrayFieldValues(providerToolIds, boundedText, PROVIDER_TOOL_IDS_FIELD_PATTERN);
  }
  for (const boundedText of windows) {
    addPatternMatches(toolIds, boundedText, INTEGRATION_TOOL_ID_PATTERN);
  }
  for (const boundedText of windows) {
    addPatternMatches(importPaths, boundedText, IMPORT_FROM_PATTERN, 1);
  }
  for (const boundedText of windows) {
    addPatternMatches(importPaths, boundedText, BARE_IMPORT_PATTERN, 1);
  }
  for (const boundedText of windows) {
    addPatternMatches(importPaths, boundedText, DYNAMIC_IMPORT_PATTERN, 1);
  }

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
