import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  primordialArrayAt,
  primordialArrayMap,
  primordialArrayPop,
  primordialArrayPush,
  primordialArraySort,
  primordialArrayValues,
} from "#veryfront/platform/compat/primordials/array.ts";

/**
 * Source-span replacement helpers for import rewrites.
 *
 * @module transforms/mdx/esm-module-loader/utils/source-spans
 */

export interface SourceSpanReplacement {
  start: number;
  end: number;
  replacement: string;
  expected?: string;
}

export interface StaticImportSpan {
  original: string;
  path: string;
  start: number;
  end: number;
  /** Whether TypeScript erases the complete static import or export edge. */
  typeOnly?: boolean;
}

type SpecifierMatcher = (specifier: string) => string | null | undefined;

interface OpenParenContext {
  index: number;
  isControlCondition: boolean;
  isForHeader: boolean;
  hasSemicolon: boolean;
}

interface OpenBraceContext {
  index: number;
  previousTokenIndex: number;
  isDeclarationBlock: boolean;
  isPlainStatementBlock: boolean;
}

interface RawJsxTagSkip {
  end: number;
  name: string | null;
  isClosingTag: boolean;
  isSelfClosingTag: boolean;
  expressionRanges: Array<{ start: number; end: number }>;
}

interface RawJsxLookaheadCache {
  closingTagsByStatementEnd: Map<number, { start: number; tags: Map<string, number[]> }>;
  statementEnds: Array<{ start: number; end: number }>;
  statementEndCursor: number;
}

interface RawJsxTagOptions {
  allowClosingTagAfterText?: boolean;
  lookaheadCache?: RawJsxLookaheadCache;
}

type ModuleDeclarationBefore = (
  end: number,
) => { keyword: "import" | "export"; index: number } | null;

interface BraceScanContext {
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>;
  currentParen: OpenParenContext | undefined;
  enclosingOpenBrace: OpenBraceContext | undefined;
  completedRegexLiteralEnds?: ReadonlySet<number>;
}

interface RegexScanContext {
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>;
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>;
  currentParen: OpenParenContext | undefined;
  previousTokenIndex: number;
  moduleDeclarationBefore: ModuleDeclarationBefore;
}

interface ExpressionScanContext extends RegexScanContext {
  rawJsxLookaheadCache?: RawJsxLookaheadCache;
  completedRegexLiteralEnds?: Set<number>;
}

const MAX_TEMPLATE_LITERAL_DEPTH = 512;
const MAX_RAW_JSX_TEXT_CLOSING_LOOKAHEAD = 64 * 1024;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const ReflectApply = Reflect.apply;
const ArrayPrototypeIncludes = Array.prototype.includes;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeCodePointAt = String.prototype.codePointAt;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeTrim = String.prototype.trim;
const StringPrototypeTrimStart = String.prototype.trimStart;
const RegExpPrototypeExec = RegExp.prototype.exec;
const NumberIsSafeInteger = Number.isSafeInteger;
const NumberParseInt = Number.parseInt;
const MathFloor = Math.floor;
const MathMax = Math.max;
const MathMin = Math.min;
const StringFromCodePoint = String.fromCodePoint;
const FIXED_IDENTIFIER_ESCAPE_WIDTH = String.raw`\u0000`.length;
const IDENTIFIER_START_PATTERN = /^[$_\p{ID_Start}]$/u;
const IDENTIFIER_PART_PATTERN = /^[$_\p{ID_Continue}\u200C\u200D]$/u;
const IDENTIFIER_ESCAPE_SOURCE = String.raw`\\u(?:[0-9A-Fa-f]{4}|\{[0-9A-Fa-f]+\})`;
const IDENTIFIER_NAME_SOURCE = String
  .raw`(?:[$_\p{ID_Start}]|${IDENTIFIER_ESCAPE_SOURCE})(?:[$\p{ID_Continue}\u200C\u200D]|${IDENTIFIER_ESCAPE_SOURCE})*`;
const FUNCTION_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?(?:\s+${IDENTIFIER_NAME_SOURCE})?\s*$`,
  "u",
);
const TYPESCRIPT_FUNCTION_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?(?:\s+${IDENTIFIER_NAME_SOURCE})?(?:\s*<[\s\S]*>)?\s*\([\s\S]*\)\s*(?::\s*[\s\S]*\S)?\s*$`,
  "u",
);
const CLASS_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:@[\s\S]+?\s+)*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class(?:\s+${IDENTIFIER_NAME_SOURCE})?(?:\s*<[\s\S]*>)?(?:\s+extends\s+[\s\S]+?)?(?:\s+implements\s+[\s\S]+)?\s*$`,
  "u",
);
const TYPESCRIPT_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:(?:interface\s+${IDENTIFIER_NAME_SOURCE}(?:\s*<[\s\S]*>)?(?:\s+extends\s+[\s\S]+)?)|(?:(?:const\s+)?enum\s+${IDENTIFIER_NAME_SOURCE})|(?:global)|(?:(?:namespace|module)\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|${IDENTIFIER_NAME_SOURCE}(?:\s*\.\s*${IDENTIFIER_NAME_SOURCE})*)))\s*$`,
  "u",
);
const TYPESCRIPT_TYPE_ALIAS_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:export\s+)?type\s+${IDENTIFIER_NAME_SOURCE}(?:\s*<[\s\S]*>)?\s*=\s*[\s\S]*\S\s*$`,
  "u",
);
const TYPESCRIPT_AMBIENT_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+)?declare\s+(?:(?:(?:const|let|var)\s+${IDENTIFIER_NAME_SOURCE}(?:\s*:\s*[\s\S]*\S)?)|(?:function\s+${IDENTIFIER_NAME_SOURCE}(?:\s*<[\s\S]*>)?\s*\([\s\S]*\)\s*(?::\s*[\s\S]*\S)?)|(?:class\s+${IDENTIFIER_NAME_SOURCE}(?:\s*<[\s\S]*>)?(?:\s+extends\s+[\s\S]+?)?(?:\s+implements\s+[\s\S]+)?))\s*$`,
  "u",
);
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g;
const JSX_TEXT_BREAK_STATEMENT_KEYWORDS = new IntrinsicSet([
  "async",
  "await",
  "break",
  "case",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "do",
  "else",
  "export",
  "for",
  "function",
  "if",
  "import",
  "let",
  "return",
  "switch",
  "throw",
  "try",
  "var",
  "while",
  "with",
  "yield",
]);

function mapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function stringStartsWith(value: string, search: string, position?: number): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search, position]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringIndexOf(value: string, search: string, position?: number): number {
  return ReflectApply(StringPrototypeIndexOf, value, [search, position]) as number;
}

function stringLastIndexOf(value: string, search: string, position?: number): number {
  return ReflectApply(StringPrototypeLastIndexOf, value, [search, position]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

function stringTrim(value: string): string {
  return ReflectApply(StringPrototypeTrim, value, []) as string;
}

function stringTrimStart(value: string): string {
  return ReflectApply(StringPrototypeTrimStart, value, []) as string;
}

function regexpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpPrototypeExec, pattern, [value]) !== null;
}

function regexpReplaceAll(pattern: RegExp, value: string, replacement: string): string {
  let result = "";
  let cursor = 0;
  pattern.lastIndex = 0;
  try {
    for (;;) {
      const match = ReflectApply(RegExpPrototypeExec, pattern, [value]) as RegExpExecArray | null;
      if (match === null) return result + stringSlice(value, cursor);
      result += stringSlice(value, cursor, match.index) + replacement;
      cursor = match.index + match[0].length;
      if (match[0].length === 0) pattern.lastIndex++;
    }
  } finally {
    pattern.lastIndex = 0;
  }
}

function arrayIncludes<T>(values: readonly T[], value: T): boolean {
  return ReflectApply(ArrayPrototypeIncludes, values, [value]) as boolean;
}

