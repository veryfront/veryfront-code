/**
 * CSS Import Extraction
 *
 * Pure helpers for discovering CSS files imported by project source modules
 * (side-effect imports like `import "./styles.css"` in app/layout.tsx, `@/`
 * alias imports, and CSS module imports).
 *
 * The production SSR pipeline collects CSS imports while loading modules and
 * merges them into the page stylesheet. Two other stylesheet producers have no
 * module-loading pass and recover the same information with these helpers:
 * the dev/preview /_vf_styles/styles.css route and the release-asset build
 * executor.
 *
 * Extraction uses a bounded lightweight lexer so it stays cheap enough to run
 * on every stylesheet compile without depending on bundler/parser extensions.
 * It recognizes static imports and skips comments, strings, templates, regular
 * expressions, dynamic imports, and `import.meta` expressions.
 *
 * @module html/styles-builder/css-import-extraction
 */

import { isWithinDirectory, normalizePath } from "#veryfront/utils/path-utils.ts";
import {
  MAX_CSS_IMPORT_SPECIFIER_BYTES,
  MAX_CSS_IMPORTS,
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
  MAX_STYLE_SOURCE_PATH_BYTES,
  MAX_TOTAL_STYLE_SOURCE_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

/** Module extensions whose sources can carry CSS imports. */
export const CSS_IMPORTING_SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

function byteLengthWithinLimit(value: string, maxBytes: number, label: string): number {
  if (value.length > maxBytes) throw new TypeError(`${label} exceeds the size limit`);
  const bytes = utf8ByteLength(value);
  if (bytes > maxBytes) throw new TypeError(`${label} exceeds the size limit`);
  return bytes;
}

function isIdentifierStart(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 36 || code === 95;
}

function isIdentifierPart(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return isIdentifierStart(character) || code >= 48 && code <= 57;
}

function isWhitespace(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function isAsciiLetter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return code >= 65 && code <= 90 || code >= 97 && code <= 122;
}

function isDigit(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function readIdentifier(source: string, start: number): { value: string; end: number } {
  let end = start + 1;
  while (isIdentifierPart(source[end])) end++;
  return { value: source.slice(start, end), end };
}

function readQuotedString(
  source: string,
  start: number,
  captureValue = false,
): { value: string; end: number } {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote) {
      return {
        value: captureValue ? source.slice(start + 1, index) : "",
        end: index + 1,
      };
    }
    index++;
  }
  return {
    value: captureValue ? source.slice(start + 1) : "",
    end: source.length,
  };
}

function skipLineComment(source: string, start: number): number {
  const newline = source.indexOf("\n", start + 2);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (isWhitespace(source[index])) {
      index++;
      continue;
    }
    if (source.startsWith("//", index)) {
      index = skipLineComment(source, index);
      continue;
    }
    if (source.startsWith("/*", index)) {
      index = skipBlockComment(source, index);
      continue;
    }
    break;
  }
  return index;
}

function skipRegexLiteral(source: string, start: number): number {
  let inCharacterClass = false;
  let index = start + 1;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") inCharacterClass = true;
    else if (character === "]") inCharacterClass = false;
    else if (character === "/" && !inCharacterClass) {
      index++;
      while (isAsciiLetter(source[index])) index++;
      return index;
    } else if (character === "\n" || character === "\r") {
      return index;
    }
    index++;
  }
  return source.length;
}

function visitSpecifier(specifier: string, visit: (specifier: string) => void): void {
  if (!specifier.endsWith(".css")) return;
  byteLengthWithinLimit(
    specifier,
    MAX_CSS_IMPORT_SPECIFIER_BYTES,
    "CSS import specifier",
  );
  visit(specifier);
}

