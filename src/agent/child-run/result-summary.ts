const CHILD_RUN_RESULT_TEXT_LIMIT = 64_000;
const CHILD_RUN_VALUE_STRING_LIMIT = 500;
const CHILD_RUN_VALUE_SUMMARY_MAX_DEPTH = 5;
const CHILD_RUN_CONTRACT_FACT_LIMIT = 50;
const CHILD_RUN_CONTRACT_FACT_VALUE_MAX_LENGTH = 200;
const CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT = 128_000;
const CHILD_RUN_CONTRACT_FACT_NESTING_LIMIT = 256;
const CHILD_RUN_PROSE_RECOVERY_GAP_LIMIT = 128_000;
const CHILD_RUN_QUOTE_STATE_GAP_LIMIT = 128_000;
const TOOL_TRANSCRIPT_TAG_NAMES = new Set([
  "tool_call",
  "tool_response",
  "function_calls",
  "invoke",
  "parameter",
  "function_result",
]);
const TOOL_TRANSCRIPT_COMMAND_TAG_NAMES = new Set(["tool_call", "function_calls", "invoke"]);
const TOOL_TRANSCRIPT_RESPONSE_TAG_NAMES = new Set(["tool_response", "function_result"]);
const TOOL_RESPONSE_TAG_NAMES = new Set(["tool_response"]);
const TOOL_TRANSCRIPT_SHELL_FENCE_NAMES = new Set(["bash", "sh", "shell", "zsh"]);
const TOOL_TRANSCRIPT_FENCE_TAG_START_PATTERN =
  /^<(?:tool_call|tool_response|function_calls|invoke|function_result)\b/i;