function stringCharCodeAt(value: string, index: number): number {
  return ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function stringCodePointAt(value: string, index: number): number | undefined {
  return ReflectApply(StringPrototypeCodePointAt, value, [index]) as number | undefined;
}

function assertTemplateLiteralDepth(depth: number): void {
  if (depth > MAX_TEMPLATE_LITERAL_DEPTH) {
    throw new RangeError("Template literal nesting exceeds scanner limit");
  }
}

export function replaceSourceSpans(
  source: string,
  replacements: SourceSpanReplacement[],
): string {
  let result = source;
  // Sort descending by start so we apply back-to-front and earlier spans stay valid.
  const sorted = primordialArraySort(
    primordialArrayMap(replacements, (replacement) => replacement),
    (left, right) => right.start - left.start,
  );

  // Detect overlapping or duplicate-start spans before touching `result`.
  // When two replacements share (or overlap on) the same start position the
  // second would be applied to already-mutated text while `expected` is still
  // validated against the original `source`, silently producing garbled output.
  for (let i = 0; i + 1 < sorted.length; i++) {
    const later = sorted[i]!; // larger start (rightmost)
    const earlier = sorted[i + 1]!; // smaller start
    if (earlier.end > later.start) {
      throw new RangeError(
        `Overlapping source replacement spans: [${earlier.start},${earlier.end}) and [${later.start},${later.end})`,
      );
    }
  }

  for (const { start, end, replacement, expected } of primordialArrayValues(sorted)) {
    if (start < 0 || end < start || end > source.length) {
      throw new RangeError(`Invalid source replacement span: ${start}-${end}`);
    }

    if (expected !== undefined && stringSlice(source, start, end) !== expected) {
      throw INVALID_ARGUMENT.create({
        detail: `Source replacement span did not match expected text: ${expected}`,
      });
    }

    result = stringSlice(result, 0, start) + replacement + stringSlice(result, end);
  }

  return result;
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && regexpTest(IDENTIFIER_PART_PATTERN, char);
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && regexpTest(IDENTIFIER_START_PATTERN, char);
}

function identifierCharacterAt(source: string, index: number): string | undefined {
  if (index < 0 || index >= source.length) return undefined;

  let characterIndex = index;
  const codeUnit = stringCharCodeAt(source, characterIndex);
  if (
    codeUnit >= 0xdc00 && codeUnit <= 0xdfff && characterIndex > 0
  ) {
    const previousCodeUnit = stringCharCodeAt(source, characterIndex - 1);
    if (previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff) characterIndex--;
  }

  const codePoint = stringCodePointAt(source, characterIndex);
  return codePoint === undefined ? undefined : StringFromCodePoint(codePoint);
}

function isIdentifierPartAt(source: string, index: number): boolean {
  return isIdentifierChar(identifierCharacterAt(source, index));
}

function isIdentifierStartAt(source: string, index: number): boolean {
  return isIdentifierStart(identifierCharacterAt(source, index));
}

function isHexDigit(char: string | undefined): boolean {
  return char !== undefined && regexpTest(/[0-9A-Fa-f]/, char);
}

function identifierEscapeCodePoint(source: string, start: number): {
  codePoint: number;
  end: number;
} | undefined {
  if (source[start] !== "\\" || source[start + 1] !== "u") return undefined;

  if (source[start + 2] === "{") {
    let cursor = start + 3;
    while (isHexDigit(source[cursor])) cursor++;
    if (cursor === start + 3 || source[cursor] !== "}") return undefined;

    const codePoint = NumberParseInt(stringSlice(source, start + 3, cursor), 16);
    if (!NumberIsSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return undefined;
    }
    return { codePoint, end: cursor + 1 };
  }

  for (let offset = 2; offset < 6; offset++) {
    if (!isHexDigit(source[start + offset])) return undefined;
  }
  return {
    codePoint: NumberParseInt(stringSlice(source, start + 2, start + 6), 16),
    end: start + 6,
  };
}

function isIdentifierEscapeStartingAt(source: string, index: number): boolean {
  const escape = identifierEscapeCodePoint(source, index);
  return escape !== undefined && isIdentifierChar(StringFromCodePoint(escape.codePoint));
}

function identifierEscapeStartEndingAt(source: string, end: number): number | undefined {
  const fixedStart = end - FIXED_IDENTIFIER_ESCAPE_WIDTH;
  const fixed = identifierEscapeCodePoint(source, fixedStart);
  if (
    fixed?.end === end &&
    isIdentifierChar(StringFromCodePoint(fixed.codePoint))
  ) {
    return fixedStart;
  }

  if (source[end - 1] !== "}") return undefined;
  let cursor = end - 2;
  while (cursor >= 0 && isHexDigit(source[cursor])) cursor--;
  if (source[cursor] !== "{" || source[cursor - 1] !== "u" || source[cursor - 2] !== "\\") {
    return undefined;
  }

  const braced = identifierEscapeCodePoint(source, cursor - 2);
  return braced?.end === end && isIdentifierChar(StringFromCodePoint(braced.codePoint))
    ? cursor - 2
    : undefined;
}

function isIdentifierEscapeEndingAt(source: string, end: number): boolean {
  return identifierEscapeStartEndingAt(source, end) !== undefined;
}

function isIdentifierBoundaryBefore(source: string, index: number): boolean {
  return isIdentifierPartAt(source, index - 1) || isIdentifierEscapeEndingAt(source, index);
}

function isIdentifierBoundaryAfter(source: string, index: number): boolean {
  return isIdentifierPartAt(source, index) || isIdentifierEscapeStartingAt(source, index);
}

function skipLineComment(source: string, index: number): number {
  let cursor = index + 2;
  while (cursor < source.length && !isLineTerminator(source[cursor]!)) cursor++;
  if (cursor >= source.length) return source.length;
  return source[cursor] === "\r" && source[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
}

function isStatementKeywordAt(
  source: string,
  index: number,
  keyword: "import" | "export",
  atStatementStart: boolean,
): boolean {
  if (!atStatementStart) return false;
  if (!stringStartsWith(source, keyword, index)) return false;
  if (isIdentifierBoundaryBefore(source, index) || source[index - 1] === ".") return false;
  if (isIdentifierBoundaryAfter(source, index + keyword.length)) return false;
  return true;
}

function skipIgnored(source: string, index: number): number {
  const char = source[index];
  const next = source[index + 1];

  if (char === "/" && next === "/") {
    return skipLineComment(source, index);
  }

  if (char === "/" && next === "*") {
    const end = stringIndexOf(source, "*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (char === '"' || char === "'" || char === "`") {
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === char) return cursor + 1;
      cursor++;
    }
    return source.length;
  }

  return index;
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (regexpTest(/\s/, source[cursor] ?? "")) cursor++;
  return cursor;
}

function hasLineTerminatorBetween(source: string, start: number, end: number): boolean {
  for (let cursor = start; cursor < end; cursor++) {
    if (isLineTerminator(source[cursor]!)) return true;
  }
  return false;
}

// Comments are legal wherever whitespace is, so a dynamic import can carry a
// bundler hint between the keyword, the parentheses and the specifier. Treating
// the comment as an unexpected character would leave the specifier unresolved.
function skipWhitespaceAndComments(source: string, index: number): number {
  let cursor = index;

  while (cursor < source.length) {
    const afterWhitespace = skipWhitespace(source, cursor);
    const char = source[afterWhitespace];
    const next = source[afterWhitespace + 1];
    if (char === "/" && (next === "/" || next === "*")) {
      cursor = skipIgnored(source, afterWhitespace);
      continue;
    }
    return afterWhitespace;
  }

  return cursor;
}

function nextStatementCursor(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length) {
    if (source[cursor] === ";") return cursor + 1;
    if (isLineTerminator(source[cursor]!)) {
      return source[cursor] === "\r" && source[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
    }
    cursor++;
  }
  return source.length;
}

function hexDigitValue(char: string | undefined): number {
  if (char === undefined) return -1;
  const code = stringCharCodeAt(char, 0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function decodeHexEscape(source: string, start: number, length: number): number | null {
  let value = 0;
  for (let offset = 0; offset < length; offset++) {
    const digit = hexDigitValue(source[start + offset]);
    if (digit === -1) return null;
    value = value * 16 + digit;
  }
  return value;
}

function invalidEscapedSpecifier(): never {
  throw new SyntaxError("Invalid escaped module specifier");
}

function isLineTerminator(char: string): boolean {
  return char === "\r" || char === "\n" || char === "\u2028" || char === "\u2029";
}

interface LiteralDecodeState {
  result: string;
  cursor: number;
}

function appendLiteralCharacter(
  source: string,
  char: string,
  allowLineTerminators: boolean,
  state: LiteralDecodeState,
): void {
  if (isLineTerminator(char)) {
    if (!allowLineTerminators) invalidEscapedSpecifier();
    if (char === "\r") {
      state.result += "\n";
      state.cursor += source[state.cursor + 1] === "\n" ? 2 : 1;
      return;
    }
  }
  state.result += char;
  state.cursor++;
}

function appendUnicodeLiteralEscape(
  source: string,
  end: number,
  state: LiteralDecodeState,
): void {
  if (source[state.cursor + 2] === "{") {
    let escapeEnd = state.cursor + 3;
    let value = 0;
    let digitCount = 0;
    while (escapeEnd < end && source[escapeEnd] !== "}") {
      const digit = hexDigitValue(source[escapeEnd]);
      if (digit === -1) invalidEscapedSpecifier();
      value = value * 16 + digit;
      digitCount++;
      escapeEnd++;
    }
    if (
      digitCount === 0 || source[escapeEnd] !== "}" || value > 0x10ffff
    ) invalidEscapedSpecifier();
    state.result += StringFromCodePoint(value);
    state.cursor = escapeEnd + 1;
    return;
  }

  const value = decodeHexEscape(source, state.cursor + 2, 4);
  if (value === null || state.cursor + 6 > end) invalidEscapedSpecifier();
  state.result += StringFromCodePoint(value);
  state.cursor += 6;
}

function appendLiteralEscape(
  source: string,
  end: number,
  state: LiteralDecodeState,
): void {
  const escaped = source[state.cursor + 1];
  if (escaped === undefined || state.cursor + 1 >= end) invalidEscapedSpecifier();

  if (isLineTerminator(escaped)) {
    state.cursor += escaped === "\r" && source[state.cursor + 2] === "\n" ? 3 : 2;
    return;
  }

  const simpleEscape = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  }[escaped];
  if (simpleEscape !== undefined) {
    state.result += simpleEscape;
    state.cursor += 2;
    return;
  }

  if (escaped === "0") {
    if (regexpTest(/\d/, source[state.cursor + 2] ?? "")) invalidEscapedSpecifier();
    state.result += "\0";
    state.cursor += 2;
    return;
  }
  if (regexpTest(/[1-9]/, escaped)) invalidEscapedSpecifier();

  if (escaped === "x") {
    const value = decodeHexEscape(source, state.cursor + 2, 2);
    if (value === null || state.cursor + 4 > end) invalidEscapedSpecifier();
    state.result += StringFromCodePoint(value);
    state.cursor += 4;
    return;
  }

  if (escaped === "u") {
    appendUnicodeLiteralEscape(source, end, state);
    return;
  }

  state.result += escaped;
  state.cursor += 2;
}

function decodeLiteralContents(
  source: string,
  start: number,
  end: number,
  allowLineTerminators: boolean,
): string {
  const state: LiteralDecodeState = { result: "", cursor: start };
  while (state.cursor < end) {
    const char = source[state.cursor]!;
    if (char !== "\\") {
      appendLiteralCharacter(source, char, allowLineTerminators, state);
      continue;
    }
    appendLiteralEscape(source, end, state);
  }
  return state.result;
}

function readQuotedSpecifier(
  source: string,
  quoteIndex: number,
): { end: number; specifier: string } | null {
  const quote = source[quoteIndex];
  if (quote !== '"' && quote !== "'") return null;

  let cursor = quoteIndex + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) {
      const specifier = decodeLiteralContents(source, quoteIndex + 1, cursor, false);
      return {
        end: cursor + 1,
        specifier,
      };
    }
    cursor++;
  }

  return null;
}

function readLiteralSpecifier(
  source: string,
  literalIndex: number,
): { end: number; specifier: string } | null {
  const quote = source[literalIndex];
  if (quote === '"' || quote === "'") return readQuotedSpecifier(source, literalIndex);
  if (quote !== "`") return null;

  let cursor = literalIndex + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "$" && source[cursor + 1] === "{") return null;
    if (source[cursor] === "`") {
      const specifier = decodeLiteralContents(source, literalIndex + 1, cursor, true);
      return {
        end: cursor + 1,
        specifier,
      };
    }
    cursor++;
  }

  return null;
}

function skipFullTemplateLiteral(
  source: string,
  templateIndex: number,
  depth = 0,
): number {
  assertTemplateLiteralDepth(depth);

  let cursor = templateIndex + 1;

  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }

    if (source[cursor] === "`") return cursor + 1;

    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      const expressionEnd = findTemplateExpressionEnd(source, cursor + 2, depth + 1);
      if (expressionEnd === null) return source.length;
      cursor = expressionEnd + 1;
      continue;
    }

    cursor++;
  }

  return source.length;
}

function previousSignificantIndex(source: string, index: number): number {
  let cursor = index - 1;
  while (cursor >= 0 && regexpTest(/\s/, source[cursor] ?? "")) cursor--;
  return cursor;
}

/**
 * Forward line-comment classification state for the most recently scanned
 * source. Backward token walks ask about many nearby positions on the same
 * line; rescanning that line from its start on every query is quadratic for
 * long single-line (generated or minified) modules, so the scan resumes from
 * where the previous query stopped while the queries move forward.
 */
interface LineCommentScan {
  source: string;
  /** Start of the line holding every position in `[lineStart, scannedTo)`. */
  lineStart: number;
  /** First position not yet classified. */
  scannedTo: number;
  quote: string | null;
  /** Start of the first `//` outside a quote on this line, once found. */
  commentStart: number | null;
}

let lineCommentScan: LineCommentScan | null = null;

function startLineCommentScan(source: string, index: number): LineCommentScan {
  let lineStart = index;
  while (lineStart > 0 && !isLineTerminator(source[lineStart - 1] ?? "")) lineStart--;
  return { source, lineStart, scannedTo: lineStart, quote: null, commentStart: null };
}

function advanceQuotedLineComment(scan: LineCommentScan, cursor: number): number {
  const { source } = scan;
  if (source[cursor] === "\\" && !isLineTerminator(source[cursor + 1] ?? "")) {
    return cursor + 2;
  }
  if (source[cursor] === scan.quote) scan.quote = null;
  return cursor + 1;
}

function advanceLineCommentScan(scan: LineCommentScan, index: number): void {
  const { source } = scan;
  let cursor = scan.scannedTo;
  const end = MathMin(index, source.length - 1);
  while (cursor <= end) {
    const char = source[cursor]!;
    if (isLineTerminator(char)) {
      scan.lineStart = cursor + 1;
      scan.quote = null;
      scan.commentStart = null;
      cursor++;
      continue;
    }
    if (scan.commentStart !== null) {
      // The rest of the line is comment; only a line terminator changes state.
      cursor++;
      continue;
    }
    if (scan.quote !== null) {
      cursor = advanceQuotedLineComment(scan, cursor);
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      scan.quote = char;
    } else if (char === "/" && source[cursor + 1] === "/") {
      scan.commentStart = cursor;
    }
    cursor++;
  }
  scan.scannedTo = cursor;
}

function lineCommentStart(source: string, index: number): number | null {
  if (index < 0 || isLineTerminator(source[index] ?? "")) return null;

  let scan = lineCommentScan;
  if (scan?.source !== source || index < scan.lineStart) {
    scan = startLineCommentScan(source, index);
    lineCommentScan = scan;
  }
  if (index >= scan.scannedTo) advanceLineCommentScan(scan, index);

  return scan.commentStart !== null && scan.commentStart <= index ? scan.commentStart : null;
}

function previousSignificantIndexBeforeIgnored(source: string, index: number): number {
  let cursor = index;

  while (cursor >= 0) {
    cursor = previousSignificantIndex(source, cursor);
    if (cursor < 0) return cursor;

    if (source[cursor] === "/" && source[cursor - 1] === "*") {
      const start = stringLastIndexOf(source, "/*", cursor - 1);
      if (start >= 0) {
        cursor = start;
        continue;
      }
    }

    const commentStart = lineCommentStart(source, cursor);
    if (commentStart !== null) {
      cursor = commentStart;
      continue;
    }

    return cursor;
  }

  return cursor;
}

function keywordBefore(
  source: string,
  index: number,
  previousTokenIndex = previousSignificantIndex(source, index),
): string | null {
  const end = previousTokenIndex + 1;
  let start = end;
  while (start > 0 && isIdentifierPartAt(source, start - 1)) start--;
  if (start === end) return null;
  return stringSlice(source, start, end);
}