function parseStaticImport(
  source: string,
  start: number,
  visit: (specifier: string) => void,
): number {
  let index = skipTrivia(source, start);
  const first = source[index];

  if (first === '"' || first === "'") {
    const specifier = readQuotedString(source, index, true);
    visitSpecifier(specifier.value, visit);
    return specifier.end;
  }
  if (first === "(" || first === ".") return index + 1;

  while (index < source.length) {
    index = skipTrivia(source, index);
    const character = source[index];
    if (character === undefined || character === ";") return index + 1;
    if (character === '"' || character === "'" || character === "`") {
      index = readQuotedString(source, index).end;
      continue;
    }
    if (isIdentifierStart(character)) {
      const token = readIdentifier(source, index);
      index = token.end;
      if (token.value !== "from") continue;

      index = skipTrivia(source, index);
      if (source[index] !== '"' && source[index] !== "'") return index;
      const specifier = readQuotedString(source, index, true);
      visitSpecifier(specifier.value, visit);
      return specifier.end;
    }
    index++;
  }
  return index;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/** Visit static ESM CSS imports while ignoring comments and expression syntax. */
function visitCssImportSpecifiers(source: string, visit: (specifier: string) => void): void {
  let index = 0;
  let canStartRegex = true;

  while (index < source.length) {
    index = skipTrivia(source, index);
    const character = source[index];
    if (character === undefined) break;

    if (character === '"' || character === "'" || character === "`") {
      index = readQuotedString(source, index).end;
      canStartRegex = false;
      continue;
    }
    if (character === "/" && canStartRegex) {
      index = skipRegexLiteral(source, index);
      canStartRegex = false;
      continue;
    }
    if (isIdentifierStart(character)) {
      const token = readIdentifier(source, index);
      index = token.end;
      if (token.value === "import") {
        index = parseStaticImport(source, index, visit);
        canStartRegex = true;
      } else {
        canStartRegex = REGEX_PREFIX_KEYWORDS.has(token.value);
      }
      continue;
    }
    if (isDigit(character) || character === ")" || character === "]") {
      canStartRegex = false;
    } else if (character !== ".") {
      canStartRegex = true;
    }
    index++;
  }
}

/** Extract the raw specifiers of all static CSS imports in a source file. */
export function extractCssImportSpecifiers(source: string): string[] {
  if (typeof source !== "string") throw new TypeError("CSS import source content must be a string");
  byteLengthWithinLimit(
    source,
    MAX_STYLE_SOURCE_FILE_BYTES,
    "CSS import source content",
  );
  const specifiers: string[] = [];
  visitCssImportSpecifiers(source, (specifier) => {
    if (specifiers.length >= MAX_CSS_IMPORTS) {
      throw new TypeError("CSS import count exceeds the limit");
    }
    specifiers.push(specifier);
  });
  return specifiers;
}

/** Resolve `.`/`..` segments; returns null if the path escapes its root. */
function collapseSegments(path: string): string | null {
  const segments = path.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || (segment === "" && out.length > 0)) continue;
    if (segment === "..") {
      if (out.length <= 1) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/") || "/";
}

/**
 * Resolve a CSS import specifier to an absolute project path.
 * Supports `./`/`../` (relative to the importing file) and the `@/` project
 * alias. Bare and URL specifiers are ignored. Returns null when the resolved
 * path would escape the project directory.
 */
export function resolveCssImportPath(
  specifier: string,
  importerPath: string,
  projectDir: string,
): string | null {
  if (
    typeof specifier !== "string" || typeof importerPath !== "string" ||
    typeof projectDir !== "string"
  ) return null;
  try {
    byteLengthWithinLimit(
      specifier,
      MAX_CSS_IMPORT_SPECIFIER_BYTES,
      "CSS import specifier",
    );
    byteLengthWithinLimit(importerPath, MAX_STYLE_SOURCE_PATH_BYTES, "CSS importer path");
    byteLengthWithinLimit(projectDir, MAX_STYLE_SOURCE_PATH_BYTES, "CSS project path");
  } catch {
    return null;
  }
  const normalizedImporter = normalizePath(importerPath);
  const normalizedProjectDir = normalizePath(projectDir);

  let candidate: string;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const dirEnd = normalizedImporter.lastIndexOf("/");
    if (dirEnd <= 0) return null;
    candidate = `${normalizedImporter.slice(0, dirEnd)}/${specifier}`;
  } else if (specifier.startsWith("@/")) {
    candidate = `${normalizedProjectDir}/${specifier.slice(2)}`;
  } else {
    return null;
  }

  const collapsed = collapseSegments(normalizePath(candidate));
  if (!collapsed) return null;
  if (!isWithinDirectory(normalizedProjectDir, collapsed)) return null;
  return collapsed;
}

/**
 * Collect the resolved absolute paths of all CSS files imported by the given
 * source files, deduplicated and sorted for deterministic output.
 */
export function collectCssImportPaths(
  files: Iterable<{ path: string; content: string }>,
  projectDir: string,
): string[] {
  if (typeof projectDir !== "string") {
    throw new TypeError("CSS project path must be a string");
  }
  byteLengthWithinLimit(projectDir, MAX_STYLE_SOURCE_PATH_BYTES, "CSS project path");
  const cssImports = new Set<string>();
  let fileCount = 0;
  let sourceBytes = 0;
  let importCount = 0;

  for (const file of files) {
    fileCount++;
    if (fileCount > MAX_STYLE_SOURCE_FILES) {
      throw new TypeError("CSS import source file count exceeds the limit");
    }
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new TypeError("CSS import source file is invalid");
    }
    byteLengthWithinLimit(file.path, MAX_STYLE_SOURCE_PATH_BYTES, "CSS import source path");
    const fileBytes = byteLengthWithinLimit(
      file.content,
      MAX_STYLE_SOURCE_FILE_BYTES,
      "CSS import source content",
    );
    sourceBytes += fileBytes;
    if (sourceBytes > MAX_TOTAL_STYLE_SOURCE_BYTES) {
      throw new TypeError("CSS import source bytes exceed the total size limit");
    }

    // Cheap pre-filter before running the regex against large files.
    if (!file.content.includes(".css")) continue;

    visitCssImportSpecifiers(file.content, (specifier) => {
      importCount++;
      if (importCount > MAX_CSS_IMPORTS) {
        throw new TypeError("CSS import count exceeds the limit");
      }
      const resolved = resolveCssImportPath(specifier, file.path, projectDir);
      if (resolved) cssImports.add(resolved);
    });
  }

  return [...cssImports].sort();
}
