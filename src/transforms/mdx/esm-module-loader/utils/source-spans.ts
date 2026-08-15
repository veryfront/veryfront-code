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

const MAX_TEMPLATE_LITERAL_DEPTH = 512;

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
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function isStatementKeywordAt(
  source: string,
  index: number,
  keyword: "import" | "export",
): boolean {
  if (!source.startsWith(keyword, index)) return false;
  if (isIdentifierChar(source[index - 1]) || source[index - 1] === ".") return false;
  if (isIdentifierChar(source[index + keyword.length])) return false;

  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  return /^[\t ]*$/.test(source.slice(lineStart, index));
}

function skipIgnored(source: string, index: number): number {
  const char = source[index];
  const next = source[index + 1];

  if (char === "/" && next === "/") {
    const newline = source.indexOf("\n", index + 2);
    return newline === -1 ? source.length : newline + 1;
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
  const semicolon = source.indexOf(";", index);
  const newline = source.indexOf("\n", index);
  const candidates = [semicolon, newline].filter((position) => position >= 0);
  if (candidates.length === 0) return source.length;
  return Math.min(...candidates) + 1;
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
      return {
        end: cursor + 1,
        specifier: source.slice(quoteIndex + 1, cursor),
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
      return {
        end: cursor + 1,
        specifier: source.slice(literalIndex + 1, cursor),
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

function keywordBefore(source: string, index: number): string | null {
  const end = previousSignificantIndex(source, index) + 1;
  let start = end;
  while (start > 0 && /[A-Za-z_$]/.test(source[start - 1] ?? "")) start--;
  if (start === end) return null;
  return source.slice(start, end);
}

function isControlConditionCloseParen(source: string, index: number, rangeStart: number): boolean {
  let depth = 1;
  let cursor = index - 1;

  while (cursor >= rangeStart) {
    const char = source[cursor];

    if (char === '"' || char === "'" || char === "`") {
      cursor = previousStringLiteralStart(source, cursor, rangeStart) - 1;
      continue;
    }

    if (char === "/" && source[cursor - 1] === "*") {
      const commentStart = source.lastIndexOf("/*", cursor - 2);
      cursor = commentStart >= rangeStart ? commentStart - 1 : rangeStart - 1;
      continue;
    }

    if (char === ")") {
      depth++;
      cursor--;
      continue;
    }

    if (char === "(") {
      depth--;
      if (depth === 0) {
        const keyword = keywordBefore(source, cursor);
        return keyword === "if" || keyword === "while" || keyword === "for" ||
          keyword === "with" || keyword === "switch";
      }
      cursor--;
      continue;
    }

    cursor--;
  }

  return false;
}

function previousStringLiteralStart(source: string, index: number, rangeStart: number): number {
  const quote = source[index];
  let cursor = index - 1;

  while (cursor >= rangeStart) {
    if (source[cursor] === quote && !isEscapedByBackslash(source, cursor)) return cursor;
    cursor--;
  }

  return rangeStart;
}

function isEscapedByBackslash(source: string, index: number): boolean {
  let cursor = index - 1;
  let count = 0;
  while (cursor >= 0 && source[cursor] === "\\") {
    count++;
    cursor--;
  }
  return count % 2 === 1;
}

function canStartRegexLiteralInBraceScan(
  source: string,
  index: number,
  rangeStart: number,
): boolean {
  const previous = previousSignificantIndex(source, index);
  if (previous < rangeStart) return true;

  const char = source[previous];
  if (char === ")" && isControlConditionCloseParen(source, previous, rangeStart)) return true;
  if (
    (char === "+" || char === "-") &&
    previous - 1 >= rangeStart &&
    source[previous - 1] === char
  ) {
    return false;
  }
  if (char !== undefined && "([{=,:;!~?&|+-*%^<>".includes(char)) return true;

  return [
    "case",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "of",
    "await",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
  ].includes(keywordBefore(source, index) ?? "");
}

function skipBraceScanIgnored(source: string, index: number, rangeStart: number): number {
  const char = source[index];
  const next = source[index + 1];

  if (
    (char === "/" && (next === "/" || next === "*")) ||
    char === '"' ||
    char === "'" ||
    char === "`"
  ) {
    return skipIgnored(source, index);
  }

  if (char === "/" && canStartRegexLiteralInBraceScan(source, index, rangeStart)) {
    return skipRegexLiteral(source, index);
  }

  return index;
}

function matchingOpenBraceIndex(source: string, index: number, rangeStart: number): number | null {
  const openBraces: number[] = [];
  let cursor = rangeStart;

  while (cursor <= index) {
    const skipped = skipBraceScanIgnored(source, cursor, rangeStart);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (source[cursor] === "{") {
      openBraces.push(cursor);
      cursor++;
      continue;
    }

    if (source[cursor] === "}") {
      const openBrace = openBraces.pop();
      if (cursor === index) return openBrace ?? null;
      cursor++;
      continue;
    }

    cursor++;
  }

  return null;
}

function isControlBlockCloseBrace(source: string, index: number, rangeStart: number): boolean {
  const openBrace = matchingOpenBraceIndex(source, index, rangeStart);
  if (openBrace === null) return false;

  const beforeOpenBrace = previousSignificantIndex(source, openBrace);
  return beforeOpenBrace >= rangeStart &&
    source[beforeOpenBrace] === ")" &&
    isControlConditionCloseParen(source, beforeOpenBrace, rangeStart);
}

function canStartRegexLiteral(source: string, index: number, rangeStart: number): boolean {
  const previous = previousSignificantIndex(source, index);
  if (previous < rangeStart) return true;

  const char = source[previous];
  if (char === ")" && isControlConditionCloseParen(source, previous, rangeStart)) return true;
  if (char === "}" && isControlBlockCloseBrace(source, previous, rangeStart)) return true;
  if (
    (char === "+" || char === "-") &&
    previous - 1 >= rangeStart &&
    source[previous - 1] === char
  ) {
    return false;
  }
  if (char !== undefined && "([{=,:;!~?&|+-*%^<>".includes(char)) return true;

  return [
    "case",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "of",
    "await",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
  ].includes(keywordBefore(source, index) ?? "");
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
): number {
  const char = source[index];
  const next = source[index + 1];

  if (char === "/" && next === "/") {
    const newline = source.indexOf("\n", index + 2);
    return newline === -1 ? source.length : newline + 1;
  }

  if (char === "/" && next === "*") {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (char === '"' || char === "'") return skipIgnored(source, index);
  if (char === "`") return skipFullTemplateLiteral(source, index, depth + 1);
  if (char === "/" && canStartRegexLiteral(source, index, rangeStart)) {
    return skipRegexLiteral(source, index);
  }

  return index;
}

function findTemplateExpressionEnd(
  source: string,
  expressionIndex: number,
  depth = 0,
): number | null {
  assertTemplateLiteralDepth(depth);

  let cursor = expressionIndex;
  let braceDepth = 1;

  while (cursor < source.length) {
    const skipped = skipExpressionIgnored(source, cursor, expressionIndex, depth);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (source[cursor] === "{") {
      braceDepth++;
      cursor++;
      continue;
    }

    if (source[cursor] === "}") {
      braceDepth--;
      if (braceDepth === 0) return cursor;
      cursor++;
      continue;
    }

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
      !isIdentifierChar(source[cursor - 1]) &&
      !isIdentifierChar(source[cursor + 4])
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

  while (cursor < source.length) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const isImport = isStatementKeywordAt(source, cursor, "import");
    const isExport = isStatementKeywordAt(source, cursor, "export");
    if (!isImport && !isExport) {
      cursor++;
      continue;
    }

    const keywordLength = isImport ? "import".length : "export".length;
    const afterKeyword = skipWhitespaceAndComments(source, cursor + keywordLength);
    if (isImport && source[afterKeyword] === "(") {
      cursor = afterKeyword + 1;
      continue;
    }

    const span = findFromSpan(source, afterKeyword, matcher);
    if (span) {
      spans.push(span);
      if (spans.length >= maxMatches) return spans;
      cursor = span.end;
      continue;
    }

    cursor = nextStatementCursor(source, afterKeyword);
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

  while (cursor < rangeEnd) {
    const char = source[cursor];
    const next = source[cursor + 1];

    if (
      (char === "/" && (next === "/" || next === "*")) ||
      char === '"' ||
      char === "'"
    ) {
      cursor = skipIgnored(source, cursor);
      continue;
    }

    if (char === "/" && canStartRegexLiteral(source, cursor, rangeStart)) {
      cursor = skipRegexLiteral(source, cursor);
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
      continue;
    }

    // `import` used as an expression: not preceded by an identifier char or a
    // dot (which would make it `foo.import` or part of a longer word).
    if (
      !source.startsWith("import", cursor) ||
      isIdentifierChar(source[cursor - 1]) ||
      source[cursor - 1] === "." ||
      isIdentifierChar(source[cursor + "import".length])
    ) {
      cursor++;
      continue;
    }

    const parenIndex = skipWhitespaceAndComments(source, cursor + "import".length);
    if (parenIndex >= rangeEnd || source[parenIndex] !== "(") {
      cursor++;
      continue;
    }

    const literalIndex = skipWhitespaceAndComments(source, parenIndex + 1);
    if (literalIndex >= rangeEnd) {
      cursor = parenIndex + 1;
      continue;
    }

    const literal = readLiteralSpecifier(source, literalIndex);
    if (!literal || literal.end > rangeEnd) {
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

  while (cursor < source.length) {
    const skipped = skipIgnored(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (!isStatementKeywordAt(source, cursor, "import")) {
      cursor++;
      continue;
    }

    const literalIndex = skipWhitespaceAndComments(source, cursor + "import".length);
    const literal = readLiteralSpecifier(source, literalIndex);
    if (!literal) {
      cursor = nextStatementCursor(source, literalIndex);
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

    cursor = literal.end;
  }

  return spans;
}