/**
 * Whether the word ending at `previousTokenIndex` is a member name, not a keyword.
 *
 * Every keyword the classifier accepts as a regex prefix is also a legal
 * property name in ES5+, so `metrics.in / 2` and `metrics.return / 2` are
 * ordinary code in which the slash divides. Reading the word as a keyword
 * opens a regex literal that never closes, and the scan then swallows the rest
 * of the module — every later import disappears from nested materialization
 * and from dependency collection alike.
 *
 * Covers `.name`, optional chaining `?.name` (the character before the word is
 * `.` either way) and private fields `#name`.
 */
export function isMemberNameBefore(
  source: string,
  previousTokenIndex: number,
): boolean {
  const end = previousTokenIndex + 1;
  let start = end;
  while (start > 0 && isIdentifierPartAt(source, start - 1)) start--;
  if (start === end) return false;

  const immediateBefore = previousSignificantIndex(source, start);
  if (immediateBefore < 0) return false;

  // Most keyword-shaped identifiers are ordinary expression operands. Avoid
  // rescanning the whole line for a comment unless the adjacent trivia can
  // actually contain one; doing that for every `of` makes long declarations
  // quadratic under coverage instrumentation.
  if (
    source[immediateBefore] !== "/" &&
    !hasLineTerminatorBetween(source, immediateBefore + 1, start)
  ) {
    const immediateChar = source[immediateBefore];
    if (immediateChar === "#") return true;
    if (immediateChar !== ".") return false;
    return source[immediateBefore - 1] !== "." || source[immediateBefore - 2] !== ".";
  }

  const before = previousSignificantIndexBeforeIgnored(source, start);
  if (before < 0) return false;

  const char = source[before];
  if (char === "#") return true;
  if (char !== ".") return false;

  return source[before - 1] !== "." || source[before - 2] !== ".";
}

function restrictedStatementKeywordBeforeLabel(
  source: string,
  index: number,
  previousTokenIndex: number,
  rangeStart: number,
): "break" | "continue" | null {
  const labelEnd = previousTokenIndex + 1;
  let labelStart = labelEnd;
  while (labelStart > rangeStart && isIdentifierPartAt(source, labelStart - 1)) labelStart--;
  if (labelStart === labelEnd) return null;

  const beforeLabel = previousSignificantIndexBeforeIgnored(source, labelStart);
  const keyword = keywordBefore(source, labelStart, beforeLabel);
  if (keyword !== "break" && keyword !== "continue") return null;

  const keywordEnd = beforeLabel + 1;
  if (hasLineTerminatorBetween(source, keywordEnd, labelStart)) return null;
  if (!hasLineTerminatorBetween(source, labelEnd, index)) return null;
  return keyword;
}

function openParenContext(
  source: string,
  index: number,
  previousTokenIndex: number,
): OpenParenContext {
  const keyword = keywordBefore(source, index, previousTokenIndex);
  const keywordStart = previousTokenIndex - (keyword?.length ?? 0) + 1;
  const previousKeyword = keyword === "await"
    ? keywordBefore(
      source,
      keywordStart,
      previousSignificantIndexBeforeIgnored(source, keywordStart),
    )
    : null;
  const isForAwaitHeader = previousKeyword === "for";
  return {
    index,
    isControlCondition: keyword === "if" || keyword === "while" || keyword === "for" ||
      keyword === "with" || keyword === "switch" || keyword === "catch" || isForAwaitHeader,
    isForHeader: keyword === "for" || isForAwaitHeader,
    hasSemicolon: false,
  };
}

function isControlConditionCloseParen(
  index: number,
  rangeStart: number,
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
): boolean {
  const openParen = mapGet(matchingOpenParens, index);
  return openParen !== undefined && openParen.index >= rangeStart &&
    openParen.isControlCondition;
}

function isControlBlockCloseBrace(
  source: string,
  index: number,
  rangeStart: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
): boolean {
  const openBrace = mapGet(matchingOpenBraces, index);
  if (openBrace === undefined) return false;

  const beforeOpenBrace = openBrace.previousTokenIndex;
  return beforeOpenBrace >= rangeStart &&
    source[beforeOpenBrace] === ")" &&
    isControlConditionCloseParen(beforeOpenBrace, rangeStart, matchingOpenParens);
}

function normalizedDeclarationPrefix(source: string, start: number, end: number): string {
  return regexpReplaceAll(COMMENT_PATTERN, stringTrimStart(stringSlice(source, start, end)), " ");
}

function statementSeparatorStartBefore(source: string, index: number): number {
  // Stop at the nearest boundary instead of searching the entire prefix for
  // each separator kind, which is quadratic when a kind never occurs.
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const char = source[cursor];
    if (char === ";" || char === "{" || char === "}") return cursor + 1;
  }
  return 0;
}

function declarationStatementStartBefore(
  source: string,
  index: number,
  keywords: readonly string[] = [
    "async",
    "export",
    "function",
  ],
): number {
  const separatorStart = statementSeparatorStartBefore(source, index);
  return declarationAsiBoundaryBefore(source, separatorStart, index, keywords) ?? separatorStart;
}

interface DelimiterDepth {
  paren: number;
  brace: number;
  bracket: number;
}

function atDelimiterTopLevel(depth: DelimiterDepth): boolean {
  return depth.paren === 0 && depth.brace === 0 && depth.bracket === 0;
}

function advanceDelimiterDepth(depth: DelimiterDepth, char: string | undefined): void {
  switch (char) {
    case "(":
      depth.paren++;
      break;
    case ")":
      if (depth.paren > 0) depth.paren--;
      break;
    case "{":
      depth.brace++;
      break;
    case "}":
      if (depth.brace > 0) depth.brace--;
      break;
    case "[":
      depth.bracket++;
      break;
    case "]":
      if (depth.bracket > 0) depth.bracket--;
      break;
  }
}

function retreatDelimiterDepth(depth: DelimiterDepth, char: string | undefined): boolean {
  switch (char) {
    case ")":
      depth.paren++;
      return true;
    case "(":
      if (depth.paren === 0) return false;
      depth.paren--;
      return true;
    case "}":
      depth.brace++;
      return true;
    case "{":
      if (depth.brace === 0) return false;
      depth.brace--;
      return true;
    case "]":
      depth.bracket++;
      return true;
    case "[":
      if (depth.bracket === 0) return false;
      depth.bracket--;
      return true;
    default:
      return false;
  }
}

function balancedDeclarationStatementStartBefore(
  source: string,
  index: number,
  keywords: readonly string[],
): number {
  let cursor = index - 1;
  const depth: DelimiterDepth = { paren: 0, brace: 0, bracket: 0 };

  while (cursor >= 0) {
    const char = source[cursor];
    if (!retreatDelimiterDepth(depth, char) && atDelimiterTopLevel(depth)) {
      if (char === ";" || char === "{" || char === "}") {
        const separatorStart = cursor + 1;
        return declarationAsiBoundaryBefore(source, separatorStart, index, keywords) ??
          separatorStart;
      }
    }

    cursor--;
  }

  return declarationAsiBoundaryBefore(source, 0, index, keywords) ?? 0;
}

function classDeclarationStatementStartBefore(source: string, index: number): number {
  return balancedDeclarationStatementStartBefore(source, index, [
    "class",
    "declare",
    "export",
  ]);
}

function startsWithDeclarationKeywordAt(
  source: string,
  index: number,
  keywords: readonly string[],
): boolean {
  for (const keyword of primordialArrayValues(keywords)) {
    if (
      stringStartsWith(source, keyword, index) &&
      !isIdentifierBoundaryBefore(source, index) &&
      !isIdentifierBoundaryAfter(source, index + keyword.length)
    ) return true;
  }
  return false;
}

function hasDeclarationKeywordBefore(
  source: string,
  start: number,
  end: number,
  keywords: readonly string[],
): boolean {
  for (const keyword of primordialArrayValues(keywords)) {
    let index = stringIndexOf(source, keyword, start);
    while (index >= 0 && index < end) {
      if (
        !isIdentifierBoundaryBefore(source, index) &&
        !isIdentifierBoundaryAfter(source, index + keyword.length)
      ) {
        return true;
      }
      index = stringIndexOf(source, keyword, index + keyword.length);
    }
  }
  return false;
}

function declarationAsiBoundaryBefore(
  source: string,
  start: number,
  end: number,
  keywords: readonly string[],
): number | null {
  let boundary: number | null = null;
  let cursor = start;

  while (cursor < end) {
    const char = source[cursor];
    if (char !== undefined && isLineTerminator(char)) {
      const afterLine = char === "\r" && source[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
      const previousTokenIndex = previousSignificantIndexBeforeIgnored(source, cursor);
      const declarationStart = skipWhitespaceAndComments(source, afterLine);
      if (
        previousTokenIndex >= start &&
        canEndStatementBeforeLineTerminator(source, previousTokenIndex) &&
        declarationStart < end &&
        startsWithDeclarationKeywordAt(source, declarationStart, keywords)
      ) {
        boundary = declarationStart;
      }
      cursor = afterLine;
      continue;
    }

    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }
    cursor++;
  }

  return boundary;
}

function isFunctionDeclarationBlockOpenBrace(
  source: string,
  previousTokenIndex: number,
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
): boolean {
  if (source[previousTokenIndex] !== ")") return false;

  const openParen = mapGet(matchingOpenParens, previousTokenIndex);
  if (openParen === undefined) return false;

  const declarationStart = declarationStatementStartBefore(source, openParen.index);
  const prefix = normalizedDeclarationPrefix(source, declarationStart, openParen.index);
  return regexpTest(FUNCTION_DECLARATION_PREFIX_PATTERN, prefix);
}

function isTypeScriptFunctionDeclarationBlockOpenBrace(
  source: string,
  index: number,
  previousTokenIndex: number,
): boolean {
  const previousToken = source[previousTokenIndex];
  if (
    previousToken !== ")" &&
    previousToken !== "]" &&
    previousToken !== "}" &&
    !isIdentifierPartAt(source, previousTokenIndex) &&
    !isIdentifierEscapeEndingAt(source, previousTokenIndex + 1)
  ) {
    return false;
  }

  const separatorStart = stringLastIndexOf(source, ";", index - 1) + 1;
  if (
    !hasDeclarationKeywordBefore(source, separatorStart, index, [
      "async",
      "export",
      "function",
    ])
  ) {
    return false;
  }

  const declarationStart = balancedDeclarationStatementStartBefore(source, index, [
    "async",
    "export",
    "function",
  ]);
  const prefix = normalizedDeclarationPrefix(source, declarationStart, index);
  return regexpTest(TYPESCRIPT_FUNCTION_DECLARATION_PREFIX_PATTERN, prefix);
}

function isClassDeclarationBlockOpenBrace(
  source: string,
  index: number,
  previousTokenIndex: number,
  currentParen: OpenParenContext | undefined,
): boolean {
  const previousToken = source[previousTokenIndex];
  if (
    previousToken !== ")" &&
    previousToken !== "]" &&
    previousToken !== ">" &&
    !isIdentifierPartAt(source, previousTokenIndex) &&
    !isIdentifierEscapeEndingAt(source, previousTokenIndex + 1)
  ) {
    return false;
  }

  const separatorStart = stringLastIndexOf(source, ";", index - 1) + 1;
  if (!hasDeclarationKeywordBefore(source, separatorStart, index, ["class", "export"])) {
    return false;
  }

  const declarationStart = classDeclarationStatementStartBefore(source, index);
  if (currentParen !== undefined && currentParen.index >= declarationStart) return false;

  const prefix = normalizedDeclarationPrefix(source, declarationStart, index);
  return regexpTest(CLASS_DECLARATION_PREFIX_PATTERN, prefix);
}

function isTypeScriptDeclarationBlockOpenBrace(
  source: string,
  index: number,
  previousTokenIndex: number,
): boolean {
  const previousToken = source[previousTokenIndex];
  if (
    previousToken !== ">" &&
    previousToken !== '"' &&
    previousToken !== "'" &&
    !isIdentifierPartAt(source, previousTokenIndex) &&
    !isIdentifierEscapeEndingAt(source, previousTokenIndex + 1)
  ) {
    return false;
  }

  const keywords = [
    "const",
    "declare",
    "enum",
    "export",
    "interface",
    "module",
    "namespace",
  ];
  const separatorStart = stringLastIndexOf(source, ";", index - 1) + 1;
  if (!hasDeclarationKeywordBefore(source, separatorStart, index, keywords)) {
    return false;
  }

  const declarationStart = balancedDeclarationStatementStartBefore(source, index, keywords);
  const prefix = normalizedDeclarationPrefix(source, declarationStart, index);
  return regexpTest(TYPESCRIPT_DECLARATION_PREFIX_PATTERN, prefix);
}

