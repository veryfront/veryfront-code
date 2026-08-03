import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  type StaticImportSpan,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";
import { hasControlCharacter } from "./data-properties.ts";
import { MAX_IMPORT_SPECIFIER_CHARS, MAX_IMPORTS_PER_PAGE } from "./limits.ts";
import { hasScheme } from "./specifier.ts";

export interface ImportGroups {
  local: string[];
  remote: string[];
  shared: string[];
}

function maskText(value: string): string {
  return value.replace(/[^\r\n]/g, " ");
}

function maskHtmlComments(source: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let copiedThrough = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  while (cursor < source.length) {
    const char = source[cursor];
    const next = source[cursor + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      cursor++;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        cursor += 2;
      } else {
        cursor++;
      }
      continue;
    }
    if (quote !== null) {
      if (char === "\\") {
        cursor += Math.min(2, source.length - cursor);
        continue;
      }
      if (char === quote) {
        quote = null;
        cursor++;
        continue;
      }
      if (quote !== "`" && (char === "\r" || char === "\n")) {
        quote = null;
      }
      cursor++;
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      cursor += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      cursor += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      cursor++;
      continue;
    }
    if (!source.startsWith("<!--", cursor)) {
      cursor++;
      continue;
    }

    parts.push(source.slice(copiedThrough, cursor));
    const closing = source.indexOf("-->", cursor + 4);
    const end = closing === -1 ? source.length : closing + 3;
    parts.push(maskText(source.slice(cursor, end)));
    cursor = end;
    copiedThrough = end;
  }
  parts.push(source.slice(copiedThrough));
  return parts.join("");
}

interface FenceMarker {
  readonly marker: "`" | "~";
  readonly length: number;
  readonly suffix: string;
}

function readFenceMarker(line: string): FenceMarker | null {
  let cursor = 0;
  while (cursor < line.length && cursor < 4 && line[cursor] === " ") cursor++;
  if (cursor > 3) return null;

  const marker = line[cursor];
  if (marker !== "`" && marker !== "~") return null;
  const start = cursor;
  while (line[cursor] === marker) cursor++;
  if (cursor - start < 3) return null;

  return {
    marker,
    length: cursor - start,
    suffix: line.slice(cursor),
  };
}

function hasIndentedCodePrefix(line: string): boolean {
  return line.startsWith("\t") || line.startsWith("    ");
}

function hasYamlFrontmatterClosingDelimiter(
  source: string,
  firstLineEnd: number,
): boolean {
  let cursor = firstLineEnd < source.length ? firstLineEnd + 1 : source.length;
  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(cursor, end);
    if ((line.endsWith("\r") ? line.slice(0, -1) : line) === "---") {
      return true;
    }
    cursor = newline === -1 ? source.length : newline + 1;
  }
  return false;
}

function maskMarkdownRegions(source: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let lineNumber = 0;
  let insideFrontmatter = false;
  let fence: Pick<FenceMarker, "marker" | "length"> | null = null;
  let insideIndentedCode = false;
  let previousLineBlank = true;

  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(cursor, end);
    const comparable = line.endsWith("\r") ? line.slice(0, -1) : line;
    let shouldMask = false;

    if (lineNumber === 0) {
      const firstLine = comparable.startsWith("\uFEFF") ? comparable.slice(1) : comparable;
      if (
        firstLine === "---" &&
        hasYamlFrontmatterClosingDelimiter(source, end)
      ) {
        insideFrontmatter = true;
        shouldMask = true;
      }
    } else if (insideFrontmatter) {
      shouldMask = true;
      if (comparable === "---") {
        insideFrontmatter = false;
      }
    } else if (fence !== null) {
      shouldMask = true;
      const closing = readFenceMarker(comparable);
      if (
        closing?.marker === fence.marker &&
        closing.length >= fence.length &&
        closing.suffix.trim().length === 0
      ) {
        fence = null;
      }
    } else {
      const blank = comparable.trim().length === 0;
      const indented = hasIndentedCodePrefix(comparable);
      if (insideIndentedCode && (blank || indented)) {
        shouldMask = true;
      } else {
        insideIndentedCode = false;
        const opening = readFenceMarker(comparable);
        if (
          opening !== null &&
          !(opening.marker === "`" && opening.suffix.includes("`"))
        ) {
          fence = opening;
          shouldMask = true;
        } else if (indented && previousLineBlank) {
          insideIndentedCode = true;
          shouldMask = true;
        }
      }
    }

    parts.push(shouldMask ? maskText(line) : line);
    if (newline !== -1) parts.push("\n");
    cursor = newline === -1 ? source.length : newline + 1;
    previousLineBlank = comparable.trim().length === 0;
    lineNumber++;
  }
  return maskHtmlComments(parts.join(""));
}

