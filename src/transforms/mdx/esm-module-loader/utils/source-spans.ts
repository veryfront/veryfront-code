import { INVALID_ARGUMENT } from "#veryfront/errors";

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
  expressionRanges: Array<{ start: number; end: number }>;
}

const MAX_TEMPLATE_LITERAL_DEPTH = 512;
const StringFromCodePoint = String.fromCodePoint;
const IDENTIFIER_START_PATTERN = /^[$_\p{ID_Start}]$/u;
const IDENTIFIER_PART_PATTERN = /^[$_\p{ID_Continue}\u200C\u200D]$/u;
const IDENTIFIER_NAME_SOURCE = String.raw`[$_\p{ID_Start}][$\p{ID_Continue}\u200C\u200D]*`;
const FUNCTION_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?(?:\s+${IDENTIFIER_NAME_SOURCE})?\s*$`,
  "u",
);
const CLASS_DECLARATION_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+(?:default\s+)?)?class(?:\s+${IDENTIFIER_NAME_SOURCE})?(?:\s+extends\s+[\s\S]+)?\s*$`,
  "u",
);

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
  const sorted = [...replacements].sort((left, right) => right.start - left.start);

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

  for (const { start, end, replacement, expected } of sorted) {
    if (start < 0 || end < start || end > source.length) {
      throw new RangeError(`Invalid source replacement span: ${start}-${end}`);
    }

    if (expected !== undefined && source.slice(start, end) !== expected) {
      throw INVALID_ARGUMENT.create({
        detail: `Source replacement span did not match expected text: ${expected}`,
      });
    }

    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_PART_PATTERN.test(char);
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_START_PATTERN.test(char);
}

function identifierCharacterAt(source: string, index: number): string | undefined {
  if (index < 0 || index >= source.length) return undefined;

  let characterIndex = index;
  const codeUnit = source.charCodeAt(characterIndex);
  if (
    codeUnit >= 0xdc00 && codeUnit <= 0xdfff && characterIndex > 0
  ) {
    const previousCodeUnit = source.charCodeAt(characterIndex - 1);
    if (previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff) characterIndex--;
  }

  const codePoint = source.codePointAt(characterIndex);
  return codePoint === undefined ? undefined : StringFromCodePoint(codePoint);
}

function isIdentifierPartAt(source: string, index: number): boolean {
  return isIdentifierChar(identifierCharacterAt(source, index));
}

function isIdentifierStartAt(source: string, index: number): boolean {
  return isIdentifierStart(identifierCharacterAt(source, index));
}

function isHexDigit(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Fa-f]/.test(char);
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

    const codePoint = Number.parseInt(source.slice(start + 3, cursor), 16);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return undefined;
    }
    return { codePoint, end: cursor + 1 };
  }

  for (let offset = 2; offset < 6; offset++) {
    if (!isHexDigit(source[start + offset])) return undefined;
  }
  return {
    codePoint: Number.parseInt(source.slice(start + 2, start + 6), 16),
    end: start + 6,
  };
}

function isIdentifierEscapeStartingAt(source: string, index: number): boolean {
  const escape = identifierEscapeCodePoint(source, index);
  return escape !== undefined && isIdentifierChar(StringFromCodePoint(escape.codePoint));
}