function identifierStartBefore(source: string, end: number, rangeStart: number): number {
  let start = end;
  while (start > rangeStart) {
    const escapeStart = identifierEscapeStartEndingAt(source, start);
    if (escapeStart !== undefined && escapeStart >= rangeStart) {
      start = escapeStart;
      continue;
    }
    if (!isIdentifierPartAt(source, start - 1)) break;
    start--;
  }
  return start;
}

function isIdentifierStartOrEscapeAt(source: string, index: number): boolean {
  const escape = identifierEscapeCodePoint(source, index);
  if (escape !== undefined) return isIdentifierStart(StringFromCodePoint(escape.codePoint));
  return isIdentifierStartAt(source, index);
}

function switchClauseStartBeforeColon(
  source: string,
  start: number,
  colonIndex: number,
): number | null {
  let cursor = start;
  let candidate: number | null = null;
  const depth: DelimiterDepth = { paren: 0, brace: 0, bracket: 0 };

  while (cursor < colonIndex) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const char = source[cursor];
    advanceDelimiterDepth(depth, char);

    if (atDelimiterTopLevel(depth)) {
      if (
        stringStartsWith(source, "case", cursor) &&
        !isIdentifierBoundaryBefore(source, cursor) &&
        !isIdentifierBoundaryAfter(source, cursor + "case".length)
      ) {
        candidate = cursor;
        cursor += "case".length;
        continue;
      }
      if (
        stringStartsWith(source, "default", cursor) &&
        !isIdentifierBoundaryBefore(source, cursor) &&
        !isIdentifierBoundaryAfter(source, cursor + "default".length)
      ) {
        candidate = cursor;
        cursor += "default".length;
        continue;
      }
    }

    cursor++;
  }

  return candidate;
}

function isSwitchClauseBlockOpenBrace(
  source: string,
  colonIndex: number,
  rangeStart: number,
  enclosingOpenBrace: OpenBraceContext | undefined,
): boolean {
  const searchStart = MathMax(rangeStart, (enclosingOpenBrace?.index ?? rangeStart - 1) + 1);
  const clauseStart = switchClauseStartBeforeColon(source, searchStart, colonIndex);
  if (clauseStart === null) return false;

  const clausePrefix = stringTrim(normalizedDeclarationPrefix(source, clauseStart, colonIndex));
  return clausePrefix === "default" || regexpTest(/^case\b[\s\S]*\S$/, clausePrefix);
}

function canEndStatementBeforeLineTerminator(
  source: string,
  previousTokenIndex: number,
  completedRegexLiteralEnds?: ReadonlySet<number>,
): boolean {
  const char = source[previousTokenIndex];
  if (char === ")" || char === "]" || char === "}") return true;
  if (char === '"' || char === "'" || char === "`") return true;
  if (char === "/") {
    return completedRegexLiteralEnds !== undefined &&
        setHas(completedRegexLiteralEnds, previousTokenIndex) === true ||
      isCompletedRegexLiteralEnd(source, previousTokenIndex);
  }
  if (char === "+" && source[previousTokenIndex - 1] === "+") return true;
  if (char === "-" && source[previousTokenIndex - 1] === "-") return true;
  return isIdentifierPartAt(source, previousTokenIndex) ||
    isIdentifierEscapeEndingAt(source, previousTokenIndex + 1);
}

function isTypeAliasDeclarationBeforeRegex(
  source: string,
  regexIndex: number,
  previousTokenIndex: number,
  rangeStart: number,
): boolean {
  if (
    !hasLineTerminatorBetween(source, previousTokenIndex + 1, regexIndex) ||
    !canEndStatementBeforeLineTerminator(source, previousTokenIndex)
  ) {
    return false;
  }

  const separatorStart = statementSeparatorStartBefore(source, regexIndex);
  if (!hasDeclarationKeywordBefore(source, separatorStart, regexIndex, ["export", "type"])) {
    return false;
  }

  const declarationStart = balancedDeclarationStatementStartBefore(source, regexIndex, [
    "export",
    "type",
  ]);
  if (declarationStart < rangeStart) return false;

  const prefix = normalizedDeclarationPrefix(source, declarationStart, regexIndex);
  return regexpTest(TYPESCRIPT_TYPE_ALIAS_PREFIX_PATTERN, prefix);
}

function isTypeScriptAmbientDeclarationBeforeRegex(
  source: string,
  regexIndex: number,
  previousTokenIndex: number,
  rangeStart: number,
): boolean {
  if (
    !hasLineTerminatorBetween(source, previousTokenIndex + 1, regexIndex) ||
    !canEndStatementBeforeLineTerminator(source, previousTokenIndex)
  ) {
    return false;
  }

  const separatorStart = statementSeparatorStartBefore(source, regexIndex);
  if (!hasDeclarationKeywordBefore(source, separatorStart, regexIndex, ["declare", "export"])) {
    return false;
  }

  const declarationStart = balancedDeclarationStatementStartBefore(source, regexIndex, [
    "declare",
    "export",
  ]);
  if (declarationStart < rangeStart) return false;

  const prefix = normalizedDeclarationPrefix(source, declarationStart, regexIndex);
  return regexpTest(TYPESCRIPT_AMBIENT_DECLARATION_PREFIX_PATTERN, prefix);
}

function isCompletedRegexLiteralEnd(source: string, endIndex: number): boolean {
  for (let start = endIndex - 1; start >= 0; start--) {
    if (source[start] !== "/") continue;
    const before = previousSignificantIndexBeforeIgnored(source, start);
    const beforeChar = source[before];
    const canStart = before < 0 ||
      (beforeChar !== undefined && stringIncludes("([{=,:;!~?&|+-*%^<>", beforeChar)) ||
      arrayIncludes([
        "case",
        "default",
        "delete",
        "do",
        "else",
        "extends",
        "in",
        "instanceof",
        "new",
        "await",
        "break",
        "continue",
        "debugger",
        "return",
        "throw",
        "typeof",
        "void",
        "yield",
      ], keywordBefore(source, start, before) ?? "");
    if (!canStart) continue;
    if (skipRegexLiteral(source, start) === endIndex + 1) return true;
  }

  return false;
}

function isInRawJsxText(textDepth: number, expressionDepth: number): boolean {
  return textDepth > expressionDepth;
}

function isPlainStatementBlockOpenBrace(
  source: string,
  rangeStart: number,
  openBraceIndex: number,
  previousTokenIndex: number,
  enclosingOpenBrace: OpenBraceContext | undefined,
  completedRegexLiteralEnds?: ReadonlySet<number>,
): boolean {
  if (previousTokenIndex < rangeStart) return true;
  if (source[previousTokenIndex] === ";" || source[previousTokenIndex] === "}") return true;
  if (
    hasLineTerminatorBetween(source, previousTokenIndex + 1, openBraceIndex) &&
    canEndStatementBeforeLineTerminator(
      source,
      previousTokenIndex,
      completedRegexLiteralEnds,
    )
  ) {
    return true;
  }
  if (source[previousTokenIndex] !== ":") return false;

  const labelEnd = previousSignificantIndex(source, previousTokenIndex) + 1;
  const labelStart = identifierStartBefore(source, labelEnd, rangeStart);
  if (
    labelStart < labelEnd &&
    isIdentifierStartOrEscapeAt(source, labelStart)
  ) {
    const beforeLabel = previousSignificantIndex(source, labelStart);
    if (
      beforeLabel < rangeStart || source[beforeLabel] === ";" || source[beforeLabel] === "}"
    ) {
      return true;
    }
  }

  return isSwitchClauseBlockOpenBrace(source, previousTokenIndex, rangeStart, enclosingOpenBrace);
}

function openBraceContext(
  source: string,
  rangeStart: number,
  index: number,
  previousTokenIndex: number,
  context: BraceScanContext,
): OpenBraceContext {
  const { matchingOpenParens, currentParen, enclosingOpenBrace, completedRegexLiteralEnds } =
    context;
  return {
    index,
    previousTokenIndex,
    isDeclarationBlock: isFunctionDeclarationBlockOpenBrace(
      source,
      previousTokenIndex,
      matchingOpenParens,
    ) || isTypeScriptFunctionDeclarationBlockOpenBrace(source, index, previousTokenIndex) ||
      isClassDeclarationBlockOpenBrace(source, index, previousTokenIndex, currentParen) ||
      isTypeScriptDeclarationBlockOpenBrace(source, index, previousTokenIndex),
    isPlainStatementBlock: isPlainStatementBlockOpenBrace(
      source,
      rangeStart,
      index,
      previousTokenIndex,
      enclosingOpenBrace,
      completedRegexLiteralEnds,
    ),
  };
}

function isDeclarationBlockCloseBrace(
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  return mapGet(matchingOpenBraces, index)?.isDeclarationBlock === true;
}

function isStatementBlockCloseBrace(
  source: string,
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = mapGet(matchingOpenBraces, index);
  if (openBrace === undefined) return false;
  const keyword = keywordBefore(source, openBrace.index, openBrace.previousTokenIndex);
  return keyword === "try" || keyword === "catch" || keyword === "finally" ||
    keyword === "do" || keyword === "else";
}

function isPlainStatementBlockCloseBrace(
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  return mapGet(matchingOpenBraces, index)?.isPlainStatementBlock === true;
}

function isArrowFunctionBodyCloseBraceAtAsiBoundary(
  source: string,
  index: number,
  nextTokenIndex: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = mapGet(matchingOpenBraces, index);
  if (openBrace === undefined || source[openBrace.previousTokenIndex] !== ">") return false;

  const beforeArrow = previousSignificantIndex(source, openBrace.previousTokenIndex);
  return source[beforeArrow] === "=" &&
    hasLineTerminatorBetween(source, index + 1, nextTokenIndex);
}

function isForOfKeywordBefore(
  source: string,
  rangeStart: number,
  currentParen: OpenParenContext | undefined,
  previousTokenIndex: number,
): boolean {
  const keywordEnd = previousTokenIndex + 1;
  let keywordStart = keywordEnd;
  while (keywordStart > rangeStart && regexpTest(/[A-Za-z_$]/, source[keywordStart - 1] ?? "")) {
    keywordStart--;
  }
  if (stringSlice(source, keywordStart, keywordEnd) !== "of") return false;

  const beforeKeyword = previousSignificantIndex(source, keywordStart);
  if (beforeKeyword >= rangeStart && source[beforeKeyword] === ".") return false;
  const beforeKeywordChar = source[beforeKeyword];
  if (
    !isIdentifierPartAt(source, beforeKeyword) &&
    beforeKeywordChar !== "]" &&
    beforeKeywordChar !== "}" &&
    beforeKeywordChar !== ")"
  ) {
    return false;
  }
  return currentParen?.isForHeader === true && !currentParen.hasSemicolon;
}

function moduleDeclarationKeywordAt(source: string, cursor: number): "import" | "export" | null {
  if (
    stringStartsWith(source, "import", cursor) &&
    !isIdentifierBoundaryBefore(source, cursor) &&
    !isIdentifierBoundaryAfter(source, cursor + "import".length)
  ) return "import";
  if (
    stringStartsWith(source, "export", cursor) &&
    !isIdentifierBoundaryBefore(source, cursor) &&
    !isIdentifierBoundaryAfter(source, cursor + "export".length)
  ) return "export";
  return null;
}

function ignoredTextEndsStatement(source: string, cursor: number, skipped: number): boolean {
  if (source[cursor] !== "/") return false;
  if (source[cursor + 1] === "/") return true;
  return source[cursor + 1] === "*" && hasLineTerminatorBetween(source, cursor + 2, skipped - 2);
}

function createModuleDeclarationTracker(
  source: string,
  rangeStart: number,
): (end: number) => { keyword: "import" | "export"; index: number } | null {
  let cursor = rangeStart;
  let atStatementStart = true;
  const depth: DelimiterDepth = { paren: 0, brace: 0, bracket: 0 };
  let candidate: { keyword: "import" | "export"; index: number } | null = null;

  const advanceStatementSeparator = (char: string | undefined, atTopLevel: boolean): boolean => {
    if (!atTopLevel) return false;
    if (char === ";") {
      candidate = null;
      atStatementStart = true;
      cursor++;
      return true;
    }
    if (char !== undefined && isLineTerminator(char)) {
      atStatementStart = true;
      cursor++;
      return true;
    }
    return false;
  };

  return (end: number) => {
    while (cursor <= end) {
      const skipped = skipIgnored(source, cursor);
      if (skipped !== cursor) {
        atStatementStart = ignoredTextEndsStatement(source, cursor, skipped);
        cursor = skipped;
        continue;
      }

      const char = source[cursor];
      advanceDelimiterDepth(depth, char);

      const atTopLevel = atDelimiterTopLevel(depth);
      if (advanceStatementSeparator(char, atTopLevel)) continue;
      if (regexpTest(/\s/, char ?? "")) {
        cursor++;
        continue;
      }

      if (atTopLevel && atStatementStart) {
        const keyword = moduleDeclarationKeywordAt(source, cursor);
        if (keyword !== null) {
          candidate = { keyword, index: cursor };
          atStatementStart = false;
          cursor += keyword.length;
          continue;
        }
      }

      if (atTopLevel) atStatementStart = false;
      cursor++;
    }

    return candidate;
  };
}