function readHexDigit(char: string | undefined): number {
  if (char === undefined) return -1;
  const code = char.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

function readFixedHex(
  value: string,
  start: number,
  length: number,
): { readonly value: number; readonly end: number } {
  let parsed = 0;
  for (let index = 0; index < length; index++) {
    const digit = readHexDigit(value[start + index]);
    if (digit === -1) {
      throw new SyntaxError("Invalid escaped module specifier");
    }
    parsed = parsed * 16 + digit;
  }
  return { value: parsed, end: start + length };
}

function decodeModuleSpecifier(value: string): string {
  if (!value.includes("\\")) return value;

  let decoded = "";
  let cursor = 0;
  while (cursor < value.length) {
    const char = value[cursor++]!;
    if (char !== "\\") {
      if (char === "\n" || char === "\r") {
        throw new SyntaxError("Module specifiers cannot contain line terminators");
      }
      decoded += char;
      continue;
    }
    if (cursor >= value.length) {
      throw new SyntaxError("Invalid escaped module specifier");
    }

    const escaped = value[cursor++]!;
    const simple = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"',
    } as const;
    if (Object.hasOwn(simple, escaped)) {
      decoded += simple[escaped as keyof typeof simple];
      continue;
    }
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (value[cursor] === "\n") cursor++;
      continue;
    }
    if (escaped === "0") {
      if (/[0-9]/.test(value[cursor] ?? "")) {
        throw new SyntaxError(
          "Legacy octal escapes are not valid in module specifiers",
        );
      }
      decoded += "\0";
      continue;
    }
    if (escaped === "x") {
      const parsed = readFixedHex(value, cursor, 2);
      decoded += String.fromCharCode(parsed.value);
      cursor = parsed.end;
      continue;
    }
    if (escaped === "u") {
      if (value[cursor] === "{") {
        const closing = value.indexOf("}", cursor + 1);
        if (closing === -1 || closing === cursor + 1) {
          throw new SyntaxError("Invalid Unicode escape in module specifier");
        }
        let codePoint = 0;
        for (let index = cursor + 1; index < closing; index++) {
          const digit = readHexDigit(value[index]);
          if (digit === -1) {
            throw new SyntaxError("Invalid Unicode escape in module specifier");
          }
          codePoint = codePoint * 16 + digit;
          if (codePoint > 0x10ffff) {
            throw new SyntaxError(
              "Module specifier Unicode escape is out of range",
            );
          }
        }
        decoded += String.fromCodePoint(codePoint);
        cursor = closing + 1;
        continue;
      }
      const parsed = readFixedHex(value, cursor, 4);
      decoded += String.fromCharCode(parsed.value);
      cursor = parsed.end;
      continue;
    }
    if (escaped >= "1" && escaped <= "9") {
      throw new SyntaxError(
        "Legacy numeric escapes are not valid in module specifiers",
      );
    }

    decoded += escaped;
  }
  return decoded;
}

function validateImportSpecifier(value: string): string {
  const decoded = decodeModuleSpecifier(value);
  if (
    decoded.length === 0 ||
    decoded.length > MAX_IMPORT_SPECIFIER_CHARS ||
    hasControlCharacter(decoded)
  ) {
    throw new TypeError(
      `Chunk analysis import specifiers must contain between 1 and ${MAX_IMPORT_SPECIFIER_CHARS} characters without control characters`,
    );
  }
  return decoded;
}

/**
 * Run a span scanner one match past the per-page bound and fail closed there.
 *
 * The scanners truncate at their bound, so accepting a truncated scan would
 * silently drop imports from the dependency graph instead of rejecting the
 * page.
 */
function findBoundedSpans(
  scan: (maxMatches: number) => StaticImportSpan[],
): StaticImportSpan[] {
  const spans = scan(MAX_IMPORTS_PER_PAGE + 1);
  if (spans.length > MAX_IMPORTS_PER_PAGE) {
    throw new RangeError(
      `Chunk analysis import limit of ${MAX_IMPORTS_PER_PAGE} per page was exceeded`,
    );
  }
  return spans;
}

function extractImportSpecifiers(content: string): string[] {
  const source = maskMarkdownRegions(content);
  const matchAll = (specifier: string) => specifier;
  const spans: StaticImportSpan[] = [
    ...findBoundedSpans((maxMatches) => findStaticImportFromSpans(source, matchAll, maxMatches)),
    ...findBoundedSpans((maxMatches) =>
      findStaticSideEffectImportSpans(source, matchAll, maxMatches)
    ),
    ...findBoundedSpans((maxMatches) => findDynamicImportSpans(source, matchAll, maxMatches)),
  ].sort((left, right) => left.start - right.start);

  const result: string[] = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const specifier = validateImportSpecifier(span.path);
    if (seen.has(specifier)) continue;
    if (result.length >= MAX_IMPORTS_PER_PAGE) {
      throw new RangeError(
        `Chunk analysis import limit of ${MAX_IMPORTS_PER_PAGE} per page was exceeded`,
      );
    }
    seen.add(specifier);
    result.push(specifier);
  }
  return result;
}

export function analyzePageImports(
  content: string,
  filePath: string,
): ImportGroups {
  if (filePath.endsWith(".md")) return { local: [], remote: [], shared: [] };

  const local: string[] = [];
  const remote: string[] = [];
  const shared: string[] = [];
  for (const specifier of extractImportSpecifiers(content)) {
    if (
      specifier.startsWith("//") ||
      hasScheme(specifier, "http:") ||
      hasScheme(specifier, "https:")
    ) {
      remote.push(specifier);
    } else if (
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      hasScheme(specifier, "file:") ||
      specifier.startsWith("@/") ||
      specifier.startsWith("#")
    ) {
      local.push(specifier);
    } else {
      shared.push(specifier);
    }
  }
  return { local, remote, shared };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
