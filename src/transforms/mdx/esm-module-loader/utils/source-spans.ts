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
}

const MAX_TEMPLATE_LITERAL_DEPTH = 512;
const StringFromCodePoint = String.fromCodePoint;
const IDENTIFIER_PART_PATTERN = /^[$_\p{ID_Continue}\u200C\u200D]$/u;
const IDENTIFIER_ESCAPE_SOURCE = String.raw`\\u(?:[0-9A-Fa-f]{4}|\{[0-9A-Fa-f]+\})`;
const IDENTIFIER_NAME_SOURCE = String
  .raw`(?:[$_\p{ID_Start}]|${IDENTIFIER_ESCAPE_SOURCE})(?:[$\p{ID_Continue}\u200C\u200D]|${IDENTIFIER_ESCAPE_SOURCE})*`;
const FUNCTION_DECLARATION_BLOCK_PREFIX_PATTERN = new RegExp(
  String
    .raw`^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?(?:\s+${IDENTIFIER_NAME_SOURCE})?\s*\(`,
  "u",
);
const CLASS_DECLARATION_BLOCK_PREFIX_PATTERN = new RegExp(
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
  if (isIdentifierPartAt(source, index - 1) || source[index - 1] === ".") return false;
  if (isIdentifierPartAt(source, index + keyword.length)) return false;
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

function isSideEffectImportTerminated(source: string, index: number): boolean {
  let cursor = index;

  while (cursor < source.length) {
    const char = source[cursor]!;
    if (isLineTerminator(char)) return true;
    if (char === " " || char === "\t" || char === "\f") {
      cursor++;
      continue;
    }
    if (char === ";") return true;
    if (char === "/" && source[cursor + 1] === "/") return true;
    if (char === "/" && source[cursor + 1] === "*") {
      const commentEnd = skipIgnored(source, cursor);
      if (containsLineTerminator(source, cursor, commentEnd)) return true;
      cursor = commentEnd;
      continue;
    }
    // Import attributes are part of the same declaration and follow the
    // specifier before its terminator.
    return source.startsWith("with", cursor) || source.startsWith("assert", cursor);
  }

  return true;
}

interface JsxTagEnd {
  end: number;
  name: string;
  selfClosing: boolean;
}

type JsxClosingTagIndex = ReadonlyMap<string, readonly number[]>;

function jsxTagNameCharacterLength(source: string, index: number): number {
  const character = identifierCharacterAt(source, index);
  if (character !== undefined && isIdentifierChar(character)) return character.length;
  return ".:-".includes(source[index] ?? "") ? 1 : 0;
}

function skipJsxTag(source: string, index: number): JsxTagEnd | null {
  let nameStart = index + 1;
  if (source[nameStart] === "/") nameStart++;
  let nameEnd = nameStart;
  for (let length = jsxTagNameCharacterLength(source, nameEnd); length > 0;) {
    nameEnd += length;
    length = jsxTagNameCharacterLength(source, nameEnd);
  }

  let cursor = index + 1;
  let expressionDepth = 0;

  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === '"' || char === "'") {
      cursor = skipIgnored(source, cursor);
      continue;
    }
    if (char === "`") {
      cursor = skipFullTemplateLiteral(source, cursor);
      continue;
    }
    if (char === "{") {
      expressionDepth++;
      cursor++;
      continue;
    }
    if (char === "}" && expressionDepth > 0) {
      expressionDepth--;
      cursor++;
      continue;
    }
    if (char === ">" && expressionDepth === 0) {
      const before = previousSignificantIndex(source, cursor);
      return {
        end: cursor + 1,
        name: source.slice(nameStart, nameEnd),
        selfClosing: source[before] === "/",
      };
    }
    cursor++;
  }

  return null;
}

function hasClosingJsxTag(
  index: number,
  name: string,
  closingTags: JsxClosingTagIndex,
): boolean {
  const positions = closingTags.get(name);
  if (positions === undefined) return false;

  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (positions[middle]! < index) low = middle + 1;
    else high = middle;
  }

  return low < positions.length;
}