function isCompletedModuleDeclarationBeforeRegex(
  source: string,
  index: number,
  previousTokenIndex: number,
  moduleDeclarationBefore: (
    end: number,
  ) => { keyword: "import" | "export"; index: number } | null,
): boolean {
  if (!hasLineTerminatorBetween(source, previousTokenIndex + 1, index)) return false;

  const declaration = moduleDeclarationBefore(previousTokenIndex);
  if (declaration === null) return false;

  const declarationSource = stringTrim(normalizedDeclarationPrefix(
    source,
    declaration.index,
    previousTokenIndex + 1,
  ));

  if (declaration.keyword === "import") {
    return (
      regexpTest(/^import\s*["'`][\s\S]*["'`]$/, declarationSource) ||
      regexpTest(/^import\b[\s\S]*\bfrom\s*["'`][\s\S]*["'`]$/, declarationSource)
    ) && !regexpTest(/^import\s*[.(]/, declarationSource);
  }
  return regexpTest(/^export\b[\s\S]*\bfrom\s*["'`][\s\S]*["'`]$/, declarationSource) ||
    regexpTest(/^export\s+(?:type\s+)?\{[\s\S]*\}$/, declarationSource);
}

function isCompletedLocalExportListBeforeRegex(
  source: string,
  index: number,
  previousTokenIndex: number,
  statementStart: number,
): boolean {
  if (!hasLineTerminatorBetween(source, previousTokenIndex + 1, index)) return false;

  const declarationSource = stringTrim(normalizedDeclarationPrefix(
    source,
    statementStart,
    previousTokenIndex + 1,
  ));
  return regexpTest(/^(?:type\s+)?\{[\s\S]*\}$/, declarationSource);
}

function isPostfixNonNullAssertionBefore(
  source: string,
  index: number,
  rangeStart: number,
): boolean {
  const beforeBang = previousSignificantIndexBeforeIgnored(source, index);
  return beforeBang >= rangeStart &&
    !hasLineTerminatorBetween(source, beforeBang + 1, index) &&
    canEndStatementBeforeLineTerminator(source, beforeBang);
}

function isTypeArgumentCalleeBefore(
  source: string,
  cursor: number,
  rangeStart: number,
  sawTypeContent: boolean,
): boolean {
  const beforeOpen = previousSignificantIndexBeforeIgnored(source, cursor);
  const beforeOpenChar = source[beforeOpen];
  return sawTypeContent && beforeOpen >= rangeStart &&
    (isIdentifierPartAt(source, beforeOpen) ||
      isIdentifierEscapeEndingAt(source, beforeOpen + 1) ||
      beforeOpenChar === ")" || beforeOpenChar === "]");
}

function isCompletedTypeArgumentListBefore(
  source: string,
  closeIndex: number,
  rangeStart: number,
): boolean {
  let cursor = closeIndex - 1;
  let angleDepth = 1;
  const depth: DelimiterDepth = { paren: 0, brace: 0, bracket: 0 };
  let sawTypeContent = false;

  while (cursor >= rangeStart) {
    const char = source[cursor];

    if (retreatDelimiterDepth(depth, char)) {
      cursor--;
      continue;
    }
    if (atDelimiterTopLevel(depth)) {
      if (char === ">") {
        angleDepth++;
      } else if (char === "<") {
        angleDepth--;
        if (angleDepth === 0) {
          return isTypeArgumentCalleeBefore(source, cursor, rangeStart, sawTypeContent);
        }
      } else if (!regexpTest(/\s/, char ?? "")) {
        sawTypeContent = true;
      }
    } else if (!regexpTest(/\s/, char ?? "")) {
      sawTypeContent = true;
    }

    cursor--;
  }

  return false;
}

function regexPunctuationDecision(
  source: string,
  previous: number,
  rangeStart: number,
  char: string | undefined,
): boolean | undefined {
  if (
    (char === "+" || char === "-") &&
    previous - 1 >= rangeStart &&
    source[previous - 1] === char
  ) {
    return false;
  }
  if (
    char === "." &&
    previous - 2 >= rangeStart &&
    source[previous - 1] === "." &&
    source[previous - 2] === "."
  ) {
    return true;
  }
  if (char === "!") return !isPostfixNonNullAssertionBefore(source, previous, rangeStart);
  if (char === ">" && isCompletedTypeArgumentListBefore(source, previous, rangeStart)) {
    return false;
  }
  if (char !== undefined && stringIncludes("([{=,:;~?&|+-*%^<>", char)) return true;

  return undefined;
}

function canStartRegexLiteral(
  source: string,
  index: number,
  rangeStart: number,
  context: RegexScanContext,
): boolean {
  const {
    matchingOpenBraces,
    matchingOpenParens,
    currentParen,
    previousTokenIndex,
    moduleDeclarationBefore,
  } = context;
  const previous = previousTokenIndex;
  if (previous < rangeStart) return true;
  if (
    isCompletedModuleDeclarationBeforeRegex(
      source,
      index,
      previous,
      moduleDeclarationBefore,
    )
  ) return true;

  const char = source[previous];
  if (
    char === ")" &&
    isControlConditionCloseParen(previous, rangeStart, matchingOpenParens)
  ) return true;
  if (
    char === "}" &&
    (isControlBlockCloseBrace(
      source,
      previous,
      rangeStart,
      matchingOpenBraces,
      matchingOpenParens,
    ) ||
      isDeclarationBlockCloseBrace(previous, matchingOpenBraces) ||
      isStatementBlockCloseBrace(source, previous, matchingOpenBraces) ||
      isPlainStatementBlockCloseBrace(previous, matchingOpenBraces) ||
      isArrowFunctionBodyCloseBraceAtAsiBoundary(
        source,
        previous,
        index,
        matchingOpenBraces,
      ))
  ) return true;
  const punctuationDecision = regexPunctuationDecision(source, previous, rangeStart, char);
  if (punctuationDecision !== undefined) return punctuationDecision;

  const keyword = keywordBefore(source, index, previous);
  // One gate for every keyword in the list below, rather than a guard per
  // keyword: one added later inherits it automatically.
  if (keyword !== null && isMemberNameBefore(source, previous)) return false;
  if (keyword === "of") {
    return isForOfKeywordBefore(source, rangeStart, currentParen, previous);
  }

  const isKeywordRegexPrefix = arrayIncludes([
    "case",
    "default",
    "delete",
    "do",
    "else",
    "extends",
    "in",
    "instanceof",
    "new",
    "await",
    "break",
    "continue",
    "debugger",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
  ], keyword ?? "");
  if (isKeywordRegexPrefix) return true;
  if (isTypeAliasDeclarationBeforeRegex(source, index, previous, rangeStart)) return true;
  if (isTypeScriptAmbientDeclarationBeforeRegex(source, index, previous, rangeStart)) return true;

  return restrictedStatementKeywordBeforeLabel(source, index, previous, rangeStart) !== null;
}

function skipRegexLiteral(source: string, regexIndex: number): number {
  let cursor = regexIndex + 1;
  let inCharacterClass = false;

  while (cursor < source.length) {
    const char = source[cursor];

    if (char === "\\") {
      cursor += 2;
      continue;
    }

    if (char === "[" && !inCharacterClass) {
      inCharacterClass = true;
      cursor++;
      continue;
    }

    if (char === "]" && inCharacterClass) {
      inCharacterClass = false;
      cursor++;
      continue;
    }

    if (char === "/" && !inCharacterClass) {
      cursor++;
      while (regexpTest(/[A-Za-z]/, source[cursor] ?? "")) cursor++;
      return cursor;
    }

    cursor++;
  }

  return source.length;
}

function canStartRawJsxOpeningTag(source: string, index: number): boolean {
  if (source[index - 1] === "<") return false;

  const previous = previousSignificantIndex(source, index);
  if (previous < 0) return true;

  const char = source[previous];
  if (char !== undefined && stringIncludes("([{=,:;!~?&|+-*%^<>", char)) return true;
  if (char === "}") return true;

  const keyword = keywordBefore(source, index, previous);
  return arrayIncludes(["case", "default", "return", "throw", "yield"], keyword ?? "");
}

function rawJsxTagName(source: string, index: number): { name: string | null; end: number } {
  if (source[index] === ">") return { name: null, end: index };

  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (
      char === "." ||
      char === ":" ||
      char === "-" ||
      isIdentifierStartAt(source, cursor) ||
      regexpTest(IDENTIFIER_PART_PATTERN, char ?? "")
    ) {
      cursor++;
      continue;
    }
    break;
  }

  return { name: stringSlice(source, index, cursor), end: cursor };
}

function findParenEnd(source: string, index: number): number | null {
  let cursor = index + 1;
  let depth = 1;

  while (cursor < source.length) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (source[cursor] === "(") depth++;
    else if (source[cursor] === ")") {
      depth--;
      if (depth === 0) return cursor + 1;
    }
    cursor++;
  }

  return null;
}

function createRawJsxLookaheadCache(): RawJsxLookaheadCache {
  return {
    closingTagsByStatementEnd: new IntrinsicMap(),
    statementEnds: [],
    statementEndCursor: 0,
  };
}

function cachedStatementEndBefore(
  start: number,
  ranges: RawJsxLookaheadCache["statementEnds"],
  rangeIndex: number,
  cache: RawJsxLookaheadCache,
): number | undefined {
  let low = 0;
  let high = rangeIndex;
  while (low <= high) {
    const mid = MathFloor((low + high) / 2);
    const range = ranges[mid]!;
    if (start < range.start) high = mid - 1;
    else if (start >= range.end) low = mid + 1;
    else {
      cache.statementEndCursor = mid;
      return range.end;
    }
  }
  return undefined;
}

function cachedStatementEndAtOrAfter(
  start: number,
  ranges: RawJsxLookaheadCache["statementEnds"],
  rangeIndex: number,
  cache: RawJsxLookaheadCache,
): number | undefined {
  while (rangeIndex < ranges.length && start >= ranges[rangeIndex]!.end) rangeIndex++;
  if (
    rangeIndex < ranges.length &&
    start >= ranges[rangeIndex]!.start &&
    start < ranges[rangeIndex]!.end
  ) {
    cache.statementEndCursor = rangeIndex;
    return ranges[rangeIndex]!.end;
  }
  return undefined;
}

function cachedStatementEndAfter(start: number, cache: RawJsxLookaheadCache): number | undefined {
  const ranges = cache.statementEnds;
  const rangeIndex = MathMin(cache.statementEndCursor, ranges.length - 1);
  if (rangeIndex >= 0) {
    if (start < ranges[rangeIndex]!.start) {
      return cachedStatementEndBefore(start, ranges, rangeIndex, cache);
    }
    return cachedStatementEndAtOrAfter(start, ranges, rangeIndex, cache);
  }
  return undefined;
}

function statementEndAfter(
  source: string,
  start: number,
  cache?: RawJsxLookaheadCache,
): number {
  if (cache !== undefined) {
    const cached = cachedStatementEndAfter(start, cache);
    if (cached !== undefined) return cached;
  }

  const end = nextStatementCursor(source, start);
  if (cache) primordialArrayPush(cache.statementEnds, { start, end });
  if (cache !== undefined) cache.statementEndCursor = cache.statementEnds.length - 1;
  return end;
}

function hasRawJsxClosingTagBeforeStatementEnd(
  source: string,
  name: string,
  start: number,
  cache?: RawJsxLookaheadCache,
): boolean {
  const statementEnd = statementEndAfter(source, start, cache);
  const cached = cache ? mapGet(cache.closingTagsByStatementEnd, statementEnd) : undefined;
  const index = cached !== undefined && start >= cached.start
    ? cached
    : indexRawJsxClosingTags(source, start, statementEnd);
  if (cache !== undefined && index !== cached) {
    mapSet(cache.closingTagsByStatementEnd, statementEnd, index);
  }

  const positions = mapGet(index.tags, name);
  if (positions !== undefined && hasPositionAtOrAfter(positions, start)) return true;
  return hasRawJsxClosingTagAcrossText(source, name, start, statementEnd);
}

function indexRawJsxClosingTags(
  source: string,
  start: number,
  statementEnd: number,
): { start: number; tags: Map<string, number[]> } {
  const tags = new IntrinsicMap<string, number[]>();
  let closing = stringIndexOf(source, "<", start);
  while (closing >= 0 && closing < statementEnd) {
    if (source[closing + 1] === "/") {
      const tag = rawJsxTagName(source, closing + 2);
      const afterName = source[tag.end];
      if (
        tag.name !== null && tag.name !== "" &&
        (afterName === ">" || afterName === "/" || regexpTest(/\s/, afterName ?? ""))
      ) {
        let positions = mapGet(tags, tag.name);
        if (positions === undefined) {
          positions = [];
          mapSet(tags, tag.name, positions);
        }
        primordialArrayPush(positions, closing);
      }
    }
    closing = stringIndexOf(source, "<", closing + 1);
  }
  return { start, tags };
}

function identifierAt(source: string, index: number): string | null {
  if (!isIdentifierStartAt(source, index)) return null;
  let cursor = index + 1;
  while (cursor < source.length && isIdentifierPartAt(source, cursor)) cursor++;
  return stringSlice(source, index, cursor);
}

function looksLikeStatementAfterJsxTextBreak(source: string, index: number): boolean {
  const start = skipWhitespace(source, index);
  const keyword = identifierAt(source, start);
  return keyword !== null && setHas(JSX_TEXT_BREAK_STATEMENT_KEYWORDS, keyword);
}

function isNamedRawJsxClosingTagAt(source: string, cursor: number, name: string): boolean {
  if (source[cursor + 1] !== "/") return false;
  const tag = rawJsxTagName(source, cursor + 2);
  const afterName = source[tag.end];
  return tag.name === name &&
    (afterName === ">" || afterName === "/" || regexpTest(/\s/, afterName ?? ""));
}

function isStatementBreakAfterJsxText(
  source: string,
  cursor: number,
  statementEnd: number,
): boolean {
  const char = source[cursor];
  return cursor >= statementEnd &&
    (char === ";" || (char !== undefined && isLineTerminator(char))) &&
    looksLikeStatementAfterJsxTextBreak(source, cursor + 1);
}

function hasRawJsxClosingTagAcrossText(
  source: string,
  name: string,
  start: number,
  statementEnd: number,
): boolean {
  const limit = MathMin(source.length, start + MAX_RAW_JSX_TEXT_CLOSING_LOOKAHEAD);
  let cursor = start;

  while (cursor < limit) {
    const char = source[cursor];
    if (char === "<") return isNamedRawJsxClosingTagAt(source, cursor, name);

    if (char === "{") {
      const expressionEnd = findTemplateExpressionEnd(source, cursor + 1);
      if (expressionEnd === null) return false;
      cursor = expressionEnd + 1;
      continue;
    }

    if (char === "}" || char === ")" || char === "]") return false;
    if (isStatementBreakAfterJsxText(source, cursor, statementEnd)) return false;

    cursor++;
  }

  return false;
}

function hasPositionAtOrAfter(positions: readonly number[], start: number): boolean {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = MathFloor((low + high) / 2);
    if (positions[mid]! < start) low = mid + 1;
    else high = mid;
  }
  return low < positions.length;
}

function looksLikeTypeScriptAngleConstruct(
  source: string,
  tagStart: number,
  tagEnd: number,
  name: string | null,
  cache?: RawJsxLookaheadCache,
): boolean {
  if (name === null) return false;

  const next = skipWhitespaceAndComments(source, tagEnd);
  if (source[next] === "(") {
    const parenEnd = findParenEnd(source, next);
    const afterParen = parenEnd === null ? -1 : skipWhitespaceAndComments(source, parenEnd);
    if (afterParen >= 0 && stringSlice(source, afterParen, afterParen + 2) === "=>") {
      return true;
    }
  }

  const quotedValueEnd = source[next] === '"' || source[next] === "'"
    ? skipIgnored(source, next)
    : next;
  if (
    source[next] !== undefined &&
    (isIdentifierStartAt(source, next) || source[next] === "(" || quotedValueEnd !== next) &&
    !hasRawJsxClosingTagBeforeStatementEnd(source, name, quotedValueEnd, cache)
  ) {
    const before = previousSignificantIndex(source, tagStart);
    return before >= 0 && stringIncludes("=(:,[!~?&|+-*%^<>", source[before] ?? "");
  }

  return false;
}

interface RawJsxAttributeCursor {
  cursor: number;
  quote: string | null;
}

function advanceRawJsxAttributeQuote(
  char: string | undefined,
  state: RawJsxAttributeCursor,
): boolean {
  if (state.quote !== null) {
    if (char === "\\") {
      state.cursor += 2;
      return true;
    }
    if (char === state.quote) state.quote = null;
    state.cursor++;
    return true;
  }
  if (char === '"' || char === "'") {
    state.quote = char;
    state.cursor++;
    return true;
  }
  return false;
}

function readRawJsxAttributes(
  source: string,
  nameStart: number,
): { end: number; expressionRanges: RawJsxTagSkip["expressionRanges"] } | null {
  const state: RawJsxAttributeCursor = { cursor: nameStart, quote: null };
  const expressionRanges: RawJsxTagSkip["expressionRanges"] = [];
  while (state.cursor < source.length) {
    const char = source[state.cursor];
    if (advanceRawJsxAttributeQuote(char, state)) continue;
    if (char === "{") {
      const expressionEnd = findTemplateExpressionEnd(source, state.cursor + 1);
      if (expressionEnd === null) return null;
      primordialArrayPush(expressionRanges, { start: state.cursor + 1, end: expressionEnd });
      state.cursor = expressionEnd + 1;
      continue;
    }
    if (char === ">") return { end: state.cursor + 1, expressionRanges };
    state.cursor++;
  }
  return null;
}

function readRawJsxTag(
  source: string,
  index: number,
  options: RawJsxTagOptions = {},
): RawJsxTagSkip | null {
  if (source[index] !== "<") return null;

  const isClosingTag = source[index + 1] === "/";
  if (
    !canStartRawJsxOpeningTag(source, index) &&
    !(isClosingTag && options.allowClosingTagAfterText === true)
  ) {
    return null;
  }

  const nameStart = isClosingTag ? index + 2 : index + 1;
  if (source[nameStart] !== ">" && !isIdentifierStartAt(source, nameStart)) return null;
  const name = rawJsxTagName(source, nameStart).name;

  const attributes = readRawJsxAttributes(source, nameStart);
  if (attributes === null) return null;
  const beforeClose = previousSignificantIndex(source, attributes.end - 1);
  const isSelfClosingTag = !isClosingTag && source[beforeClose] === "/";
  if (
    !isClosingTag && !isSelfClosingTag &&
    looksLikeTypeScriptAngleConstruct(source, index, attributes.end, name, options.lookaheadCache)
  ) return null;
  return {
    end: attributes.end,
    expressionRanges: attributes.expressionRanges,
    name,
    isClosingTag,
    isSelfClosingTag,
  };
}

function skipRawJsxTag(
  source: string,
  index: number,
  lookaheadCache?: RawJsxLookaheadCache,
): number {
  return readRawJsxTag(source, index, { lookaheadCache })?.end ?? index;
}

function skipRawJsxText(source: string, index: number): number {
  const nextTag = stringIndexOf(source, "<", index);
  const nextExpression = stringIndexOf(source, "{", index);
  if (nextTag === -1) return nextExpression === -1 ? source.length : nextExpression;
  if (nextExpression === -1) return nextTag;
  return MathMin(nextTag, nextExpression);
}

function skipExpressionIgnored(
  source: string,
  index: number,
  rangeStart: number,
  depth: number,
  context: ExpressionScanContext,
): number {
  const {
    matchingOpenBraces,
    matchingOpenParens,
    currentParen,
    previousTokenIndex,
    moduleDeclarationBefore,
    rawJsxLookaheadCache,
    completedRegexLiteralEnds,
  } = context;
  const char = source[index];
  const next = source[index + 1];

  const jsxTagEnd = skipRawJsxTag(source, index, rawJsxLookaheadCache);
  if (jsxTagEnd !== index) return jsxTagEnd;

  if (char === "/" && next === "/") {
    return skipLineComment(source, index);
  }

  if (char === "/" && next === "*") {
    const end = stringIndexOf(source, "*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (char === '"' || char === "'") return skipIgnored(source, index);
  if (char === "`") return skipFullTemplateLiteral(source, index, depth + 1);
  if (
    char === "/" &&
    canStartRegexLiteral(source, index, rangeStart, {
      matchingOpenBraces,
      matchingOpenParens,
      currentParen,
      previousTokenIndex,
      moduleDeclarationBefore,
    })
  ) {
    const end = skipRegexLiteral(source, index);
    if (completedRegexLiteralEnds !== undefined) setAdd(completedRegexLiteralEnds, end - 1);
    return end;
  }

  return index;
}

function tokenIndexAfterIgnored(
  source: string,
  index: number,
  skipped: number,
  previousTokenIndex: number,
): number {
  const isComment = source[index] === "/" &&
    (source[index + 1] === "/" || source[index + 1] === "*");
  return isComment ? previousTokenIndex : MathMax(index, skipped - 1);
}

function isPropertyAccessBeforeImport(
  source: string,
  previousTokenIndex: number,
  rangeStart: number,
): boolean {
  const previous = source[previousTokenIndex];
  if (previous === "#") return true;
  if (previous !== ".") return false;
  const isSpread = previousTokenIndex - 2 >= rangeStart &&
    source[previousTokenIndex - 1] === "." &&
    source[previousTokenIndex - 2] === ".";
  return !isSpread;
}

interface SourceWalkState {
  cursor: number;
  atStatementStart: boolean;
  openBraces: OpenBraceContext[];
  matchingOpenBraces: Map<number, OpenBraceContext>;
  openParens: OpenParenContext[];
  matchingOpenParens: Map<number, OpenParenContext>;
  previousTokenIndex: number;
  moduleDeclarationBefore: ModuleDeclarationBefore;
  completedRegexLiteralEnds: Set<number>;
  rawJsxTextDepth: number;
  rawJsxExpressionBraceDepth: number;
  rawJsxExpressionBraceStack: boolean[];
  rawJsxLookaheadCache: RawJsxLookaheadCache;
}

function createSourceWalkState(source: string, start: number): SourceWalkState {
  return {
    cursor: start,
    atStatementStart: true,
    openBraces: [],
    matchingOpenBraces: new IntrinsicMap<number, OpenBraceContext>(),
    openParens: [],
    matchingOpenParens: new IntrinsicMap<number, OpenParenContext>(),
    previousTokenIndex: start - 1,
    moduleDeclarationBefore: createModuleDeclarationTracker(source, start),
    completedRegexLiteralEnds: new IntrinsicSet<number>(),
    rawJsxTextDepth: 0,
    rawJsxExpressionBraceDepth: 0,
    rawJsxExpressionBraceStack: [],
    rawJsxLookaheadCache: createRawJsxLookaheadCache(),
  };
}

function rawJsxTagAtCursor(source: string, state: SourceWalkState): RawJsxTagSkip | null {
  return readRawJsxTag(source, state.cursor, {
    allowClosingTagAfterText: isInRawJsxText(
      state.rawJsxTextDepth,
      state.rawJsxExpressionBraceDepth,
    ),
    lookaheadCache: state.rawJsxLookaheadCache,
  });
}

function advancePastRawJsxTag(tag: RawJsxTagSkip, state: SourceWalkState): void {
  if (tag.isClosingTag) {
    state.rawJsxTextDepth = MathMax(0, state.rawJsxTextDepth - 1);
  } else if (!tag.isSelfClosingTag) {
    state.rawJsxTextDepth++;
  }
  state.atStatementStart = false;
  state.previousTokenIndex = tag.end - 1;
  state.cursor = tag.end;
}

function advanceRawJsxText(source: string, state: SourceWalkState): boolean {
  if (!isInRawJsxText(state.rawJsxTextDepth, state.rawJsxExpressionBraceDepth)) return false;
  const textEnd = skipRawJsxText(source, state.cursor);
  if (textEnd === state.cursor) return false;
  state.atStatementStart = false;
  state.cursor = textEnd;
  return true;
}

function recordOpeningBrace(source: string, rangeStart: number, state: SourceWalkState): void {
  const isRawJsxExpressionBrace = isInRawJsxText(
    state.rawJsxTextDepth,
    state.rawJsxExpressionBraceDepth,
  );
  primordialArrayPush(state.rawJsxExpressionBraceStack, isRawJsxExpressionBrace);
  if (isRawJsxExpressionBrace) state.rawJsxExpressionBraceDepth++;
  primordialArrayPush(
    state.openBraces,
    openBraceContext(source, rangeStart, state.cursor, state.previousTokenIndex, {
      matchingOpenParens: state.matchingOpenParens,
      currentParen: primordialArrayAt(state.openParens, -1),
      enclosingOpenBrace: primordialArrayAt(state.openBraces, -1),
      completedRegexLiteralEnds: state.completedRegexLiteralEnds,
    }),
  );
}

function recordClosingBrace(state: SourceWalkState): void {
  const isRawJsxExpressionBrace = primordialArrayPop(state.rawJsxExpressionBraceStack);
  if (isRawJsxExpressionBrace) {
    state.rawJsxExpressionBraceDepth = MathMax(0, state.rawJsxExpressionBraceDepth - 1);
  }
  const openBrace = primordialArrayPop(state.openBraces);
  if (openBrace !== undefined) mapSet(state.matchingOpenBraces, state.cursor, openBrace);
}

function recordOpeningParen(source: string, state: SourceWalkState): void {
  primordialArrayPush(
    state.openParens,
    openParenContext(source, state.cursor, state.previousTokenIndex),
  );
}

function recordClosingParen(state: SourceWalkState): void {
  const openParen = primordialArrayPop(state.openParens);
  if (openParen !== undefined) mapSet(state.matchingOpenParens, state.cursor, openParen);
}

function recordForHeaderSemicolon(char: string | undefined, state: SourceWalkState): void {
  if (char === ";" && primordialArrayAt(state.openParens, -1)?.isForHeader) {
    primordialArrayAt(state.openParens, -1)!.hasSemicolon = true;
  }
}

function advancePastToken(state: SourceWalkState): void {
  state.previousTokenIndex = state.cursor;
  state.cursor++;
}

function advanceDelimiter(
  source: string,
  rangeStart: number,
  char: string | undefined,
  state: SourceWalkState,
): boolean {
  if (char === "{") recordOpeningBrace(source, rangeStart, state);
  else if (char === "}") recordClosingBrace(state);
  else if (char === "(") recordOpeningParen(source, state);
  else if (char === ")") recordClosingParen(state);
  else return false;
  state.atStatementStart = char === "}";
  advancePastToken(state);
  return true;
}

function advancePastIgnored(source: string, skipped: number, state: SourceWalkState): void {
  state.previousTokenIndex = tokenIndexAfterIgnored(
    source,
    state.cursor,
    skipped,
    state.previousTokenIndex,
  );
  state.cursor = skipped;
}

function updateStatementStartAfterIgnored(
  source: string,
  char: string | undefined,
  skipped: number,
  state: SourceWalkState,
): void {
  if (char === "/" && source[state.cursor + 1] === "/") state.atStatementStart = true;
  else if (char === "/" && source[state.cursor + 1] === "*") {
    if (hasLineTerminatorBetween(source, state.cursor + 2, skipped - 2)) {
      state.atStatementStart = true;
    }
  } else state.atStatementStart = false;
}

function advanceStaticImportTrivia(
  source: string,
  char: string | undefined,
  state: SourceWalkState,
): boolean {
  const jsxTag = rawJsxTagAtCursor(source, state);
  if (jsxTag !== null) {
    advancePastRawJsxTag(jsxTag, state);
    return true;
  }
  if (advanceRawJsxText(source, state)) return true;
  const skipped = skipExpressionIgnored(source, state.cursor, 0, 0, {
    matchingOpenBraces: state.matchingOpenBraces,
    matchingOpenParens: state.matchingOpenParens,
    currentParen: primordialArrayAt(state.openParens, -1),
    previousTokenIndex: state.previousTokenIndex,
    moduleDeclarationBefore: state.moduleDeclarationBefore,
    rawJsxLookaheadCache: state.rawJsxLookaheadCache,
    completedRegexLiteralEnds: state.completedRegexLiteralEnds,
  });
  if (skipped !== state.cursor) {
    updateStatementStartAfterIgnored(source, char, skipped, state);
    advancePastIgnored(source, skipped, state);
    return true;
  }
  if (advanceDelimiter(source, 0, char, state)) return true;
  recordForHeaderSemicolon(char, state);
  if (char === ";" || (char !== undefined && isLineTerminator(char))) {
    state.atStatementStart = true;
    if (char === ";") state.previousTokenIndex = state.cursor;
    state.cursor++;
    return true;
  }
  if (regexpTest(/\s/, char ?? "")) {
    state.cursor++;
    return true;
  }
  return false;
}

interface TemplateWalkState extends SourceWalkState {
  braceDepth: number;
}

function advanceTemplateExpressionToken(
  source: string,
  expressionIndex: number,
  state: TemplateWalkState,
): number | null {
  if (source[state.cursor] === "{") {
    recordOpeningBrace(source, expressionIndex, state);
    state.braceDepth++;
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return null;
  }

  if (source[state.cursor] === "}") {
    state.braceDepth--;
    if (state.braceDepth === 0) return state.cursor;
    recordClosingBrace(state);
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return null;
  }

  if (source[state.cursor] === "(") {
    recordOpeningParen(source, state);
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return null;
  }

  if (source[state.cursor] === ")") {
    recordClosingParen(state);
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return null;
  }

  recordForHeaderSemicolon(source[state.cursor], state);

  if (!regexpTest(/\s/, source[state.cursor] ?? "")) state.previousTokenIndex = state.cursor;
  state.cursor++;
  return null;
}

function findTemplateExpressionEnd(
  source: string,
  expressionIndex: number,
  depth = 0,
): number | null {
  assertTemplateLiteralDepth(depth);

  const state: TemplateWalkState = {
    ...createSourceWalkState(source, expressionIndex),
    braceDepth: 1,
  };

  while (state.cursor < source.length) {
    const jsxTag = rawJsxTagAtCursor(source, state);
    if (jsxTag !== null) {
      advancePastRawJsxTag(jsxTag, state);
      continue;
    }
    if (advanceRawJsxText(source, state)) continue;

    const skipped = skipExpressionIgnored(source, state.cursor, expressionIndex, depth, {
      matchingOpenBraces: state.matchingOpenBraces,
      matchingOpenParens: state.matchingOpenParens,
      currentParen: primordialArrayAt(state.openParens, -1),
      previousTokenIndex: state.previousTokenIndex,
      moduleDeclarationBefore: state.moduleDeclarationBefore,
      rawJsxLookaheadCache: state.rawJsxLookaheadCache,
      completedRegexLiteralEnds: state.completedRegexLiteralEnds,
    });
    if (skipped !== state.cursor) {
      state.previousTokenIndex = tokenIndexAfterIgnored(
        source,
        state.cursor,
        skipped,
        state.previousTokenIndex,
      );
      state.cursor = skipped;
      continue;
    }

    const end = advanceTemplateExpressionToken(source, expressionIndex, state);
    if (end !== null) return end;
  }
  return null;
}

interface FromSpanSearchState {
  cursor: number;
  previousTokenIndex: number;
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>;
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>;
  moduleDeclarationBefore: ModuleDeclarationBefore;
  result: StaticImportSpan | null | undefined;
}

function advanceFromSpanSearch(
  source: string,
  statementStart: number,
  matcher: SpecifierMatcher,
  isExportDeclaration: boolean,
  state: FromSpanSearchState,
): void {
  const skipped = skipIgnored(source, state.cursor);
  if (skipped !== state.cursor) {
    state.previousTokenIndex = tokenIndexAfterIgnored(
      source,
      state.cursor,
      skipped,
      state.previousTokenIndex,
    );
    state.cursor = skipped;
    return;
  }

  if (source[state.cursor] === ";") {
    state.result = null;
    return;
  }

  if (
    isExportDeclaration &&
    source[state.cursor] === "/" &&
    isCompletedLocalExportListBeforeRegex(
      source,
      state.cursor,
      state.previousTokenIndex,
      statementStart,
    )
  ) {
    state.result = null;
    return;
  }

  if (
    source[state.cursor] === "/" &&
    canStartRegexLiteral(source, state.cursor, statementStart, {
      matchingOpenBraces: state.matchingOpenBraces,
      matchingOpenParens: state.matchingOpenParens,
      currentParen: undefined,
      previousTokenIndex: state.previousTokenIndex,
      moduleDeclarationBefore: state.moduleDeclarationBefore,
    })
  ) {
    state.cursor = skipRegexLiteral(source, state.cursor);
    state.previousTokenIndex = state.cursor - 1;
    return;
  }

  if (
    stringStartsWith(source, "from", state.cursor) &&
    !isIdentifierPartAt(source, state.cursor - 1) &&
    !isIdentifierPartAt(source, state.cursor + 4)
  ) {
    const quoteIndex = skipWhitespaceAndComments(source, state.cursor + 4);
    const quoted = readQuotedSpecifier(source, quoteIndex);
    if (!quoted) {
      state.cursor++;
      return;
    }

    const matchedPath = matcher(quoted.specifier);
    if (!matchedPath) {
      state.result = null;
      return;
    }

    state.result = {
      original: stringSlice(source, state.cursor, quoted.end),
      path: matchedPath,
      start: state.cursor,
      end: quoted.end,
    };
    return;
  }

  if (!regexpTest(/\s/, source[state.cursor] ?? "")) state.previousTokenIndex = state.cursor;
  state.cursor++;
}

function findFromSpan(
  source: string,
  statementStart: number,
  matcher: SpecifierMatcher,
  isExportDeclaration: boolean,
): StaticImportSpan | null {
  const state: FromSpanSearchState = {
    cursor: statementStart,
    previousTokenIndex: previousSignificantIndexBeforeIgnored(source, statementStart),
    matchingOpenBraces: new IntrinsicMap<number, OpenBraceContext>(),
    matchingOpenParens: new IntrinsicMap<number, OpenParenContext>(),
    moduleDeclarationBefore: () => null,
    result: undefined,
  };
  while (state.cursor < source.length) {
    advanceFromSpanSearch(source, statementStart, matcher, isExportDeclaration, state);
    if (state.result !== undefined) return state.result;
  }
  return null;
}

function canExportHaveFromClause(source: string, statementStart: number): boolean {
  let cursor = skipWhitespaceAndComments(source, statementStart);
  if (
    stringStartsWith(source, "type", cursor) &&
    !isIdentifierPartAt(source, cursor - 1) &&
    !isIdentifierPartAt(source, cursor + "type".length)
  ) {
    cursor = skipWhitespaceAndComments(source, cursor + "type".length);
  }

  return source[cursor] === "*" || source[cursor] === "{";
}

function tokenAt(source: string, index: number, token: string): boolean {
  return stringStartsWith(source, token, index) &&
    !isIdentifierPartAt(source, index - 1) &&
    !isIdentifierPartAt(source, index + token.length);
}

function typeSpecifierEnd(source: string, cursor: number, end: number): number {
  while (cursor < end) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }
    if (source[cursor] === "," || source[cursor] === "}") return cursor;
    cursor++;
  }
  return cursor;
}

function isTypeSpecifierStart(source: string, cursor: number, end: number): boolean {
  return cursor < end && source[cursor] !== "," && source[cursor] !== "}" &&
    !tokenAt(source, cursor, "as");
}

function isWholeTypeOnlyClause(source: string, cursor: number, end: number): boolean {
  return cursor < end && source[cursor] !== "," && !tokenAt(source, cursor, "as") &&
    !tokenAt(source, cursor, "from");
}

/** Whether a static module clause contains no runtime binding or side effect. */
function isTypeOnlyModuleClause(source: string, start: number, end: number): boolean {
  let cursor = skipWhitespaceAndComments(source, start);
  if (tokenAt(source, cursor, "type")) {
    cursor = skipWhitespaceAndComments(source, cursor + "type".length);
    return isWholeTypeOnlyClause(source, cursor, end);
  }
  if (source[cursor] !== "{") return false;
  cursor++;

  let foundTypeSpecifier = false;
  while (cursor < end) {
    cursor = skipWhitespaceAndComments(source, cursor);
    if (source[cursor] === "}") return foundTypeSpecifier;
    if (!tokenAt(source, cursor, "type")) return false;
    cursor = skipWhitespaceAndComments(source, cursor + "type".length);
    if (!isTypeSpecifierStart(source, cursor, end)) return false;
    foundTypeSpecifier = true;

    cursor = typeSpecifierEnd(source, cursor, end);
    if (cursor < end && source[cursor] === "}") return true;
    if (cursor < end && source[cursor] === ",") cursor++;
  }
  return false;
}

/**
 * Validate the match bound every scanner requires.
 *
 * The bound is required rather than defaulted because these scanners run over
 * fetched, untrusted module source: a caller that forgot to bound itself would
 * let one file allocate a span per import without limit. Reaching the bound
 * returns a truncated prefix, so a caller that rewrites every span it collects
 * must ask for one more than it will accept and reject the source when the
 * extra span comes back — otherwise the dropped imports are silently left
 * pointing at unresolved specifiers.
 */
function assertMaxMatches(maxMatches: number): void {
  if (!NumberIsSafeInteger(maxMatches) || maxMatches <= 0) {
    throw new RangeError("maxMatches must be a positive safe integer");
  }
}

function advanceStaticFromImport(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
  state: SourceWalkState,
): boolean {
  const isImport = isStatementKeywordAt(source, state.cursor, "import", state.atStatementStart);
  const isExport = isStatementKeywordAt(source, state.cursor, "export", state.atStatementStart);
  if (!isImport && !isExport) {
    state.atStatementStart = false;
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return false;
  }

  const keywordLength = isImport ? "import".length : "export".length;
  const afterKeyword = skipWhitespaceAndComments(source, state.cursor + keywordLength);
  if (isImport && source[afterKeyword] === "(") {
    state.atStatementStart = false;
    primordialArrayPush(state.openParens, {
      index: afterKeyword,
      isControlCondition: false,
      isForHeader: false,
      hasSemicolon: false,
    });
    state.previousTokenIndex = afterKeyword;
    state.cursor = afterKeyword + 1;
    return false;
  }

  if (isExport && !canExportHaveFromClause(source, afterKeyword)) {
    state.atStatementStart = false;
    state.previousTokenIndex = state.cursor + keywordLength - 1;
    state.cursor = afterKeyword;
    return false;
  }

  const span = findFromSpan(source, afterKeyword, matcher, isExport);
  if (span) {
    primordialArrayPush(spans, {
      ...span,
      typeOnly: isTypeOnlyModuleClause(source, afterKeyword, span.start),
    });
    if (spans.length >= maxMatches) return true;
    state.atStatementStart = false;
    state.previousTokenIndex = span.end - 1;
    state.cursor = span.end;
    return false;
  }

  state.atStatementStart = true;
  state.cursor = nextStatementCursor(source, afterKeyword);
  state.previousTokenIndex = MathMax(state.previousTokenIndex, state.cursor - 1);
  return false;
}

export function findStaticImportFromSpans(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
): StaticImportSpan[] {
  assertMaxMatches(maxMatches);

  const spans: StaticImportSpan[] = [];
  const state = createSourceWalkState(source, 0);
  while (state.cursor < source.length) {
    const char = source[state.cursor];
    if (advanceStaticImportTrivia(source, char, state)) continue;
    if (advanceStaticFromImport(source, matcher, maxMatches, spans, state)) break;
  }
  return spans;
}

function scanTemplateExpressionDynamicImports(
  source: string,
  templateIndex: number,
  rangeEnd: number,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
): number {
  let cursor = templateIndex + 1;

  while (cursor < rangeEnd && cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }

    if (source[cursor] === "`") return cursor + 1;

    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      const expressionStart = cursor + 2;
      const expressionEnd = findTemplateExpressionEnd(source, expressionStart);
      if (expressionEnd === null) return source.length;

      scanDynamicImportRange(source, expressionStart, expressionEnd, matcher, maxMatches, spans);
      if (spans.length >= maxMatches) return expressionEnd + 1;

      cursor = expressionEnd + 1;
      continue;
    }

    cursor++;
  }

  return source.length;
}

function advanceDynamicIgnored(
  source: string,
  rangeStart: number,
  char: string | undefined,
  next: string | undefined,
  state: SourceWalkState,
): boolean {
  if (
    (char === "/" && (next === "/" || next === "*")) ||
    char === '"' ||
    char === "'"
  ) {
    const skipped = skipIgnored(source, state.cursor);
    state.previousTokenIndex = tokenIndexAfterIgnored(
      source,
      state.cursor,
      skipped,
      state.previousTokenIndex,
    );
    state.cursor = skipped;
    return true;
  }

  if (
    char === "/" &&
    canStartRegexLiteral(source, state.cursor, rangeStart, {
      matchingOpenBraces: state.matchingOpenBraces,
      matchingOpenParens: state.matchingOpenParens,
      currentParen: primordialArrayAt(state.openParens, -1),
      previousTokenIndex: state.previousTokenIndex,
      moduleDeclarationBefore: state.moduleDeclarationBefore,
    })
  ) {
    state.cursor = skipRegexLiteral(source, state.cursor);
    state.previousTokenIndex = state.cursor - 1;
    setAdd(state.completedRegexLiteralEnds, state.previousTokenIndex);
    return true;
  }

  return false;
}

function finishDynamicImport(
  source: string,
  rangeEnd: number,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
  state: SourceWalkState,
  candidate: { index: number; literal: NonNullable<ReturnType<typeof readLiteralSpecifier>> },
): boolean {
  const { index: literalIndex, literal } = candidate;
  // The literal must be the whole first argument. `)` closes the call and `,`
  // starts the import-attributes argument; anything else (`+`, a template
  // continuation, a ternary) means the runtime specifier is not this string.
  const afterSpecifier = skipWhitespaceAndComments(source, literal.end);
  const isWholeArgument = afterSpecifier < rangeEnd &&
    (source[afterSpecifier] === ")" || source[afterSpecifier] === ",");

  const matchedPath = isWholeArgument ? matcher(literal.specifier) : null;
  if (matchedPath) {
    primordialArrayPush(spans, {
      original: stringSlice(source, literalIndex, literal.end),
      path: matchedPath,
      start: literalIndex,
      end: literal.end,
    });
    if (spans.length >= maxMatches) return true;
  }

  state.previousTokenIndex = literal.end - 1;
  state.cursor = literal.end;
  return false;
}

function advanceDynamicImport(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
  state: SourceWalkState,
): boolean {
  // `import` used as an expression: not preceded by an identifier char or a
  // dot (which would make it `foo.import` or part of a longer word).
  if (
    !stringStartsWith(source, "import", state.cursor) ||
    isIdentifierBoundaryBefore(source, state.cursor) ||
    isPropertyAccessBeforeImport(source, state.previousTokenIndex, rangeStart) ||
    isIdentifierBoundaryAfter(source, state.cursor + "import".length)
  ) {
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return false;
  }

  const parenIndex = skipWhitespaceAndComments(source, state.cursor + "import".length);
  if (parenIndex >= rangeEnd || source[parenIndex] !== "(") {
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return false;
  }
  // The scanner jumps directly from `import` to its argument, so record the
  // opening parenthesis that the ordinary character walk does not visit.
  primordialArrayPush(state.openParens, {
    index: parenIndex,
    isControlCondition: false,
    isForHeader: false,
    hasSemicolon: false,
  });

  const literalIndex = skipWhitespaceAndComments(source, parenIndex + 1);
  if (literalIndex >= rangeEnd) {
    state.previousTokenIndex = parenIndex;
    state.cursor = parenIndex + 1;
    return false;
  }

  const literal = readLiteralSpecifier(source, literalIndex);
  if (!literal || literal.end > rangeEnd) {
    state.previousTokenIndex = parenIndex;
    state.cursor = parenIndex + 1;
    return false;
  }

  return finishDynamicImport(source, rangeEnd, matcher, maxMatches, spans, state, {
    index: literalIndex,
    literal,
  });
}

function scanRawJsxAttributeImports(
  source: string,
  tag: RawJsxTagSkip,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
): boolean {
  for (const range of primordialArrayValues(tag.expressionRanges)) {
    scanDynamicImportRange(source, range.start, range.end, matcher, maxMatches, spans);
    if (spans.length >= maxMatches) return true;
  }
  return false;
}

function advanceDynamicImportRange(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
  state: SourceWalkState,
): boolean {
  const char = source[state.cursor];
  const next = source[state.cursor + 1];

  const jsxTag = rawJsxTagAtCursor(source, state);
  if (jsxTag !== null) {
    if (scanRawJsxAttributeImports(source, jsxTag, matcher, maxMatches, spans)) return true;
    advancePastRawJsxTag(jsxTag, state);
    return false;
  }

  if (advanceRawJsxText(source, state)) return false;

  if (advanceDynamicIgnored(source, rangeStart, char, next, state)) return false;

  if (char === "`") {
    state.cursor = scanTemplateExpressionDynamicImports(
      source,
      state.cursor,
      rangeEnd,
      matcher,
      maxMatches,
      spans,
    );
    if (spans.length >= maxMatches) return true;
    state.previousTokenIndex = state.cursor - 1;
    return false;
  }

  if (advanceDelimiter(source, rangeStart, char, state)) return false;
  recordForHeaderSemicolon(char, state);

  if (regexpTest(/\s/, char ?? "")) {
    state.cursor++;
    return false;
  }

  if (advanceDynamicImport(source, rangeStart, rangeEnd, matcher, maxMatches, spans, state)) {
    return true;
  }
  return false;
}

function scanDynamicImportRange(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
): void {
  const state = createSourceWalkState(source, rangeStart);

  while (state.cursor < rangeEnd) {
    if (
      advanceDynamicImportRange(source, rangeStart, rangeEnd, matcher, maxMatches, spans, state)
    ) return;
  }
}

/**
 * Find `import("…")` expressions with a literal specifier.
 *
 * The returned span covers the quoted specifier itself (quotes included), not
 * the surrounding `import(...)`, so a replacement is a bare quoted string.
 *
 * A literal here is a single- or double-quoted string, or a backtick template
 * with no `${}` substitution — the three forms whose target is fully known at
 * scan time. An interpolated template and any other expression are skipped,
 * since their target is only known at runtime. So is an argument the literal
 * merely starts: rewriting the `"./foo"` in `import("./foo" + suffix)` would
 * build a path out of a resolved prefix and an unresolved tail.
 *
 * The scan also runs inside template substitutions, so a dynamic import nested
 * in a `${…}` expression is found.
 *
 * `maxMatches` bounds the scan on the same terms as
 * {@link findStaticImportFromSpans}.
 */
export function findDynamicImportSpans(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
): StaticImportSpan[] {
  assertMaxMatches(maxMatches);

  const spans: StaticImportSpan[] = [];
  scanDynamicImportRange(source, 0, source.length, matcher, maxMatches, spans);
  return spans;
}

function advanceStaticSideEffectImport(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
  state: SourceWalkState,
): boolean {
  if (!isStatementKeywordAt(source, state.cursor, "import", state.atStatementStart)) {
    state.atStatementStart = false;
    state.previousTokenIndex = state.cursor;
    state.cursor++;
    return false;
  }

  const literalIndex = skipWhitespaceAndComments(source, state.cursor + "import".length);
  const literal = readLiteralSpecifier(source, literalIndex);
  if (!literal) {
    state.atStatementStart = true;
    state.cursor = nextStatementCursor(source, literalIndex);
    state.previousTokenIndex = MathMax(state.previousTokenIndex, state.cursor - 1);
    return false;
  }

  const matchedPath = matcher(literal.specifier);
  if (matchedPath) {
    primordialArrayPush(spans, {
      original: stringSlice(source, state.cursor, literal.end),
      path: matchedPath,
      start: state.cursor,
      end: literal.end,
    });
    if (spans.length >= maxMatches) return true;
  }

  state.atStatementStart = false;
  state.previousTokenIndex = literal.end - 1;
  state.cursor = literal.end;
  return false;
}

/**
 * Find bare `import "…"` side-effect statements.
 *
 * `maxMatches` bounds the scan on the same terms as
 * {@link findStaticImportFromSpans}.
 */
export function findStaticSideEffectImportSpans(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
): StaticImportSpan[] {
  assertMaxMatches(maxMatches);

  const spans: StaticImportSpan[] = [];
  const state = createSourceWalkState(source, 0);
  while (state.cursor < source.length) {
    const char = source[state.cursor];
    if (advanceStaticImportTrivia(source, char, state)) continue;
    if (advanceStaticSideEffectImport(source, matcher, maxMatches, spans, state)) break;
  }
  return spans;
}