function identifierEscapeStartEndingAt(source: string, end: number): number | undefined {
  const fixedStart = end - "\\u0000".length;
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
  if (!source.startsWith(keyword, index)) return false;
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
    const end = source.indexOf("*/", index + 2);
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
  while (/\s/.test(source[cursor] ?? "")) cursor++;
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
  const code = char.charCodeAt(0);
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

function decodeLiteralContents(
  source: string,
  start: number,
  end: number,
  allowLineTerminators: boolean,
): string {
  let result = "";
  let cursor = start;

  while (cursor < end) {
    const char = source[cursor]!;
    if (char !== "\\") {
      if (isLineTerminator(char)) {
        if (!allowLineTerminators) invalidEscapedSpecifier();
        if (char === "\r") {
          result += "\n";
          cursor += source[cursor + 1] === "\n" ? 2 : 1;
          continue;
        }
      }
      result += char;
      cursor++;
      continue;
    }

    const escaped = source[cursor + 1];
    if (escaped === undefined || cursor + 1 >= end) invalidEscapedSpecifier();

    if (isLineTerminator(escaped)) {
      cursor += escaped === "\r" && source[cursor + 2] === "\n" ? 3 : 2;
      continue;
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
      result += simpleEscape;
      cursor += 2;
      continue;
    }

    if (escaped === "0") {
      if (/[0-9]/.test(source[cursor + 2] ?? "")) invalidEscapedSpecifier();
      result += "\0";
      cursor += 2;
      continue;
    }
    if (/[1-9]/.test(escaped)) invalidEscapedSpecifier();

    if (escaped === "x") {
      const value = decodeHexEscape(source, cursor + 2, 2);
      if (value === null || cursor + 4 > end) invalidEscapedSpecifier();
      result += StringFromCodePoint(value);
      cursor += 4;
      continue;
    }

    if (escaped === "u") {
      if (source[cursor + 2] === "{") {
        let escapeEnd = cursor + 3;
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
        result += StringFromCodePoint(value);
        cursor = escapeEnd + 1;
        continue;
      }

      const value = decodeHexEscape(source, cursor + 2, 4);
      if (value === null || cursor + 6 > end) invalidEscapedSpecifier();
      result += StringFromCodePoint(value);
      cursor += 6;
      continue;
    }

    result += escaped;
    cursor += 2;
  }

  return result;
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
  while (cursor >= 0 && /\s/.test(source[cursor] ?? "")) cursor--;
  return cursor;
}

function previousSignificantIndexBeforeIgnored(source: string, index: number): number {
  let cursor = index;

  while (cursor >= 0) {
    cursor = previousSignificantIndex(source, cursor);
    if (cursor < 0) return cursor;

    if (source[cursor] === "/" && source[cursor - 1] === "*") {
      const start = source.lastIndexOf("/*", cursor - 1);
      if (start >= 0) {
        cursor = start;
        continue;
      }
    }

    const lineStart = Math.max(
      source.lastIndexOf("\n", cursor),
      source.lastIndexOf("\r", cursor),
      source.lastIndexOf("\u2028", cursor),
      source.lastIndexOf("\u2029", cursor),
    ) + 1;
    const lineCommentStart = source.lastIndexOf("//", cursor);
    if (lineCommentStart >= lineStart) {
      cursor = lineCommentStart;
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
  return source.slice(start, end);
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
function isMemberNameBefore(
  source: string,
  previousTokenIndex: number,
): boolean {
  const end = previousTokenIndex + 1;
  let start = end;
  while (start > 0 && isIdentifierPartAt(source, start - 1)) start--;
  if (start === end) return false;

  const before = previousSignificantIndex(source, start);
  if (before < 0) return false;

  const char = source[before];
  return char === "." || char === "#";
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
  const openParen = matchingOpenParens.get(index);
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
  const openBrace = matchingOpenBraces.get(index);
  if (openBrace === undefined) return false;

  const beforeOpenBrace = openBrace.previousTokenIndex;
  return beforeOpenBrace >= rangeStart &&
    source[beforeOpenBrace] === ")" &&
    isControlConditionCloseParen(beforeOpenBrace, rangeStart, matchingOpenParens);
}

function normalizedDeclarationPrefix(source: string, start: number, end: number): string {
  return source.slice(start, end).trimStart().replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g,
    " ",
  );
}

function declarationStatementStartBefore(source: string, index: number): number {
  return Math.max(
    source.lastIndexOf(";", index - 1),
    source.lastIndexOf("{", index - 1),
    source.lastIndexOf("}", index - 1),
  ) + 1;
}

function isFunctionDeclarationBlockOpenBrace(
  source: string,
  previousTokenIndex: number,
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
): boolean {
  if (source[previousTokenIndex] !== ")") return false;

  const openParen = matchingOpenParens.get(previousTokenIndex);
  if (openParen === undefined) return false;

  const declarationStart = declarationStatementStartBefore(source, openParen.index);
  const prefix = normalizedDeclarationPrefix(source, declarationStart, openParen.index);
  return FUNCTION_DECLARATION_PREFIX_PATTERN.test(prefix);
}

function isClassDeclarationBlockOpenBrace(
  source: string,
  index: number,
  currentParen: OpenParenContext | undefined,
): boolean {
  const declarationStart = declarationStatementStartBefore(source, index);
  if (currentParen !== undefined && currentParen.index >= declarationStart) return false;

  const prefix = normalizedDeclarationPrefix(source, declarationStart, index);
  return CLASS_DECLARATION_PREFIX_PATTERN.test(prefix);
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
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  while (cursor < colonIndex) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const char = source[cursor];
    if (char === "(") parenDepth++;
    else if (char === ")" && parenDepth > 0) parenDepth--;
    else if (char === "{") braceDepth++;
    else if (char === "}" && braceDepth > 0) braceDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]" && bracketDepth > 0) bracketDepth--;

    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      if (
        source.startsWith("case", cursor) &&
        !isIdentifierBoundaryBefore(source, cursor) &&
        !isIdentifierBoundaryAfter(source, cursor + "case".length)
      ) {
        candidate = cursor;
        cursor += "case".length;
        continue;
      }
      if (
        source.startsWith("default", cursor) &&
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
  const searchStart = Math.max(rangeStart, (enclosingOpenBrace?.index ?? rangeStart - 1) + 1);
  const clauseStart = switchClauseStartBeforeColon(source, searchStart, colonIndex);
  if (clauseStart === null) return false;

  const clausePrefix = normalizedDeclarationPrefix(source, clauseStart, colonIndex).trim();
  return clausePrefix === "default" || /^case\b[\s\S]*\S$/.test(clausePrefix);
}

function isPlainStatementBlockOpenBrace(
  source: string,
  rangeStart: number,
  previousTokenIndex: number,
  enclosingOpenBrace: OpenBraceContext | undefined,
): boolean {
  if (previousTokenIndex < rangeStart) return true;
  if (source[previousTokenIndex] === ";" || source[previousTokenIndex] === "}") return true;
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
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
  currentParen: OpenParenContext | undefined,
  enclosingOpenBrace: OpenBraceContext | undefined,
): OpenBraceContext {
  return {
    index,
    previousTokenIndex,
    isDeclarationBlock: isFunctionDeclarationBlockOpenBrace(
      source,
      previousTokenIndex,
      matchingOpenParens,
    ) || isClassDeclarationBlockOpenBrace(source, index, currentParen),
    isPlainStatementBlock: isPlainStatementBlockOpenBrace(
      source,
      rangeStart,
      previousTokenIndex,
      enclosingOpenBrace,
    ),
  };
}

function isDeclarationBlockCloseBrace(
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  return matchingOpenBraces.get(index)?.isDeclarationBlock === true;
}

function isStatementBlockCloseBrace(
  source: string,
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = matchingOpenBraces.get(index);
  if (openBrace === undefined) return false;
  const keyword = keywordBefore(source, openBrace.index, openBrace.previousTokenIndex);
  return keyword === "try" || keyword === "catch" || keyword === "finally" ||
    keyword === "do" || keyword === "else";
}

function isPlainStatementBlockCloseBrace(
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  return matchingOpenBraces.get(index)?.isPlainStatementBlock === true;
}

function isForOfKeywordBefore(
  source: string,
  rangeStart: number,
  currentParen: OpenParenContext | undefined,
  previousTokenIndex: number,
): boolean {
  const keywordEnd = previousTokenIndex + 1;
  let keywordStart = keywordEnd;
  while (keywordStart > rangeStart && /[A-Za-z_$]/.test(source[keywordStart - 1] ?? "")) {
    keywordStart--;
  }
  if (source.slice(keywordStart, keywordEnd) !== "of") return false;

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

function moduleDeclarationKeywordBefore(
  source: string,
  rangeStart: number,
  end: number,
): { keyword: "import" | "export"; index: number } | null {
  let cursor = rangeStart;
  let atStatementStart = true;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let candidate: { keyword: "import" | "export"; index: number } | null = null;

  while (cursor <= end) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      if (source[cursor] === "/" && source[cursor + 1] === "/") {
        atStatementStart = true;
      } else if (
        source[cursor] === "/" &&
        source[cursor + 1] === "*" &&
        hasLineTerminatorBetween(source, cursor + 2, skipped - 2)
      ) {
        atStatementStart = true;
      } else {
        atStatementStart = false;
      }
      cursor = skipped;
      continue;
    }

    const char = source[cursor];
    if (char === "(") parenDepth++;
    else if (char === ")" && parenDepth > 0) parenDepth--;
    else if (char === "{") braceDepth++;
    else if (char === "}" && braceDepth > 0) braceDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]" && bracketDepth > 0) bracketDepth--;

    const atTopLevel = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
    if (atTopLevel && char === ";") {
      candidate = null;
      atStatementStart = true;
      cursor++;
      continue;
    }
    if (atTopLevel && char !== undefined && isLineTerminator(char)) {
      atStatementStart = true;
      cursor++;
      continue;
    }
    if (/\s/.test(char ?? "")) {
      cursor++;
      continue;
    }

    if (atTopLevel && atStatementStart) {
      if (
        source.startsWith("import", cursor) &&
        !isIdentifierBoundaryBefore(source, cursor) &&
        !isIdentifierBoundaryAfter(source, cursor + "import".length)
      ) {
        candidate = { keyword: "import", index: cursor };
        atStatementStart = false;
        cursor += "import".length;
        continue;
      }
      if (
        source.startsWith("export", cursor) &&
        !isIdentifierBoundaryBefore(source, cursor) &&
        !isIdentifierBoundaryAfter(source, cursor + "export".length)
      ) {
        candidate = { keyword: "export", index: cursor };
        atStatementStart = false;
        cursor += "export".length;
        continue;
      }
    }

    if (atTopLevel) atStatementStart = false;
    cursor++;
  }

  return candidate;
}

function isCompletedModuleDeclarationBeforeRegex(
  source: string,
  index: number,
  rangeStart: number,
  previousTokenIndex: number,
): boolean {
  if (!hasLineTerminatorBetween(source, previousTokenIndex + 1, index)) return false;

  const declaration = moduleDeclarationKeywordBefore(source, rangeStart, previousTokenIndex);
  if (declaration === null) return false;

  const declarationSource = normalizedDeclarationPrefix(
    source,
    declaration.index,
    previousTokenIndex + 1,
  ).trim();

  if (declaration.keyword === "import") {
    return (
      /^import\s*["'`][\s\S]*["'`]$/.test(declarationSource) ||
      /^import\b[\s\S]*\bfrom\s*["'`][\s\S]*["'`]$/.test(declarationSource)
    ) && !/^import\s*[.(]/.test(declarationSource);
  }
  return /^export\b[\s\S]*\bfrom\s*["'`][\s\S]*["'`]$/.test(declarationSource);
}

function canStartRegexLiteral(
  source: string,
  index: number,
  rangeStart: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
  currentParen: OpenParenContext | undefined,
  previousTokenIndex: number,
): boolean {
  const previous = previousTokenIndex;
  if (previous < rangeStart) return true;
  if (isCompletedModuleDeclarationBeforeRegex(source, index, rangeStart, previous)) return true;

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
      isPlainStatementBlockCloseBrace(previous, matchingOpenBraces))
  ) return true;
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
  if (char !== undefined && "([{=,:;!~?&|+-*%^<>".includes(char)) return true;

  const keyword = keywordBefore(source, index, previous);
  // One gate for every keyword in the list below, rather than a guard per
  // keyword: one added later inherits it automatically.
  if (keyword !== null && isMemberNameBefore(source, previous)) return false;
  if (keyword === "of") {
    return isForOfKeywordBefore(source, rangeStart, currentParen, previous);
  }

  const isKeywordRegexPrefix = [
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
  ].includes(keyword ?? "");
  if (isKeywordRegexPrefix) return true;

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
      while (/[A-Za-z]/.test(source[cursor] ?? "")) cursor++;
      return cursor;
    }

    cursor++;
  }

  return source.length;
}

function canStartRawJsxOpeningTag(source: string, index: number): boolean {
  const previous = previousSignificantIndex(source, index);
  if (previous < 0) return true;

  const char = source[previous];
  if (char !== undefined && "([{=,:;!~?&|+-*%^<>".includes(char)) return true;
  if (char === "}") return true;

  const keyword = keywordBefore(source, index, previous);
  return ["case", "default", "return", "throw", "yield"].includes(keyword ?? "");
}

function readRawJsxTag(source: string, index: number): RawJsxTagSkip | null {
  if (source[index] !== "<") return null;

  const isClosingTag = source[index + 1] === "/";
  if (!canStartRawJsxOpeningTag(source, index)) return null;

  const nameStart = isClosingTag ? index + 2 : index + 1;
  if (source[nameStart] !== ">" && !isIdentifierStartAt(source, nameStart)) return null;

  let cursor = nameStart;
  let quote: string | null = null;
  const expressionRanges: RawJsxTagSkip["expressionRanges"] = [];
  while (cursor < source.length) {
    const char = source[cursor];

    if (quote !== null) {
      if (char === "\\") {
        cursor += 2;
        continue;
      }
      if (char === quote) quote = null;
      cursor++;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      cursor++;
      continue;
    }

    if (char === "{") {
      const expressionEnd = findTemplateExpressionEnd(source, cursor + 1);
      if (expressionEnd === null) return null;
      expressionRanges.push({ start: cursor + 1, end: expressionEnd });
      cursor = expressionEnd + 1;
      continue;
    }

    if (char === ">") return { end: cursor + 1, expressionRanges };

    cursor++;
  }

  return null;
}

function skipRawJsxTag(source: string, index: number): number {
  return readRawJsxTag(source, index)?.end ?? index;
}

function skipExpressionIgnored(
  source: string,
  index: number,
  rangeStart: number,
  depth: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
  matchingOpenParens: ReadonlyMap<number, OpenParenContext>,
  currentParen: OpenParenContext | undefined,
  previousTokenIndex: number,
): number {
  const char = source[index];
  const next = source[index + 1];

  const jsxTagEnd = skipRawJsxTag(source, index);
  if (jsxTagEnd !== index) return jsxTagEnd;

  if (char === "/" && next === "/") {
    return skipLineComment(source, index);
  }

  if (char === "/" && next === "*") {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (char === '"' || char === "'") return skipIgnored(source, index);
  if (char === "`") return skipFullTemplateLiteral(source, index, depth + 1);
  if (
    char === "/" &&
    canStartRegexLiteral(
      source,
      index,
      rangeStart,
      matchingOpenBraces,
      matchingOpenParens,
      currentParen,
      previousTokenIndex,
    )
  ) {
    return skipRegexLiteral(source, index);
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
  return isComment ? previousTokenIndex : Math.max(index, skipped - 1);
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

function findTemplateExpressionEnd(
  source: string,
  expressionIndex: number,
  depth = 0,
): number | null {
  assertTemplateLiteralDepth(depth);

  let cursor = expressionIndex;
  let braceDepth = 1;
  const openBraces: OpenBraceContext[] = [];
  const matchingOpenBraces = new Map<number, OpenBraceContext>();
  const openParens: OpenParenContext[] = [];
  const matchingOpenParens = new Map<number, OpenParenContext>();
  let previousTokenIndex = expressionIndex - 1;

  while (cursor < source.length) {
    const skipped = skipExpressionIgnored(
      source,
      cursor,
      expressionIndex,
      depth,
      matchingOpenBraces,
      matchingOpenParens,
      openParens.at(-1),
      previousTokenIndex,
    );
    if (skipped !== cursor) {
      previousTokenIndex = tokenIndexAfterIgnored(
        source,
        cursor,
        skipped,
        previousTokenIndex,
      );
      cursor = skipped;
      continue;
    }

    if (source[cursor] === "{") {
      openBraces.push(
        openBraceContext(
          source,
          expressionIndex,
          cursor,
          previousTokenIndex,
          matchingOpenParens,
          openParens.at(-1),
          openBraces.at(-1),
        ),
      );
      braceDepth++;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (source[cursor] === "}") {
      braceDepth--;
      if (braceDepth === 0) return cursor;
      const openBrace = openBraces.pop();
      if (openBrace !== undefined) matchingOpenBraces.set(cursor, openBrace);
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (source[cursor] === "(") {
      openParens.push(openParenContext(source, cursor, previousTokenIndex));
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (source[cursor] === ")") {
      const openParen = openParens.pop();
      if (openParen !== undefined) matchingOpenParens.set(cursor, openParen);
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (source[cursor] === ";" && openParens.at(-1)?.isForHeader) {
      openParens.at(-1)!.hasSemicolon = true;
    }

    if (!/\s/.test(source[cursor] ?? "")) previousTokenIndex = cursor;
    cursor++;
  }

  return null;
}

function findFromSpan(
  source: string,
  statementStart: number,
  matcher: SpecifierMatcher,
): StaticImportSpan | null {
  let cursor = statementStart;

  while (cursor < source.length) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (source[cursor] === ";") return null;

    if (
      source.startsWith("from", cursor) &&
      !isIdentifierPartAt(source, cursor - 1) &&
      !isIdentifierPartAt(source, cursor + 4)
    ) {
      const quoteIndex = skipWhitespaceAndComments(source, cursor + 4);
      const quoted = readQuotedSpecifier(source, quoteIndex);
      if (!quoted) {
        cursor++;
        continue;
      }

      const matchedPath = matcher(quoted.specifier);
      if (!matchedPath) return null;

      return {
        original: source.slice(cursor, quoted.end),
        path: matchedPath,
        start: cursor,
        end: quoted.end,
      };
    }

    cursor++;
  }

  return null;
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
  if (!Number.isSafeInteger(maxMatches) || maxMatches <= 0) {
    throw new RangeError("maxMatches must be a positive safe integer");
  }
}

export function findStaticImportFromSpans(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
): StaticImportSpan[] {
  assertMaxMatches(maxMatches);

  const spans: StaticImportSpan[] = [];
  let cursor = 0;
  let atStatementStart = true;
  const openBraces: OpenBraceContext[] = [];
  const matchingOpenBraces = new Map<number, OpenBraceContext>();
  const openParens: OpenParenContext[] = [];
  const matchingOpenParens = new Map<number, OpenParenContext>();
  let previousTokenIndex = -1;

  while (cursor < source.length) {
    const char = source[cursor];
    const skipped = skipExpressionIgnored(
      source,
      cursor,
      0,
      0,
      matchingOpenBraces,
      matchingOpenParens,
      openParens.at(-1),
      previousTokenIndex,
    );
    if (skipped !== cursor) {
      if (char === "/" && source[cursor + 1] === "/") atStatementStart = true;
      else if (char === "/" && source[cursor + 1] === "*") {
        if (hasLineTerminatorBetween(source, cursor + 2, skipped - 2)) atStatementStart = true;
      } else atStatementStart = false;
      previousTokenIndex = tokenIndexAfterIgnored(
        source,
        cursor,
        skipped,
        previousTokenIndex,
      );
      cursor = skipped;
      continue;
    }

    if (char === "{") {
      openBraces.push(
        openBraceContext(
          source,
          0,
          cursor,
          previousTokenIndex,
          matchingOpenParens,
          openParens.at(-1),
          openBraces.at(-1),
        ),
      );
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === "}") {
      const openBrace = openBraces.pop();
      if (openBrace !== undefined) matchingOpenBraces.set(cursor, openBrace);
      atStatementStart = true;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === "(") {
      openParens.push(openParenContext(source, cursor, previousTokenIndex));
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === ")") {
      const openParen = openParens.pop();
      if (openParen !== undefined) matchingOpenParens.set(cursor, openParen);
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === ";" && openParens.at(-1)?.isForHeader) {
      openParens.at(-1)!.hasSemicolon = true;
    }
    if (char === ";" || (char !== undefined && isLineTerminator(char))) {
      atStatementStart = true;
      if (char === ";") previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (/\s/.test(char ?? "")) {
      cursor++;
      continue;
    }

    const isImport = isStatementKeywordAt(source, cursor, "import", atStatementStart);
    const isExport = isStatementKeywordAt(source, cursor, "export", atStatementStart);
    if (!isImport && !isExport) {
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    const keywordLength = isImport ? "import".length : "export".length;
    const afterKeyword = skipWhitespaceAndComments(source, cursor + keywordLength);
    if (isImport && source[afterKeyword] === "(") {
      atStatementStart = false;
      openParens.push({
        index: afterKeyword,
        isControlCondition: false,
        isForHeader: false,
        hasSemicolon: false,
      });
      previousTokenIndex = afterKeyword;
      cursor = afterKeyword + 1;
      continue;
    }

    const span = findFromSpan(source, afterKeyword, matcher);
    if (span) {
      spans.push(span);
      if (spans.length >= maxMatches) return spans;
      atStatementStart = false;
      previousTokenIndex = span.end - 1;
      cursor = span.end;
      continue;
    }

    atStatementStart = true;
    cursor = nextStatementCursor(source, afterKeyword);
    previousTokenIndex = Math.max(previousTokenIndex, cursor - 1);
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

function scanDynamicImportRange(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  matcher: SpecifierMatcher,
  maxMatches: number,
  spans: StaticImportSpan[],
): void {
  let cursor = rangeStart;
  const openBraces: OpenBraceContext[] = [];
  const matchingOpenBraces = new Map<number, OpenBraceContext>();
  const openParens: OpenParenContext[] = [];
  const matchingOpenParens = new Map<number, OpenParenContext>();
  let previousTokenIndex = rangeStart - 1;

  while (cursor < rangeEnd) {
    const char = source[cursor];
    const next = source[cursor + 1];

    const jsxTag = readRawJsxTag(source, cursor);
    if (jsxTag !== null) {
      for (const range of jsxTag.expressionRanges) {
        scanDynamicImportRange(source, range.start, range.end, matcher, maxMatches, spans);
        if (spans.length >= maxMatches) return;
      }
      previousTokenIndex = jsxTag.end - 1;
      cursor = jsxTag.end;
      continue;
    }

    if (
      (char === "/" && (next === "/" || next === "*")) ||
      char === '"' ||
      char === "'"
    ) {
      const skipped = skipIgnored(source, cursor);
      previousTokenIndex = tokenIndexAfterIgnored(
        source,
        cursor,
        skipped,
        previousTokenIndex,
      );
      cursor = skipped;
      continue;
    }

    if (
      char === "/" &&
      canStartRegexLiteral(
        source,
        cursor,
        rangeStart,
        matchingOpenBraces,
        matchingOpenParens,
        openParens.at(-1),
        previousTokenIndex,
      )
    ) {
      cursor = skipRegexLiteral(source, cursor);
      previousTokenIndex = cursor - 1;
      continue;
    }

    if (char === "`") {
      cursor = scanTemplateExpressionDynamicImports(
        source,
        cursor,
        rangeEnd,
        matcher,
        maxMatches,
        spans,
      );
      if (spans.length >= maxMatches) return;
      previousTokenIndex = cursor - 1;
      continue;
    }

    if (char === "{") {
      openBraces.push(
        openBraceContext(
          source,
          rangeStart,
          cursor,
          previousTokenIndex,
          matchingOpenParens,
          openParens.at(-1),
          openBraces.at(-1),
        ),
      );
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (char === "}") {
      const openBrace = openBraces.pop();
      if (openBrace !== undefined) matchingOpenBraces.set(cursor, openBrace);
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (char === "(") {
      openParens.push(openParenContext(source, cursor, previousTokenIndex));
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (char === ")") {
      const openParen = openParens.pop();
      if (openParen !== undefined) matchingOpenParens.set(cursor, openParen);
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    if (char === ";" && openParens.at(-1)?.isForHeader) {
      openParens.at(-1)!.hasSemicolon = true;
    }

    if (/\s/.test(char ?? "")) {
      cursor++;
      continue;
    }

    // `import` used as an expression: not preceded by an identifier char or a
    // dot (which would make it `foo.import` or part of a longer word).
    if (
      !source.startsWith("import", cursor) ||
      isIdentifierBoundaryBefore(source, cursor) ||
      isPropertyAccessBeforeImport(source, previousTokenIndex, rangeStart) ||
      isIdentifierBoundaryAfter(source, cursor + "import".length)
    ) {
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    const parenIndex = skipWhitespaceAndComments(source, cursor + "import".length);
    if (parenIndex >= rangeEnd || source[parenIndex] !== "(") {
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    // The scanner jumps directly from `import` to its argument, so record the
    // opening parenthesis that the ordinary character walk does not visit.
    openParens.push({
      index: parenIndex,
      isControlCondition: false,
      isForHeader: false,
      hasSemicolon: false,
    });

    const literalIndex = skipWhitespaceAndComments(source, parenIndex + 1);
    if (literalIndex >= rangeEnd) {
      previousTokenIndex = parenIndex;
      cursor = parenIndex + 1;
      continue;
    }

    const literal = readLiteralSpecifier(source, literalIndex);
    if (!literal || literal.end > rangeEnd) {
      previousTokenIndex = parenIndex;
      cursor = parenIndex + 1;
      continue;
    }

    // The literal must be the whole first argument. `)` closes the call and `,`
    // starts the import-attributes argument; anything else (`+`, a template
    // continuation, a ternary) means the runtime specifier is not this string.
    const afterSpecifier = skipWhitespaceAndComments(source, literal.end);
    const isWholeArgument = afterSpecifier < rangeEnd &&
      (source[afterSpecifier] === ")" || source[afterSpecifier] === ",");

    const matchedPath = isWholeArgument ? matcher(literal.specifier) : null;
    if (matchedPath) {
      spans.push({
        original: source.slice(literalIndex, literal.end),
        path: matchedPath,
        start: literalIndex,
        end: literal.end,
      });
      if (spans.length >= maxMatches) return;
    }

    previousTokenIndex = literal.end - 1;
    cursor = literal.end;
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
  let cursor = 0;
  let atStatementStart = true;
  const openBraces: OpenBraceContext[] = [];
  const matchingOpenBraces = new Map<number, OpenBraceContext>();
  const openParens: OpenParenContext[] = [];
  const matchingOpenParens = new Map<number, OpenParenContext>();
  let previousTokenIndex = -1;

  while (cursor < source.length) {
    const char = source[cursor];
    const skipped = skipExpressionIgnored(
      source,
      cursor,
      0,
      0,
      matchingOpenBraces,
      matchingOpenParens,
      openParens.at(-1),
      previousTokenIndex,
    );
    if (skipped !== cursor) {
      if (char === "/" && source[cursor + 1] === "/") atStatementStart = true;
      else if (char === "/" && source[cursor + 1] === "*") {
        if (hasLineTerminatorBetween(source, cursor + 2, skipped - 2)) atStatementStart = true;
      } else atStatementStart = false;
      previousTokenIndex = tokenIndexAfterIgnored(
        source,
        cursor,
        skipped,
        previousTokenIndex,
      );
      cursor = skipped;
      continue;
    }

    if (char === "{") {
      openBraces.push(
        openBraceContext(
          source,
          0,
          cursor,
          previousTokenIndex,
          matchingOpenParens,
          openParens.at(-1),
          openBraces.at(-1),
        ),
      );
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === "}") {
      const openBrace = openBraces.pop();
      if (openBrace !== undefined) matchingOpenBraces.set(cursor, openBrace);
      atStatementStart = true;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === "(") {
      openParens.push(openParenContext(source, cursor, previousTokenIndex));
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === ")") {
      const openParen = openParens.pop();
      if (openParen !== undefined) matchingOpenParens.set(cursor, openParen);
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === ";" && openParens.at(-1)?.isForHeader) {
      openParens.at(-1)!.hasSemicolon = true;
    }
    if (char === ";" || (char !== undefined && isLineTerminator(char))) {
      atStatementStart = true;
      if (char === ";") previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (/\s/.test(char ?? "")) {
      cursor++;
      continue;
    }

    if (!isStatementKeywordAt(source, cursor, "import", atStatementStart)) {
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }

    const literalIndex = skipWhitespaceAndComments(source, cursor + "import".length);
    const literal = readLiteralSpecifier(source, literalIndex);
    if (!literal) {
      atStatementStart = true;
      cursor = nextStatementCursor(source, literalIndex);
      previousTokenIndex = Math.max(previousTokenIndex, cursor - 1);
      continue;
    }

    const matchedPath = matcher(literal.specifier);
    if (matchedPath) {
      spans.push({
        original: source.slice(cursor, literal.end),
        path: matchedPath,
        start: cursor,
        end: literal.end,
      });
      if (spans.length >= maxMatches) return spans;
    }

    atStatementStart = false;
    previousTokenIndex = literal.end - 1;
    cursor = literal.end;
  }

  return spans;
}
