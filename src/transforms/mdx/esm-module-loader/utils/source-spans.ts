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
      throw INVALID_ARGUMENT.create({ detail: `Source replacement span did not match expected text: ${expected}` });
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
      const quoteIndex = skipWhitespace(source, cursor + 4);
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

export function findStaticImportFromSpans(
  source: string,
  matcher: SpecifierMatcher,
): StaticImportSpan[] {
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
    const afterKeyword = skipWhitespace(source, cursor + keywordLength);
    if (isImport && source[afterKeyword] === "(") {
      cursor = afterKeyword + 1;
      continue;
    }

    const span = findFromSpan(source, afterKeyword, matcher);
    if (span) {
      spans.push(span);
      cursor = span.end;
      continue;
    }

    cursor = nextStatementCursor(source, afterKeyword);
  }

  return spans;
}

export function findStaticSideEffectImportSpans(
  source: string,
  matcher: SpecifierMatcher,
): StaticImportSpan[] {
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

    const quoteIndex = skipWhitespace(source, cursor + "import".length);
    const quoted = readQuotedSpecifier(source, quoteIndex);
    if (!quoted) {
      cursor = nextStatementCursor(source, quoteIndex);
      continue;
    }

    const matchedPath = matcher(quoted.specifier);
    if (matchedPath) {
      spans.push({
        original: source.slice(cursor, quoted.end),
        path: matchedPath,
        start: cursor,
        end: quoted.end,
      });
    }

    cursor = quoted.end;
  }

  return spans;
}