const ROOT_RESPONSE_PROCESS_PREFIX_PATTERNS = [
  /^let me [^.?!]+[.?!]\s*/i,
  /^i(?:'|’)ll [^.?!]+[.?!]\s*/i,
  /^i will [^.?!]+[.?!]\s*/i,
  /^now i have [^.?!]+[.?!]\s*/i,
  /^first,? [^.?!]+[.?!]\s*/i,
];
const MODEL_FIELD_PATTERN = /(?:^|[,{(\s])["']?model["']?\s*[:=]\s*["']([^"'`\s]+)["']/gim;
const MODEL_FIELD_TAIL_PATTERN = /[,{(\s]["']?model["']?\s*[:=]\s*["']([^"'`\s]+)["']/gim;
const MODEL_ID_PATTERN =
  /\b(?:veryfront-cloud\/)?(?:anthropic|openai|google|google-ai-studio|mistral|xai|deepseek|moonshot|moonshotai|cohere|perplexity|groq|azure)\/[A-Za-z0-9._:-]+\b/g;
const TOOL_IDS_FIELD_PATTERN = /(?:^|[,{(\s])["']?(tool_ids|tools)["']?\s*[:=]\s*\[/gim;
const TOOL_IDS_FIELD_TAIL_PATTERN = /[,{(\s]["']?(tool_ids|tools)["']?\s*[:=]\s*\[/gim;
const PROVIDER_TOOL_IDS_FIELD_PATTERN = /(?:^|[,{(\s])["']?provider_tool_ids["']?\s*[:=]\s*\[/gim;
const PROVIDER_TOOL_IDS_FIELD_TAIL_PATTERN = /[,{(\s]["']?provider_tool_ids["']?\s*[:=]\s*\[/gim;
const INTEGRATION_TOOL_ID_PATTERN = /\b[a-z][a-z0-9-]*__[a-z][a-z0-9_-]*\b/g;
const TOOL_ID_VALUE_PATTERN = /^[a-z][a-z0-9]*(?:(?:__|[_-])[a-z0-9]+)+$/;
const IMPORT_FROM_PATTERN = /\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_PATTERN = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const FIELD_SEPARATOR_PATTERN = /[,{(;\s]/;

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

function removeHorizontalWhitespaceBeforeNewlines(text: string): string {
  const chunks: string[] = [];
  let segmentStart = 0;
  let whitespaceStart = -1;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === " " || character === "\t") {
      if (whitespaceStart === -1) whitespaceStart = index;
      continue;
    }
    if (character === "\n" && whitespaceStart !== -1) {
      chunks.push(text.slice(segmentStart, whitespaceStart), "\n");
      segmentStart = index + 1;
    }
    whitespaceStart = -1;
  }

  if (chunks.length === 0) return text;
  chunks.push(text.slice(segmentStart));
  return chunks.join("");
}

type ToolTranscriptTag = {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  exact: boolean;
};

function findToolTranscriptTag(text: string, from: number): ToolTranscriptTag | undefined {
  let cursor = from;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start === -1) return undefined;
    let index = start + 1;
    const closing = text[index] === "/";
    if (closing) index += 1;
    const nameStart = index;
    while (/[A-Za-z_]/.test(text[index] ?? "")) index += 1;
    const name = text.slice(nameStart, index).toLowerCase();
    if (
      TOOL_TRANSCRIPT_TAG_NAMES.has(name) &&
      (text[index] === ">" || /\s/.test(text[index] ?? ""))
    ) {
      const tagEnd = text.indexOf(">", index);
      if (tagEnd === -1) return undefined;
      return { start, end: tagEnd + 1, name, closing, exact: tagEnd === index };
    }
    cursor = start + 1;
  }
  return undefined;
}

function removeToolTranscriptFences(text: string): string {
  let output = "";
  let segmentStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("```", cursor);
    if (start === -1) break;
    let index = start + 3;
    while (text[index] === " " || text[index] === "\t") index += 1;
    if (text[index] === "\r" && text[index + 1] === "\n") index += 2;
    else if (text[index] === "\n") index += 1;
    while (text[index] === " " || text[index] === "\t") index += 1;
    const shellStart = index;
    while (/[A-Za-z]/.test(text[index] ?? "")) index += 1;
    if (!TOOL_TRANSCRIPT_SHELL_FENCE_NAMES.has(text.slice(shellStart, index).toLowerCase())) {
      cursor = start + 3;
      continue;
    }
    while (text[index] === " " || text[index] === "\t") index += 1;
    if (text[index] === "\r" && text[index + 1] === "\n") index += 2;
    else if (text[index] === "\n") index += 1;
    while (text[index] === " " || text[index] === "\t") index += 1;
    if (text.slice(index, index + 3) !== "```") {
      cursor = start + 3;
      continue;
    }
    const end = index + 3;
    let tagStart = end;
    while (/\s/.test(text[tagStart] ?? "")) tagStart += 1;
    if (!TOOL_TRANSCRIPT_FENCE_TAG_START_PATTERN.test(text.slice(tagStart))) {
      cursor = Math.max(start + 3, tagStart);
      continue;
    }
    output += text.slice(segmentStart, start);
    segmentStart = end;
    cursor = end;
  }
  return segmentStart === 0 ? text : output + text.slice(segmentStart);
}

function lastClosingTagStarts(text: string): Map<string, number> {
  const starts = new Map<string, number>();
  let cursor = 0;
  for (let tag = findToolTranscriptTag(text, cursor); tag !== undefined;) {
    if (tag.closing && tag.exact) starts.set(tag.name, tag.start);
    cursor = tag.end;
    tag = findToolTranscriptTag(text, cursor);
  }
  return starts;
}

function replaceCompleteToolTranscriptSections(
  text: string,
  names: ReadonlySet<string>,
  preserveBody: boolean,
): string {
  const lastClosing = lastClosingTagStarts(text);
  let output = "";
  let segmentStart = 0;
  let cursor = 0;
  for (let opener = findToolTranscriptTag(text, cursor); opener !== undefined;) {
    if (opener.closing || !names.has(opener.name)) {
      cursor = opener.end;
      opener = findToolTranscriptTag(text, cursor);
      continue;
    }
    if ((lastClosing.get(opener.name) ?? -1) < opener.end) {
      cursor = opener.end;
      opener = findToolTranscriptTag(text, cursor);
      continue;
    }
    let closing = findToolTranscriptTag(text, opener.end);
    while (
      closing !== undefined && (!closing.closing || !closing.exact || closing.name !== opener.name)
    ) {
      closing = findToolTranscriptTag(text, closing.end);
    }
    if (closing === undefined) break;
    output += text.slice(segmentStart, opener.start) + "\n";
    if (preserveBody) output += text.slice(opener.end, closing.start) + "\n";
    segmentStart = closing.end;
    cursor = closing.end;
    opener = findToolTranscriptTag(text, cursor);
  }
  return segmentStart === 0 ? text : output + text.slice(segmentStart);
}

function removeToolCommandPrefixes(text: string): string {
  let lastResponseStart = -1;
  let cursor = 0;
  for (let tag = findToolTranscriptTag(text, cursor); tag !== undefined;) {
    if (!tag.closing && TOOL_TRANSCRIPT_RESPONSE_TAG_NAMES.has(tag.name)) {
      lastResponseStart = tag.start;
    }
    cursor = tag.end;
    tag = findToolTranscriptTag(text, cursor);
  }
  if (lastResponseStart === -1) return text;

  let output = "";
  let segmentStart = 0;
  cursor = 0;
  for (let command = findToolTranscriptTag(text, cursor); command !== undefined;) {
    if (
      command.closing || !TOOL_TRANSCRIPT_COMMAND_TAG_NAMES.has(command.name) ||
      command.start > lastResponseStart
    ) {
      cursor = command.end;
      command = findToolTranscriptTag(text, cursor);
      continue;
    }
    let response = findToolTranscriptTag(text, command.end);
    while (
      response !== undefined &&
      (response.closing || !TOOL_TRANSCRIPT_RESPONSE_TAG_NAMES.has(response.name))
    ) response = findToolTranscriptTag(text, response.end);
    if (response === undefined) break;
    output += text.slice(segmentStart, command.start) + "\n";
    segmentStart = response.start;
    cursor = response.end;
    command = findToolTranscriptTag(text, cursor);
  }
  return segmentStart === 0 ? text : output + text.slice(segmentStart);
}

function removeToolTranscriptTags(text: string): string {
  let output = "";
  let segmentStart = 0;
  let cursor = 0;
  for (let tag = findToolTranscriptTag(text, cursor); tag !== undefined;) {
    output += text.slice(segmentStart, tag.start);
    segmentStart = tag.end;
    cursor = tag.end;
    tag = findToolTranscriptTag(text, cursor);
  }
  return segmentStart === 0 ? text : output + text.slice(segmentStart);
}

function sanitizeMalformedToolTranscriptText(text: string): string {
  let sanitized = removeToolTranscriptFences(text);
  sanitized = replaceCompleteToolTranscriptSections(
    sanitized,
    TOOL_RESPONSE_TAG_NAMES,
    true,
  );
  sanitized = removeToolCommandPrefixes(sanitized);
  sanitized = replaceCompleteToolTranscriptSections(
    sanitized,
    TOOL_TRANSCRIPT_COMMAND_TAG_NAMES,
    false,
  );
  sanitized = removeToolTranscriptTags(sanitized);
  return removeHorizontalWhitespaceBeforeNewlines(sanitized)
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
  trailingSourceCharacter?: string,
): void {
  pattern.lastIndex = 0;
  let truncatedTokenStart = text.length;
  if (
    trailingSourceCharacter !== undefined &&
    /[A-Za-z0-9_@./:+-]/.test(trailingSourceCharacter)
  ) {
    while (
      truncatedTokenStart > 0 &&
      /[A-Za-z0-9_@./:+-]/.test(text[truncatedTokenStart - 1]!)
    ) truncatedTokenStart--;
  }
  for (const match of text.matchAll(pattern)) {
    if (
      truncatedTokenStart < text.length &&
      match.index + match[0].length > truncatedTokenStart
    ) continue;
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

function scanQuotedValueEnd(
  text: string,
  start: number,
  quote: string,
  escaped = false,
): number | undefined {
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

function hasValidQuotedValuePrefix(
  text: string,
  start: number,
  quote: string,
  trailingSource?: string,
): boolean {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index]!;
    if ((character.codePointAt(0) ?? 0) < 0x20) return false;
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const escapeEnd = validQuotedEscapeEnd(text, index, quote, trailingSource);
    if (escapeEnd === null) return false;
    if (escapeEnd === undefined) return true;
    index = escapeEnd;
  }
  return true;
}

function validQuotedEscapeEnd(
  text: string,
  backslash: number,
  quote: string,
  trailingSource: string | undefined,
): number | null | undefined {
  const escaped = text[backslash + 1];
  if (escaped === undefined) {
    return hasValidBoundaryEscape(trailingSource, quote) ? undefined : null;
  }
  if (escaped !== "u") {
    return isSimpleQuotedEscape(escaped, quote) ? backslash + 2 : null;
  }
  const availableHex = text.slice(backslash + 2, Math.min(backslash + 6, text.length));
  if (!isValidUnicodeEscapePrefix(availableHex, trailingSource)) return null;
  return availableHex.length < 4 ? undefined : backslash + 6;
}

function isSimpleQuotedEscape(value: string, quote: string): boolean {
  return value === "\\" || value === '"' || value === "/" ||
    value === "b" || value === "f" || value === "n" ||
    value === "r" || value === "t" || (quote === "'" && value === "'");
}

function isHexPrefix(value: string): boolean {
  return value.length <= 4 && /^[\da-f]*$/i.test(value);
}

function hasValidBoundaryEscape(trailingSource: string | undefined, quote: string): boolean {
  if (!trailingSource) return false;
  const boundaryEscape = trailingSource[0]!;
  return boundaryEscape === "u"
    ? trailingSource.length >= 5 && isHexPrefix(trailingSource.slice(1, 5))
    : isSimpleQuotedEscape(boundaryEscape, quote);
}

function isValidUnicodeEscapePrefix(
  availableHex: string,
  trailingSource: string | undefined,
): boolean {
  if (!isHexPrefix(availableHex)) return false;
  if (availableHex.length === 4) return true;
  if (trailingSource === undefined || trailingSource.length < 4 - availableHex.length) return false;
  return isHexPrefix(availableHex + trailingSource.slice(0, 4 - availableHex.length));
}

function sourceCommentEnd(text: string, index: number): number | null | undefined {
  if (text[index] !== "/") return undefined;
  if (text[index + 1] === "/") {
    const newline = text.indexOf("\n", index + 2);
    return newline === -1 ? text.length : newline;
  }
  if (text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);
    return end === -1 ? null : end + 2;
  }
  return undefined;
}

function findOuterArrayClosingBracket(text: string): number {
  let depth = 1;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const commentEnd = sourceCommentEnd(text, index);
    if (commentEnd === null) return -1;
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = scanQuotedValueEnd(text, index, character);
      if (end === undefined) return -1;
      index = end;
    } else if (character === "[") {
      depth += 1;
      index += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
      index += 1;
    } else {
      index += 1;
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
  if (text[start] === "{" || text[start] === "[") {
    const normalized = normalizePseudoJson(candidate);
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
      decoded += String.fromCodePoint(Number.parseInt(hex, 16));
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

function removeTrailingJsonCommas(text: string): string {
  const chunks: string[] = [];
  let segmentStart = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      const end = scanQuotedValueEnd(text, index, character);
      if (end === undefined) return text;
      index = end;
      continue;
    }
    if (character !== ",") {
      index += 1;
      continue;
    }
    const closing = skipWhitespace(text, index + 1);
    if (text[closing] !== "}" && text[closing] !== "]") {
      index += 1;
      continue;
    }
    let previous = index - 1;
    while (previous >= 0 && /\s/.test(text[previous]!)) previous--;
    if (previous < 0 || "{[,:".includes(text[previous]!)) {
      index++;
      continue;
    }
    chunks.push(text.slice(segmentStart, index), text.slice(index + 1, closing));
    segmentStart = closing;
    index = closing;
  }

  if (chunks.length === 0) return text;
  chunks.push(text.slice(segmentStart));
  return chunks.join("");
}

function normalizePseudoJson(text: string): string {
  let normalized = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    const commentEnd = sourceCommentEnd(text, index);
    if (commentEnd === null) return text;
    if (commentEnd !== undefined) {
      normalized += " ";
      index = commentEnd;
      continue;
    }
    if (character === '"') {
      const end = scanQuotedValueEnd(text, index, '"');
      if (end === undefined) return text;
      normalized += text.slice(index, end);
      index = end;
      continue;
    }
    const identifier = /^[\p{ID_Start}_$][\p{ID_Continue}$]*/u.exec(text.slice(index));
    if (identifier) {
      let previous = normalized.length - 1;
      while (/\s/.test(normalized[previous] ?? "")) previous--;
      const next = skipWhitespace(text, index + identifier[0].length);
      const property = (normalized[previous] === "{" || normalized[previous] === ",") &&
        text[next] === ":";
      normalized += property ? JSON.stringify(identifier[0]) : identifier[0];
      index += identifier[0].length;
      continue;
    }
    if (character !== "'") {
      normalized += character;
      index += 1;
      continue;
    }
    const end = scanQuotedValueEnd(text, index, "'");
    if (end === undefined) return text;
    const value = text.slice(index + 1, end - 1);
    const decoded = decodeSingleQuotedString(value);
    if (decoded === undefined) return text;
    normalized += JSON.stringify(decoded);
    index = end;
  }
  return removeTrailingJsonCommas(normalized);
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (/\s/.test(text[index] ?? "")) index += 1;
  return index;
}

function completeArrayElementEnd(fieldBody: string, start: number): number | undefined {
  const opening = fieldBody[start];
  if (opening === '"' || opening === "'") {
    return scanQuotedValueEnd(fieldBody, start, opening);
  }
  if (opening === "{" || opening === "[") {
    const end = scanNestedArrayOrObjectEnd(fieldBody, start);
    return typeof end === "number" ? end : undefined;
  }
  const comma = fieldBody.indexOf(",", start);
  return comma === -1 ? fieldBody.length : comma;
}

/**
 * Parses complete leading array elements and reports where scanning stopped.
 *
 * `nextIndex` is the offset of the first element that was not consumed, so a
 * caller can resume at the element the window cutoff left incomplete.
 */
function scanCompleteLeadingArrayValues(
  fieldBody: string,
): { values: unknown[]; nextIndex: number } {
  const values: unknown[] = [];
  let index = 0;
  let nextIndex = 0;

  while (index < fieldBody.length) {
    index = skipWhitespace(fieldBody, index);
    if (index >= fieldBody.length) break;

    const valueStart = index;
    const opening = fieldBody[index];
    const valueEnd = completeArrayElementEnd(fieldBody, index);
    if (valueEnd === undefined) break;
    index = skipWhitespace(fieldBody, valueEnd);
    if (index < fieldBody.length && fieldBody[index] !== ",") break;

    const parsed = parseCompleteArrayValue(fieldBody, valueStart, valueEnd, opening);
    if (!parsed.ok) break;
    values.push(parsed.value);

    if (index >= fieldBody.length) break;
    index += 1;
    nextIndex = index;
  }

  return { values, nextIndex };
}

function updateContainerClosings(closings: string[], character: string): boolean {
  if (character === "{" || character === "[") {
    if (closings.length >= CHILD_RUN_CONTRACT_FACT_NESTING_LIMIT) return false;
    closings.push(character === "{" ? "}" : "]");
    return true;
  }
  if (character !== "}" && character !== "]") return true;
  if (character !== closings.at(-1)) return false;
  closings.pop();
  return true;
}

function scanNestedArrayOrObjectEnd(
  fieldBody: string,
  start: number,
): number | null | undefined {
  const closings = [fieldBody[start] === "{" ? "}" : "]"];
  let index = start + 1;

  while (index < fieldBody.length && closings.length > 0) {
    const character = fieldBody[index];
    if (character === '"' || character === "'") {
      const end = scanQuotedValueEnd(fieldBody, index, character);
      if (end === undefined) return undefined;
      index = end;
      continue;
    }
    index += 1;
    if (!updateContainerClosings(closings, character!)) return null;
  }

  if (closings.length > 0) return undefined;
  return parseCompleteArrayValue(fieldBody, start, index, fieldBody[start]).ok ? index : null;
}

function isContractFactScalar(token: string): boolean {
  try {
    const value: unknown = JSON.parse(token);
    return value === null || typeof value === "boolean" || typeof value === "number";
  } catch {
    return false;
  }
}

function scalarPrefixCanContinue(token: string, trailingSource?: string): boolean {
  // A valid prefix can still become an invalid token outside the lookahead.
  // Require a terminator before retaining facts from the enclosing object.
  if (trailingSource === undefined || trailingSource.length === 0) return false;
  for (let index = 0; index < trailingSource.length; index++) {
    if (!/[\s,}\]]/.test(trailingSource[index]!)) continue;
    return isContractFactScalar(token + trailingSource.slice(0, index));
  }
  return false;
}

type PrefixValueScan =
  | { status: "complete"; next: number; value?: unknown }
  | { status: "incomplete" }
  | { status: "invalid" };

type ObjectMemberScan =
  | { status: "complete"; next: number; key: string; value?: unknown }
  | { status: "incomplete" }
  | { status: "invalid" };

function firstTerminator(text: string, start: number, terminators: string): number {
  let index = start;
  while (index < text.length && !terminators.includes(text[index]!)) index += 1;
  return index;
}

function scanQuotedPrefixValue(
  text: string,
  start: number,
  quote: string,
  trailingSource?: string,
): PrefixValueScan {
  const end = scanQuotedValueEnd(text, start, quote);
  if (end === undefined) {
    return hasValidQuotedValuePrefix(text, start, quote, trailingSource)
      ? { status: "incomplete" }
      : { status: "invalid" };
  }
  const value = parseQuotedScalar(text, start, end, quote);
  return value === undefined ? { status: "invalid" } : { status: "complete", next: end, value };
}

function scanNestedPrefixValue(
  text: string,
  start: number,
  trailingSource: string | undefined,
  depth: number,
): PrefixValueScan {
  const end = scanNestedArrayOrObjectEnd(text, start);
  if (end === null) return { status: "invalid" };
  if (end !== undefined) {
    const parsed = parseCompleteArrayValue(text, start, end, text[start]);
    return parsed.ok
      ? { status: "complete", next: end, value: parsed.value }
      : { status: "invalid" };
  }
  if (depth >= CHILD_RUN_CONTRACT_FACT_NESTING_LIMIT) return { status: "invalid" };
  const nested = text.slice(start);
  const valid = text[start] === "{"
    ? scanIncompleteLeadingObjectToolIds(nested, trailingSource, depth + 1) !== undefined
    : isValidIncompleteArrayPrefix(nested, trailingSource, depth + 1);
  return valid ? { status: "incomplete" } : { status: "invalid" };
}

function scanScalarPrefixValue(
  text: string,
  start: number,
  terminators: string,
  trailingSource?: string,
): PrefixValueScan {
  const end = firstTerminator(text, start, terminators);
  const token = text.slice(start, end).trim();
  if (end === text.length) {
    return scalarPrefixCanContinue(token, trailingSource)
      ? { status: "incomplete" }
      : { status: "invalid" };
  }
  if (!isContractFactScalar(token)) return { status: "invalid" };
  return { status: "complete", next: end, value: JSON.parse(token) };
}

function scanPrefixValue(
  text: string,
  start: number,
  terminators: string,
  trailingSource: string | undefined,
  depth: number,
): PrefixValueScan {
  const opening = text[start];
  if (opening === '"' || opening === "'") {
    return scanQuotedPrefixValue(text, start, opening, trailingSource);
  }
  if (opening === "{" || opening === "[") {
    return scanNestedPrefixValue(text, start, trailingSource, depth);
  }
  return scanScalarPrefixValue(text, start, terminators, trailingSource);
}

function isValidIncompleteArrayPrefix(
  fieldBody: string,
  trailingSource?: string,
  depth = 0,
): boolean {
  const validationBody = fieldBody + (trailingSource ?? "");
  let index = skipWhitespace(validationBody, 0);
  if (validationBody[index] !== "[") return false;
  index += 1;
  while (index < validationBody.length) {
    index = skipWhitespace(validationBody, index);
    if (index >= validationBody.length) return true;
    const value = scanPrefixValue(validationBody, index, ",]", undefined, depth);
    if (value.status === "invalid") return false;
    if (value.status === "incomplete") return true;
    index = skipWhitespace(validationBody, value.next);
    if (index >= validationBody.length) return true;
    if (validationBody[index] === "]") return index >= fieldBody.length;
    if (validationBody[index] !== ",") return false;
    index += 1;
  }
  return true;
}

function scanObjectMember(
  fieldBody: string,
  start: number,
  trailingSource: string | undefined,
  depth: number,
): ObjectMemberScan {
  const keyStart = skipWhitespace(fieldBody, start);
  if (keyStart >= fieldBody.length) return { status: "incomplete" };
  const keyQuote = fieldBody[keyStart];
  if (keyQuote !== '"' && keyQuote !== "'") return { status: "invalid" };
  const key = scanQuotedPrefixValue(fieldBody, keyStart, keyQuote, trailingSource);
  if (key.status !== "complete") return key;
  if (typeof key.value !== "string") return { status: "invalid" };

  const colon = skipWhitespace(fieldBody, key.next);
  if (colon >= fieldBody.length) return { status: "incomplete" };
  if (fieldBody[colon] !== ":") return { status: "invalid" };
  const valueStart = skipWhitespace(fieldBody, colon + 1);
  if (valueStart >= fieldBody.length) return { status: "incomplete" };
  const value = scanPrefixValue(fieldBody, valueStart, ",}", trailingSource, depth);
  return value.status === "complete" ? { ...value, key: key.value } : value;
}

function addObjectMemberToolId(
  ids: string[],
  member: ObjectMemberScan,
  withinWindow: boolean,
): void {
  if (
    withinWindow &&
    member.status === "complete" &&
    (member.key === "id" || member.key === "name") &&
    typeof member.value === "string" &&
    ids.length < CHILD_RUN_CONTRACT_FACT_LIMIT
  ) ids.push(member.value);
}

/**
 * Scans a tool object that the bounded window left unclosed.
 *
 * Ids are returned only when the scan runs out of window without meeting
 * invalid member syntax, so an object whose members stop parsing contributes
 * nothing even when an id appears before the malformed text. A completed
 * object returns nothing because complete elements are parsed separately.
 */
function scanIncompleteLeadingObjectToolIds(
  fieldBody: string,
  trailingSource?: string,
  depth = 0,
): string[] | undefined {
  const ids: string[] = [];
  const validationBody = fieldBody + (trailingSource ?? "");
  let index = skipWhitespace(validationBody, 0);
  if (validationBody[index] !== "{") return undefined;
  index += 1;

  while (index < validationBody.length) {
    const member = scanObjectMember(validationBody, index, undefined, depth);
    if (member.status === "invalid") return undefined;
    if (member.status === "incomplete") break;
    addObjectMemberToolId(ids, member, member.next <= fieldBody.length);
    index = skipWhitespace(validationBody, member.next);
    if (index >= validationBody.length || validationBody[index] === "}") break;
    if (validationBody[index] !== ",") return undefined;
    index += 1;
  }

  return ids;
}

function addToolIdsFromIncompleteLeadingObject(
  target: string[],
  fieldBody: string,
  trailingSource?: string,
): void {
  for (
    const id of scanIncompleteLeadingObjectToolIds(fieldBody, trailingSource) ?? []
  ) {
    addToolIdFact(target, id);
  }
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
  const parsedValues = parseJsonArrayFieldBody(fieldBody) ??
    parseJsonArrayFieldBody(normalizePseudoJson(`[${fieldBody}]`).slice(1, -1));
  if (parsedValues) {
    addToolIdsFromParsedArray(target, parsedValues, includeObjectFields);
    return;
  }
}

function* unquotedArrayFieldMatches(text: string, pattern: RegExp): Generator<RegExpExecArray> {
  let cursor = 0;
  let lineStart = 0;
  let apostropheLineStart = -1;
  let inlineCodeEnd = -1;
  let proseApostrophes: ReadonlySet<number> = new Set();
  for (const match of text.matchAll(pattern)) {
    while (cursor < match.index!) {
      const character = text[cursor];
      if (character === "\n") lineStart = cursor + 1;
      if (character === "'") {
        if (apostropheLineStart !== lineStart) {
          apostropheLineStart = lineStart;
          proseApostrophes = gapProseApostrophes(text, lineStart);
        }
        if (proseApostrophes.has(cursor)) {
          cursor++;
          continue;
        }
      }
      if (
        character === "`" && cursor !== inlineCodeEnd - 1 && text[cursor - 1] !== "`" &&
        text[cursor + 1] !== "`"
      ) {
        const inlineCode = /^`[^`\r\n]+`/.exec(text.slice(cursor));
        if (inlineCode && text[cursor + inlineCode[0].length] !== "`") {
          inlineCodeEnd = cursor + inlineCode[0].length;
          const code = inlineCode[0].slice(1, -1).trimStart();
          const configuration = code.includes("{") || code.includes("=") || code.startsWith("[") ||
            /^["']?(?:tools|tool_ids|provider_tool_ids)["']?\s*[:=]/.test(code);
          if (!configuration) {
            cursor = inlineCodeEnd;
            continue;
          }
        }
      }
      if (character === '"' || character === "'") {
        const quoteStart = cursor;
        cursor = scanQuotedValueEnd(text, cursor, character) ?? text.length;
        const newline = text.slice(quoteStart, cursor).lastIndexOf("\n");
        if (newline !== -1) lineStart = quoteStart + newline + 1;
      } else {
        cursor++;
      }
    }
    if (cursor <= match.index!) yield match;
  }
}

function addToolArrayFieldValues(
  target: string[],
  text: string,
  pattern: RegExp,
  allowIncompleteLeadingObject = false,
  trailingSource?: string,
): void {
  pattern.lastIndex = 0;
  let coveredUntil = 0;
  for (const match of unquotedArrayFieldMatches(text, pattern)) {
    if (match.index < coveredUntil) continue;
    const fieldName = match[1];
    const bodyStart = match.index + match[0].length;
    const windowBody = text.slice(bodyStart);
    const closingBracket = findOuterArrayClosingBracket(windowBody);
    if (closingBracket !== -1) {
      addToolIdsFromFieldBody(
        target,
        windowBody.slice(0, closingBracket),
        fieldName === "tools",
      );
      coveredUntil = bodyStart + closingBracket + 1;
    } else {
      // Scan each outer array at most once. Complete sequential arrays occupy
      // disjoint ranges, while one unclosed outer array covers the rest of the
      // bounded window. This reaches facts in every long declaration without
      // letting nested opener-like text turn the work quadratic.
      if (
        allowIncompleteLeadingObject &&
        isValidIncompleteArrayPrefix(`[${windowBody}`, trailingSource)
      ) {
        const scanned = scanCompleteLeadingArrayValues(windowBody);
        addToolIdsFromParsedArray(target, scanned.values, fieldName === "tools");
        if (fieldName === "tools") {
          addToolIdsFromIncompleteLeadingObject(
            target,
            windowBody.slice(scanned.nextIndex),
            trailingSource,
          );
        }
      }
      coveredUntil = text.length;
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
  let coveredUntil = 0;
  for (const match of unquotedArrayFieldMatches(text, pattern)) {
    if (match.index < coveredUntil) continue;
    const bodyStart = match.index + match[0].length;
    const windowBody = text.slice(bodyStart);
    const closingBracket = findOuterArrayClosingBracket(windowBody);
    if (closingBracket !== -1) {
      addToolIdsFromFieldBody(target, windowBody.slice(0, closingBracket), false);
      coveredUntil = bodyStart + closingBracket + 1;
    } else {
      coveredUntil = text.length;
    }
    if (target.length >= CHILD_RUN_CONTRACT_FACT_LIMIT) return;
  }
}

function isContractFactTokenCharacter(value: string | undefined): boolean {
  return value !== undefined && !FIELD_SEPARATOR_PATTERN.test(value) && !/["'`]/.test(value);
}

function maskQuotedProseText(text: string): string {
  const chunks: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const quote = text[index];
    if (quote !== '"' && quote !== "'") continue;
    if (
      quote === "'" && /\p{L}/u.test(text[index - 1] ?? "") && /\p{L}/u.test(text[index + 1] ?? "")
    ) continue;
    const end = scanQuotedValueEnd(text, index, quote);
    if (end === undefined || /[\r\n]/.test(text.slice(index, end))) return text;
    chunks.push(text.slice(start, index), "quote");
    start = end;
    index = end - 1;
  }
  chunks.push(text.slice(start));
  return chunks.join("");
}

function isPlainProseText(text: string): boolean {
  // A balanced single-line code span does not turn an apostrophe in its
  // surrounding prose into a string delimiter. Field scanning still skips
  // the original backtick span, so quoted pseudo-fields cannot become facts.
  const prose = maskQuotedProseText(text.replace(/`[^`\r\n]+`/g, "code"));
  return /^[\p{L}\p{N}\s.,!?:_+>()-]*$/u.test(prose) && !prose.includes("::") &&
    !/(?:^|\r?\n)[ \t]*([.=*_+~-])\1{2,}[ \t]*(?:\r?\n|$)/.test(prose);
}

function startsWithProseWord(text: string): boolean {
  const line = text.replace(
    /^ {0,3}(?:(?:[-+*]|\d+[.)]|>+)\s+)*/,
    "",
  );
  const firstWord = line.match(/^\p{L}+/u)?.[0] ?? "";
  return /^(?:i|we|you|they|he|she|it|this|that|there|a|an|the)$/i.test(firstWord) ||
    /^\p{Lu}+$/u.test(firstWord) || /^\p{Lu}.*\p{Ll}/u.test(firstWord);
}

function isPlainProseApostrophe(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const proseOnly = text.split("\n").map((line) =>
    recoverableContractFactLine(line) === undefined ? line : ""
  ).join("\n");
  return text.slice(0, lineStart).split("\n").every((line) =>
    line.trim().length === 0 || startsWithProseWord(line) ||
    recoverableContractFactLine(line) !== undefined
  ) && startsWithProseWord(text.slice(lineStart)) &&
    gapProseApostrophes(text, lineStart).has(index) &&
    isPlainProseText(normalizeProseApostrophes(proseOnly));
}

function isPrefixedStringQuote(text: string, index: number): boolean {
  let start = index;
  while (start > 0 && /[\p{L}\p{N}_]/u.test(text[start - 1]!)) start--;
  return /^(?:[rbfunex]|br|rb|fr|rf)$/i.test(text.slice(start, index));
}

function normalizeProseApostrophes(text: string): string {
  return text
    .replace(
      /(\p{L})'(?=\p{L})/gu,
      (match, letter: string, offset: number, source: string) =>
        isPrefixedStringQuote(source, offset + letter.length) ? match : letter,
    )
    .replace(/([\p{L}\p{N}_])'(?=(?:s|t|re|ve|ll|d|m)\b)/giu, "$1")
    .replace(/(\b[\p{L}\p{N}_]+s)'(?=\W|$)/giu, "$1")
    .replace(/\b([OD])'(?=\p{Lu})/gu, "$1");
}

function gapProseApostrophes(text: string, lineStart: number): ReadonlySet<number> {
  const lineEnd = text.indexOf("\n", lineStart);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, end);
  const normalizedLine = normalizeProseApostrophes(line);
  if (normalizedLine === line) return new Set();
  const broadProse = startsWithProseWord(line) && isPlainProseText(normalizedLine);

  const indices = new Set<number>();
  for (
    const [patternIndex, pattern] of [
      /(\p{L})'(?=\p{L})/gu,
      /([\p{L}\p{N}_])'(?=(?:s|t|re|ve|ll|d|m)\b)/giu,
      /(\b[\p{L}\p{N}_]+s)'(?=\W|$)/giu,
      /\b([OD])'(?=\p{Lu})/gu,
    ].entries()
  ) {
    if (patternIndex === 0 && !broadProse) continue;
    for (const match of line.matchAll(pattern)) {
      const index = lineStart + match.index + match[0].lastIndexOf("'");
      indices.add(index);
    }
  }
  return indices;
}

function structuredHeadProseApostrophes(text: string): ReadonlySet<number> {
  const apostrophes = new Set<number>();
  let structured = false;
  let jsonFence = false;
  let cursor = 0;
  while (cursor < text.length) {
    const start = skipWhitespace(text, cursor);
    if (start >= text.length) break;
    cursor = start;
    if (text[start] === "{" || text[start] === "[") {
      const end = scanNestedArrayOrObjectEnd(text, start);
      if (end === null) return new Set();
      if (end === undefined) {
        const body = text.slice(start);
        const valid = text[start] === "{"
          ? scanIncompleteLeadingObjectToolIds(body) !== undefined
          : isValidIncompleteArrayPrefix(body);
        return valid ? apostrophes : new Set();
      }
      structured = true;
      cursor = end;
      continue;
    }
    const newline = text.indexOf("\n", cursor);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(cursor, end);
    if (!jsonFence && /^ {0,3}```json[ \t]*$/i.test(line)) {
      jsonFence = true;
      structured = true;
      cursor = end + 1;
      continue;
    }
    if (jsonFence && /^ {0,3}```[ \t]*$/.test(line)) {
      jsonFence = false;
      cursor = end + 1;
      continue;
    }
    if (jsonFence) return new Set();
    if (
      !isPlainProseText(normalizeProseApostrophes(line)) &&
      recoverableContractFactLine(line) === undefined
    ) {
      return new Set();
    }
    for (const index of gapProseApostrophes(text, cursor)) apostrophes.add(index);
    cursor = end + 1;
  }
  return structured ? apostrophes : new Set();
}

function quoteAtEnd(text: string): { value: string; index: number } | undefined {
  const proseApostrophes = structuredHeadProseApostrophes(text);
  let quote: { value: string; index: number } | undefined;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote === undefined) {
      if (character === "'" && proseApostrophes.has(index)) continue;
      if (character === '"' || character === "'") quote = { value: character, index };
      continue;
    }
    if (character === "\\") {
      index += 1;
    } else if (character === quote.value) {
      quote = undefined;
    }
  }
  return quote;
}

function quoteStateAtTail(
  text: string,
  start: number,
  end: number,
  initialQuote?: string,
): { value: string; inherited: boolean; escaped: boolean } | undefined {
  let quote: { value: string; inherited: boolean } | undefined = initialQuote === undefined
    ? undefined
    : { value: initialQuote, inherited: true };
  let trailingBackslashes = 0;
  for (let index = start - 1; index >= 0 && text[index] === "\\"; index--) {
    trailingBackslashes++;
  }
  let escaped = initialQuote !== undefined && trailingBackslashes % 2 === 1;
  let lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let cachedLineStart = -1;
  let proseApostrophes: ReadonlySet<number> = new Set();
  for (let index = start; index < end; index++) {
    if (index > start && text[index - 1] === "\n") lineStart = index;
    const character = text[index]!;
    if (quote === undefined) {
      if (character === "'") {
        if (cachedLineStart !== lineStart) {
          cachedLineStart = lineStart;
          proseApostrophes = gapProseApostrophes(text, lineStart);
        }
        if (proseApostrophes.has(index)) continue;
      }
      if (character === '"' || character === "'") {
        quote = { value: character, inherited: false };
      }
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote.value) {
      quote = undefined;
    }
  }
  return quote === undefined ? undefined : { ...quote, escaped };
}

function recoverableImportPath(source: string): string | undefined {
  let value = source.trim();
  if (value.endsWith(";")) value = value.slice(0, -1).trimEnd();
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return undefined;
  const path = value.slice(1, -1);
  return path.length > 0 && !/["'\\\r\n]/.test(path) ? path : undefined;
}

function recoverableContractFactLine(line: string): string | undefined {
  const content = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (content.length > 512 || /^(?: {4}|\t)/.test(content)) return undefined;
  const model =
    /^ {0,3}(?:[,{(][ \t]*)?["']?model["']?[ \t]*[:=][ \t]*(["'])([^"'\\\s]+)\1[ \t]*[,;}]?[ \t]*$/i
      .exec(content);
  if (model !== null) return `model:${model[1]}${model[2]}${model[1]}`;

  const array =
    /^ {0,3}(?:[,{(][ \t]*)?["']?(tool_ids|tools|provider_tool_ids)["']?[ \t]*[:=][ \t]*\[([\s\S]*)\][ \t]*[,;}]?[ \t]*$/i
      .exec(content);
  if (array !== null) {
    const values = parseJsonArrayFieldBody(array[2]!);
    if (
      values?.every((value) =>
        typeof value === "string" && !/\s/.test(value) &&
        (array[1] === "provider_tool_ids" || TOOL_ID_VALUE_PATTERN.test(value))
      )
    ) return `${array[1]}:${JSON.stringify(values)}`;
  }

  const importStart = /^ {0,3}(import|export)[ \t]+/.exec(content);
  if (importStart !== null) {
    const remainder = content.slice(importStart[0].length);
    const quoteIndex = remainder.search(/["']/);
    const beforeSpecifier = quoteIndex === -1 ? remainder : remainder.slice(0, quoteIndex);
    const from = beforeSpecifier.trimEnd().endsWith("from")
      ? beforeSpecifier.trimEnd().length - 4
      : -1;
    if (
      from > 0 && /[ \t]/.test(remainder[from - 1]!) &&
      /^[A-Za-z0-9_$*,{} \t]+$/.test(remainder.slice(0, from).trimEnd())
    ) {
      const path = recoverableImportPath(remainder.slice(from + 4));
      if (path !== undefined) return `import ${JSON.stringify(path)}`;
    } else if (importStart[1] === "import") {
      const path = recoverableImportPath(remainder);
      if (path !== undefined) return `import ${JSON.stringify(path)}`;
    }
  }
  const dynamicStart = /^ {0,3}import[ \t]*\(/.exec(content);
  if (dynamicStart !== null) {
    let remainder = content.slice(dynamicStart[0].length).trim();
    if (remainder.endsWith(";")) remainder = remainder.slice(0, -1).trimEnd();
    if (remainder.endsWith(")")) {
      const path = recoverableImportPath(remainder.slice(0, -1));
      if (path !== undefined) return `import(${JSON.stringify(path)})`;
    }
  }

  const modelId =
    /^ {0,3}(?:\|[ \t]*)?((?:veryfront-cloud\/)?(?:anthropic|openai|google|google-ai-studio|mistral|xai|deepseek|moonshot|moonshotai|cohere|perplexity|groq|azure)\/[A-Za-z0-9._:-]+)(?:[ \t]*\|[^\r\n]*)?[ \t]*$/
      .exec(content);
  if (modelId !== null) return modelId[1];
  const integrationId = /^ {0,3}([a-z][a-z0-9-]*__[a-z][a-z0-9_-]*)[ \t]*$/.exec(content);
  return integrationId?.[1];
}

function recoverPlainProseTail(
  text: string,
  headLength: number,
  tailStart: number,
): string | undefined {
  if (tailStart - headLength > CHILD_RUN_PROSE_RECOVERY_GAP_LIMIT) return undefined;
  let lineStart = tailStart;
  if (lineStart > 0 && text[lineStart - 1] !== "\n") {
    const newline = text.indexOf("\n", lineStart);
    if (newline === -1) return undefined;
    lineStart = newline + 1;
  }
  if (!isPlainProseText(text.slice(headLength, lineStart))) {
    return undefined;
  }

  let foundFact = false;
  let output = " ".repeat(lineStart - tailStart);
  while (lineStart < text.length) {
    const lineEnd = text.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? text.length : lineEnd;
    const line = text.slice(lineStart, end);
    if (/^ {0,3}```json[ \t]*\r?$/.test(line) && lineEnd !== -1) {
      const closing = /^ {0,3}```[ \t]*\r?$/gm;
      closing.lastIndex = lineEnd + 1;
      const match = closing.exec(text);
      if (match !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.slice(lineEnd + 1, match.index));
        } catch { /* malformed fences do not contribute facts */ }
        if (isPlainRecord(parsed)) {
          const facts = ["model", "tools", "tool_ids", "provider_tool_ids"]
            .flatMap((key) => {
              if (!Object.hasOwn(parsed, key)) return [];
              if (key === "tools" && Array.isArray(parsed[key])) {
                const ids: string[] = [];
                addToolIdsFromParsedArray(ids, parsed[key], true);
                return ids.length > 0 ? [`tools:${JSON.stringify(ids)}`] : [];
              }
              const value = recoverableContractFactLine(`${key}:${JSON.stringify(parsed[key])}`);
              return value === undefined ? [] : [value];
            }).join("\n");
          const blockEnd = match.index + match[0].length;
          const blockLength = blockEnd - lineStart;
          if (facts.length <= blockLength) {
            foundFact ||= facts.length > 0;
            output += facts + " ".repeat(blockLength - facts.length);
            if (blockEnd === text.length) return foundFact ? output : undefined;
            output += "\n";
            lineStart = blockEnd + 1;
            continue;
          }
        }
      }
    }
    const factLine = recoverableContractFactLine(line);
    if (factLine !== undefined && factLine.length <= line.length) {
      foundFact = true;
      output += factLine + " ".repeat(line.length - factLine.length);
    } else if (
      isPlainProseText(line) ||
      (startsWithProseWord(line) && isPlainProseText(normalizeProseApostrophes(line)))
    ) {
      output += " ".repeat(line.length);
    } else {
      output += " ".repeat(text.length - lineStart);
      return foundFact ? output : undefined;
    }
    if (lineEnd === -1) return foundFact ? output : undefined;
    output += "\n";
    lineStart = lineEnd + 1;
  }
  return foundFact ? output : undefined;
}

function boundedContractFactWindows(text: string, headLength: number): string[] {
  if (text.length <= CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT) return [text];

  let tailStart = text.length - (CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT - headLength);
  const head = text.slice(0, headLength);
  const openQuote = quoteAtEnd(head);
  const omittedLength = tailStart - headLength;
  // A quote can open or close anywhere in an unscanned gap. Do not interpret
  // its tail as declarations when the bounded scan cannot establish its state.
  if (omittedLength > CHILD_RUN_QUOTE_STATE_GAP_LIMIT) return [head, ""];
  const proseApostrophe = openQuote?.value === "'" &&
    isPlainProseApostrophe(head, openQuote.index);
  const tailQuote = quoteStateAtTail(
    text,
    headLength,
    tailStart,
    proseApostrophe ? undefined : openQuote?.value,
  );
  if (tailQuote !== undefined) {
    const quoteEnd = scanQuotedValueEnd(text, tailStart - 1, tailQuote.value, tailQuote.escaped);
    if (quoteEnd === undefined) {
      if (!tailQuote.inherited || !proseApostrophe) return [head, ""];
      return [head, recoverPlainProseTail(text, headLength, tailStart) ?? ""];
    }
    tailStart = quoteEnd;
  } else if (proseApostrophe) {
    return [head, recoverPlainProseTail(text, headLength, tailStart) ?? ""];
  }
  while (
    tailStart < text.length && isContractFactTokenCharacter(text[tailStart - 1]) &&
    isContractFactTokenCharacter(text[tailStart])
  ) {
    tailStart += 1;
  }

  return [head, text.slice(tailStart)];
}

function windowStartsAtFieldBoundary(text: string, window: string): boolean {
  const start = text.length - window.length;
  return start <= 0 || FIELD_SEPARATOR_PATTERN.test(text[start - 1] ?? "");
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

function patternForWindow(
  source: string,
  window: string,
  index: number,
  primaryPattern: RegExp,
  tailPattern: RegExp,
): RegExp {
  return index === 0 || windowStartsAtFieldBoundary(source, window) ? primaryPattern : tailPattern;
}

function addFieldFactsAcrossWindows(
  target: string[],
  source: string,
  windows: string[],
  primaryPattern: RegExp,
  tailPattern: RegExp,
  headTrailingCharacter?: string,
): void {
  windows.forEach((window, index) => {
    addPatternMatches(
      target,
      window,
      patternForWindow(source, window, index, primaryPattern, tailPattern),
      1,
      index === 0 ? headTrailingCharacter : undefined,
    );
  });
}

function addPatternFactsAcrossWindows(
  target: string[],
  windows: string[],
  pattern: RegExp,
  group: number,
  headTrailingCharacter?: string,
): void {
  windows.forEach((window, index) => {
    addPatternMatches(
      target,
      window,
      pattern,
      group,
      index === 0 ? headTrailingCharacter : undefined,
    );
  });
}

function addToolFactsAcrossWindows(
  target: string[],
  source: string,
  windows: string[],
  trailingSource: string | undefined,
): void {
  windows.forEach((window, index) => {
    const pattern = patternForWindow(
      source,
      window,
      index,
      TOOL_IDS_FIELD_PATTERN,
      TOOL_IDS_FIELD_TAIL_PATTERN,
    );
    addToolArrayFieldValues(
      target,
      window,
      pattern,
      index === 0 && !!trailingSource,
      trailingSource,
    );
  });
}

function addProviderToolFactsAcrossWindows(
  target: string[],
  source: string,
  windows: string[],
): void {
  windows.forEach((window, index) => {
    const pattern = patternForWindow(
      source,
      window,
      index,
      PROVIDER_TOOL_IDS_FIELD_PATTERN,
      PROVIDER_TOOL_IDS_FIELD_TAIL_PATTERN,
    );
    addProviderToolArrayFieldValues(target, window, pattern);
  });
}

/** Extract structured contract facts from a bounded head-and-tail text window. */
export function extractChildRunContractFacts(text: string): ChildRunContractFacts | undefined {
  const modelIds: string[] = [];
  const toolIds: string[] = [];
  const providerToolIds: string[] = [];
  const importPaths: string[] = [];

  const headLength = CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT / 2;
  const windows = boundedContractFactWindows(text, headLength);
  const headTrailingCharacter = text.length > CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT
    ? text[headLength]
    : undefined;
  // Structured array parsing validates its own token boundaries. Keep a raw
  // head so trimming cannot hide malformed syntax after an id, and devote the
  // remaining bounded budget to the tail so a long declaration can retain its
  // opener when its critical id is placed near the end.
  const toolHeadLength = CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT / 4;
  const toolWindows = text.length > CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT
    ? boundedContractFactWindows(text, toolHeadLength)
    : windows;
  // A tail window starts at a cut, not at the start of the child result, so it
  // matches with patterns that drop the start-of-text alternative. A field at
  // the start of a tail line still matches through its preceding newline.
  addFieldFactsAcrossWindows(
    modelIds,
    text,
    windows,
    MODEL_FIELD_PATTERN,
    MODEL_FIELD_TAIL_PATTERN,
    headTrailingCharacter,
  );
  addPatternFactsAcrossWindows(modelIds, windows, MODEL_ID_PATTERN, 0, headTrailingCharacter);
  const toolTrailingSource = text.length > CHILD_RUN_CONTRACT_FACT_INPUT_LIMIT
    ? text.slice(toolHeadLength, toolHeadLength + 5)
    : undefined;
  addToolFactsAcrossWindows(toolIds, text, toolWindows, toolTrailingSource);
  addProviderToolFactsAcrossWindows(providerToolIds, text, windows);
  addPatternFactsAcrossWindows(
    toolIds,
    windows,
    INTEGRATION_TOOL_ID_PATTERN,
    0,
    headTrailingCharacter,
  );
  addPatternFactsAcrossWindows(importPaths, windows, IMPORT_FROM_PATTERN, 1, headTrailingCharacter);
  addPatternFactsAcrossWindows(importPaths, windows, BARE_IMPORT_PATTERN, 1, headTrailingCharacter);
  addPatternFactsAcrossWindows(
    importPaths,
    windows,
    DYNAMIC_IMPORT_PATTERN,
    1,
    headTrailingCharacter,
  );

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