function indexClosingJsxTags(source: string): JsxClosingTagIndex {
  const tags = new Map<string, number[]>();

  for (let cursor = 0; cursor < source.length;) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (source[cursor] === "<" && source[cursor + 1] === "/") {
      const tag = skipJsxTag(source, cursor);
      if (tag !== null) {
        if (tag.name !== "" && isRegexClosingTagLookalike(source, cursor)) {
          cursor = skipRegexLiteral(source, cursor + 1);
          continue;
        }
        const positions = tags.get(tag.name);
        if (positions === undefined) tags.set(tag.name, [cursor]);
        else positions.push(cursor);
        cursor = tag.end;
        continue;
      }

      if (source.startsWith("</>", cursor)) {
        const positions = tags.get("");
        if (positions === undefined) tags.set("", [cursor]);
        else positions.push(cursor);
        cursor += "</>".length;
        continue;
      }

      const nameStart = cursor + 2;
      let nameEnd = nameStart;
      for (let length = jsxTagNameCharacterLength(source, nameEnd); length > 0;) {
        nameEnd += length;
        length = jsxTagNameCharacterLength(source, nameEnd);
      }
      const name = source.slice(nameStart, nameEnd);
      if (name !== "" && /[\s>]/.test(source[nameEnd] ?? "")) {
        if (isRegexClosingTagLookalike(source, cursor)) {
          cursor = skipRegexLiteral(source, cursor + 1);
          continue;
        }
        const positions = tags.get(name);
        if (positions === undefined) tags.set(name, [cursor]);
        else positions.push(cursor);
        cursor = nameEnd;
        continue;
      }

      if (isRegexClosingTagLookalike(source, cursor)) {
        cursor = skipRegexLiteral(source, cursor + 1);
        continue;
      }
    }
    cursor++;
  }

  return tags;
}

function isRegexClosingTagLookalike(source: string, index: number): boolean {
  const regexStart = index + 1;
  const regexEnd = skipRegexLiteral(source, regexStart);
  let closingSlash = regexEnd - 1;
  while (/[A-Za-z]/.test(source[closingSlash] ?? "")) closingSlash--;

  if (closingSlash <= regexStart || source[closingSlash] !== "/") return false;
  if (containsLineTerminator(source, regexStart, closingSlash)) return false;

  const flags = source.slice(closingSlash + 1, regexEnd);
  const uniqueFlags = new Set(flags);
  if (
    uniqueFlags.size !== flags.length ||
    [...uniqueFlags].some((flag) => !"dgimsuvy".includes(flag)) ||
    (uniqueFlags.has("u") && uniqueFlags.has("v"))
  ) return false;

  const afterRegex = skipWhitespaceAndComments(source, regexEnd);
  const next = source[afterRegex];
  return next === undefined || ".([?;,)]}:+-*/%<>=!&|^~".includes(next) ||
    (source.startsWith("in", afterRegex) && !isIdentifierPartAt(source, afterRegex + 2)) ||
    (source.startsWith("instanceof", afterRegex) &&
      !isIdentifierPartAt(source, afterRegex + "instanceof".length));
}

function canStartJsxElement(
  source: string,
  index: number,
  previousTokenIndex: number,
): boolean {
  const next = source[index + 1];
  if (next !== ">" && jsxTagNameCharacterLength(source, index + 1) === 0) return false;
  if (previousTokenIndex < 0) return true;

  const previous = source[previousTokenIndex]!;
  if ("([{=,:;!?&|+-*%^<>".includes(previous)) return true;

  const keyword = keywordBefore(source, index, previousTokenIndex);
  return keyword === "case" || keyword === "default" || keyword === "return" ||
    keyword === "yield";
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

function containsLineTerminator(source: string, start: number, end: number): boolean {
  for (let cursor = start; cursor < end; cursor++) {
    if (isLineTerminator(source[cursor]!)) return true;
  }
  return false;
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

function previousSignificantIndexAcrossComments(source: string, index: number): number {
  let scanEnd = index;
  let cursor = previousSignificantIndex(source, index);

  while (cursor >= 0) {
    if (cursor >= 1 && source[cursor] === "/" && source[cursor - 1] === "*") {
      const commentStart = source.lastIndexOf("/*", cursor - 1);
      if (commentStart < 0) break;
      scanEnd = commentStart;
      cursor = previousSignificantIndex(source, commentStart);
      continue;
    }

    if (!containsLineTerminator(source, cursor + 1, scanEnd)) break;
    const commentStart = lineCommentStart(source, cursor);
    if (commentStart === null) break;
    scanEnd = commentStart;
    cursor = previousSignificantIndex(source, commentStart);
  }

  return cursor;
}

function lineCommentStart(source: string, index: number): number | null {
  let cursor = index;
  while (cursor > 0 && !isLineTerminator(source[cursor - 1] ?? "")) cursor--;

  let quote: string | null = null;
  for (; cursor <= index; cursor++) {
    const char = source[cursor]!;
    if (quote !== null) {
      if (char === "\\") cursor++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") return cursor;
  }

  return null;
}

function keywordBefore(
  source: string,
  index: number,
  previousTokenIndex = previousSignificantIndex(source, index),
): string | null {
  const end = previousTokenIndex + 1;
  let start = end;
  while (start > 0 && /[A-Za-z_$]/.test(source[start - 1] ?? "")) start--;
  if (start === end) return null;
  return source.slice(start, end);
}

/** Whether the word before a slash is a member name rather than a keyword. */
export function isMemberNameBefore(
  source: string,
  previousTokenIndex: number,
): boolean {
  const end = previousTokenIndex + 1;
  let start = end;
  while (start > 0 && /[A-Za-z_$]/.test(source[start - 1] ?? "")) start--;
  if (start === end) return false;

  const before = previousSignificantIndexAcrossComments(source, start);
  if (before < 0) return false;

  const char = source[before];
  if (char === "#") return true;
  if (char !== ".") return false;

  return source[before - 1] !== "." || source[before - 2] !== ".";
}

/**
 * Whether `index` sits inside a `//` line comment.
 *
 * Only line comments need this, and the asymmetry is structural. A block
 * comment cannot leak into the for-await check: its `*` + `/` terminator stops
 * `skipWhitespaceAndComments`, so a `for` written inside one never reads as
 * adjacent to a later `await`. A line comment ends at a newline, which that
 * same scan treats as ordinary whitespace and walks straight through, so the
 * commented word is read as code.
 *
 * Lexing only the current line is both sufficient and bounded: a line comment
 * cannot have started on an earlier line. The quote tracking matters because a
 * `//` inside a string on the same line (a URL, say) is not a comment start,
 * and treating it as one would fail to recognise a real `for await` header.
 */
function isInsideLineComment(source: string, index: number): boolean {
  let cursor = index;
  while (cursor > 0 && !isLineTerminator(source[cursor - 1] ?? "")) cursor--;

  let quote: string | null = null;
  for (; cursor < index; cursor++) {
    const char = source[cursor]!;
    if (quote !== null) {
      if (char === "\\") cursor++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") return true;
  }

  return false;
}

function isForAwaitHeader(
  source: string,
  previousTokenIndex: number,
): boolean {
  const awaitStart = previousTokenIndex - "await".length + 1;
  let forStart = source.lastIndexOf("for", awaitStart - 1);

  while (forStart >= 0) {
    const isStandaloneKeyword = !isIdentifierPartAt(source, forStart - 1) &&
      source[forStart - 1] !== "." &&
      !isIdentifierPartAt(source, forStart + "for".length);
    if (
      isStandaloneKeyword &&
      // The search runs over raw text, so it also finds a `for` that is not
      // code. Everything but a line comment is already excluded by the
      // adjacency check below (see `isInsideLineComment`).
      !isInsideLineComment(source, forStart) &&
      skipWhitespaceAndComments(source, forStart + "for".length) === awaitStart
    ) return true;

    forStart = source.lastIndexOf("for", forStart - 1);
  }

  return false;
}

function openParenContext(
  source: string,
  index: number,
  previousTokenIndex: number,
): OpenParenContext {
  const keyword = keywordBefore(source, index, previousTokenIndex);
  const isForHeader = keyword === "for" ||
    (keyword === "await" && isForAwaitHeader(source, previousTokenIndex));
  return {
    index,
    isControlCondition: keyword === "if" || keyword === "while" || isForHeader ||
      keyword === "with" || keyword === "switch" || keyword === "catch",
    isForHeader,
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

function isDeclarationBlockCloseBrace(
  source: string,
  index: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = matchingOpenBraces.get(index);
  if (openBrace === undefined) return false;

  let declarationStart = 0;
  for (let cursor = openBrace.index - 1; cursor >= 0; cursor--) {
    if (source[cursor] === "}") {
      const nestedBrace = matchingOpenBraces.get(cursor);
      if (nestedBrace !== undefined) {
        cursor = nestedBrace.index;
        continue;
      }
    }
    if (source[cursor] === ";" || source[cursor] === "{" || source[cursor] === "}") {
      declarationStart = cursor + 1;
      break;
    }
  }
  const prefix = source.slice(declarationStart, openBrace.index).trimStart().replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g,
    " ",
  );
  return FUNCTION_DECLARATION_BLOCK_PREFIX_PATTERN.test(prefix) ||
    CLASS_DECLARATION_BLOCK_PREFIX_PATTERN.test(prefix);
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
  source: string,
  index: number,
  rangeStart: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = matchingOpenBraces.get(index);
  if (openBrace === undefined) return false;

  const beforeOpenBrace = openBrace.previousTokenIndex;
  if (beforeOpenBrace < rangeStart) return true;
  if (source[beforeOpenBrace] === ";" || source[beforeOpenBrace] === "}") return true;
  if (source[beforeOpenBrace] !== ":") return false;

  const labelEnd = previousSignificantIndex(source, beforeOpenBrace) + 1;
  let labelStart = labelEnd;
  while (labelStart > rangeStart && isIdentifierChar(source[labelStart - 1])) labelStart--;
  if (labelStart === labelEnd || !/[$A-Za-z_]/.test(source[labelStart] ?? "")) return false;

  const beforeLabel = previousSignificantIndex(source, labelStart);
  return beforeLabel < rangeStart || source[beforeLabel] === ";" || source[beforeLabel] === "}";
}

function isArrowFunctionBodyCloseBraceAtAsiBoundary(
  source: string,
  index: number,
  nextTokenIndex: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = matchingOpenBraces.get(index);
  if (openBrace === undefined || source[openBrace.previousTokenIndex] !== ">") return false;

  const beforeArrow = previousSignificantIndex(source, openBrace.previousTokenIndex);
  if (source[beforeArrow] !== "=") return false;

  return hasLineTerminator(source, index + 1, nextTokenIndex);
}

function hasLineTerminator(source: string, start: number, end: number): boolean {
  for (let cursor = start; cursor < end; cursor++) {
    if (isLineTerminator(source[cursor]!)) return true;
  }
  return false;
}

function isExportListCloseBraceAtAsiBoundary(
  source: string,
  index: number,
  nextTokenIndex: number,
  matchingOpenBraces: ReadonlyMap<number, OpenBraceContext>,
): boolean {
  const openBrace = matchingOpenBraces.get(index);
  if (
    openBrace === undefined ||
    keywordBefore(source, openBrace.index, openBrace.previousTokenIndex) !== "export"
  ) return false;

  return hasLineTerminator(source, index + 1, nextTokenIndex);
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
      isDeclarationBlockCloseBrace(source, previous, matchingOpenBraces) ||
      isStatementBlockCloseBrace(source, previous, matchingOpenBraces) ||
      isPlainStatementBlockCloseBrace(source, previous, rangeStart, matchingOpenBraces) ||
      isArrowFunctionBodyCloseBraceAtAsiBoundary(
        source,
        previous,
        index,
        matchingOpenBraces,
      ) ||
      isExportListCloseBraceAtAsiBoundary(
        source,
        previous,
        index,
        matchingOpenBraces,
      ))
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
  if (keyword !== null && isMemberNameBefore(source, previous)) return false;
  if (keyword === "of") {
    return isForOfKeywordBefore(source, rangeStart, currentParen, previous);
  }

  return [
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
      openBraces.push({ index: cursor, previousTokenIndex });
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

function canExportHaveFromClause(source: string, statementStart: number): boolean {
  let cursor = skipWhitespaceAndComments(source, statementStart);
  if (
    source.startsWith("type", cursor) &&
    !isIdentifierPartAt(source, cursor - 1) &&
    !isIdentifierPartAt(source, cursor + "type".length)
  ) {
    cursor = skipWhitespaceAndComments(source, cursor + "type".length);
  }

  return source[cursor] === "*" || source[cursor] === "{";
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

type StaticStatementScanContext = {
  cursor: number;
  isImport: boolean;
  isExport: boolean;
  afterKeyword: number;
  keywordLength: number;
  openParens: OpenParenContext[];
};

type StaticStatementScanAction = {
  cursor: number;
  atStatementStart: boolean;
  previousTokenIndex: number;
  done?: boolean;
};

function scanStaticStatementKeywords(
  source: string,
  onStatementKeyword: (context: StaticStatementScanContext) => StaticStatementScanAction,
): void {
  let cursor = 0;
  let atStatementStart = true;
  const openBraces: OpenBraceContext[] = [];
  const matchingOpenBraces = new Map<number, OpenBraceContext>();
  const openParens: OpenParenContext[] = [];
  const matchingOpenParens = new Map<number, OpenParenContext>();
  let previousTokenIndex = -1;
  let jsxDepth = 0;
  let inJsxText = false;
  const jsxExpressionStack: Array<{ braceDepth: number; parentDepth: number }> = [];
  const jsxClosingTags = indexClosingJsxTags(source);

  while (cursor < source.length) {
    const char = source[cursor];

    if (inJsxText) {
      if (char === "<") {
        const tag = skipJsxTag(source, cursor);
        if (tag !== null) {
          const closing = source[cursor + 1] === "/";
          if (closing) jsxDepth = Math.max(0, jsxDepth - 1);
          else if (!tag.selfClosing) jsxDepth++;
          const expressionParentDepth = jsxExpressionStack.at(-1)?.parentDepth ?? 0;
          inJsxText = jsxDepth > expressionParentDepth;
          atStatementStart = false;
          previousTokenIndex = tag.end - 1;
          cursor = tag.end;
          continue;
        }
      }
      if (char === "{") {
        jsxExpressionStack.push({ braceDepth: 0, parentDepth: jsxDepth });
        inJsxText = false;
      } else {
        cursor++;
        continue;
      }
    } else if (char === "<" && canStartJsxElement(source, cursor, previousTokenIndex)) {
      const tag = skipJsxTag(source, cursor);
      if (
        tag !== null &&
        (tag.selfClosing || hasClosingJsxTag(tag.end, tag.name, jsxClosingTags))
      ) {
        if (!tag.selfClosing) {
          jsxDepth++;
          inJsxText = true;
        }
        atStatementStart = false;
        previousTokenIndex = tag.end - 1;
        cursor = tag.end;
        continue;
      }
    }

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
        atStatementStart = atStatementStart || containsLineTerminator(source, cursor, skipped);
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
      const expression = jsxExpressionStack.at(-1);
      if (expression !== undefined) expression.braceDepth++;
      openBraces.push({ index: cursor, previousTokenIndex });
      atStatementStart = false;
      previousTokenIndex = cursor;
      cursor++;
      continue;
    }
    if (char === "}") {
      const expression = jsxExpressionStack.at(-1);
      if (expression !== undefined) {
        expression.braceDepth--;
        if (expression.braceDepth === 0) {
          jsxExpressionStack.pop();
          inJsxText = jsxDepth > 0;
        }
      }
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
    const action = onStatementKeyword({
      cursor,
      isImport,
      isExport,
      afterKeyword,
      keywordLength,
      openParens,
    });
    cursor = action.cursor;
    atStatementStart = action.atStatementStart;
    previousTokenIndex = action.previousTokenIndex;
    if (action.done) return;
  }
}

export function findStaticImportFromSpans(
  source: string,
  matcher: SpecifierMatcher,
  maxMatches: number,
): StaticImportSpan[] {
  assertMaxMatches(maxMatches);

  const spans: StaticImportSpan[] = [];
  scanStaticStatementKeywords(source, ({
    cursor,
    isImport,
    isExport,
    afterKeyword,
    keywordLength,
    openParens,
  }) => {
    if (isImport && source[afterKeyword] === "(") {
      openParens.push({
        index: afterKeyword,
        isControlCondition: false,
        isForHeader: false,
        hasSemicolon: false,
      });
      return {
        cursor: afterKeyword + 1,
        atStatementStart: false,
        previousTokenIndex: afterKeyword,
      };
    }

    if (isExport && !canExportHaveFromClause(source, afterKeyword)) {
      return {
        cursor: afterKeyword,
        atStatementStart: false,
        previousTokenIndex: cursor + keywordLength - 1,
      };
    }

    const span = findFromSpan(source, afterKeyword, matcher);
    if (span) {
      spans.push(span);
      return {
        cursor: span.end,
        atStatementStart: false,
        previousTokenIndex: span.end - 1,
        done: spans.length >= maxMatches,
      };
    }

    const nextCursor = nextStatementCursor(source, afterKeyword);
    return {
      cursor: nextCursor,
      atStatementStart: true,
      previousTokenIndex: Math.max(cursor + keywordLength - 1, nextCursor - 1),
    };
  });

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
      openBraces.push({ index: cursor, previousTokenIndex });
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
      isIdentifierPartAt(source, cursor - 1) ||
      isPropertyAccessBeforeImport(source, previousTokenIndex, rangeStart) ||
      isIdentifierPartAt(source, cursor + "import".length)
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
  scanStaticStatementKeywords(source, ({ cursor, isImport }) => {
    if (!isImport) {
      return {
        cursor: cursor + 1,
        atStatementStart: false,
        previousTokenIndex: cursor,
      };
    }

    const literalIndex = skipWhitespaceAndComments(source, cursor + "import".length);
    const literal = readLiteralSpecifier(source, literalIndex);
    if (!literal) {
      const nextCursor = nextStatementCursor(source, literalIndex);
      return {
        cursor: nextCursor,
        atStatementStart: true,
        previousTokenIndex: Math.max(cursor + "import".length - 1, nextCursor - 1),
      };
    }

    if (!isSideEffectImportTerminated(source, literal.end)) {
      return {
        cursor: literal.end,
        atStatementStart: false,
        previousTokenIndex: literal.end - 1,
      };
    }

    const matchedPath = matcher(literal.specifier);
    if (matchedPath) {
      spans.push({
        original: source.slice(cursor, literal.end),
        path: matchedPath,
        start: cursor,
        end: literal.end,
      });
    }

    return {
      cursor: literal.end,
      atStatementStart: false,
      previousTokenIndex: literal.end - 1,
      done: spans.length >= maxMatches,
    };
  });

  return spans;
}
