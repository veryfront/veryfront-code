import { logger as baseLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ImportSpecifier, ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import {
  primordialArrayMap,
  primordialArrayPush,
} from "#veryfront/platform/compat/primordials/array.ts";

export type { ImportSpecifier };

const logger = baseLogger.component("es-module-lexer");
const IntrinsicMap = Map;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicString = String;
const MapPrototypeForEach = Map.prototype.forEach;
const MapPrototypeSet = Map.prototype.set;
const MapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;

let initPromise: Promise<void> | null = null;

// Matches HTTP/HTTPS URLs in string literals (single, double, or backtick quotes).
// Uses negative lookbehind to avoid matching URLs inside escaped quotes (like \").
//
// Template literals with ${} interpolation: the pattern captures from the
// opening backtick to the closing backtick, treating `${…}` as part of the
// URL text.  This is intentional — mask/unmask is atomic, so the interpolation
// is preserved verbatim.  Template literals with dynamic expressions are
// correctly passed through; es-module-lexer will report their `n` field as
// undefined, so the replacer skips them.
const HTTP_URL_PATTERN = /(?<!\\)(['"`])(https?:\/\/[^'"`\n\\]+)\1/g;

// Placeholder prefix for masked HTTP URLs.  The hex suffix makes it
// unlikely to collide with any identifier or string in user-supplied code.
// Placeholders are session-local (never written to disk) so uniqueness only
// needs to hold for the lifetime of a single parse call.
const VFURL_PLACEHOLDER_PREFIX = "__VF_HTTP_MASK_e3c2_";
const PARSE_ERROR_LOCATION_PATTERN = /@:(\d+):(\d+)/;

type UrlMaskResult = {
  masked: string;
  urlMap: Map<string, string>;
};

function stringIndexOf(value: string, search: string, start = 0): number {
  return IntrinsicReflectApply(StringPrototypeIndexOf, value, [search, start]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return IntrinsicReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  let result = "";
  let cursor = 0;
  for (;;) {
    const index = stringIndexOf(value, search, cursor);
    if (index < 0) return result + stringSlice(value, cursor);
    result += stringSlice(value, cursor, index) + replacement;
    cursor = index + search.length;
  }
}

function splitLines(value: string): string[] {
  const lines: string[] = [];
  let cursor = 0;
  for (;;) {
    const index = stringIndexOf(value, "\n", cursor);
    if (index < 0) {
      primordialArrayPush(lines, stringSlice(value, cursor));
      return lines;
    }
    primordialArrayPush(lines, stringSlice(value, cursor, index));
    cursor = index + 1;
  }
}

function maskHttpUrls(code: string): UrlMaskResult {
  const urlMap = new IntrinsicMap<string, string>();
  let counter = 0;
  let masked = "";
  let cursor = 0;
  HTTP_URL_PATTERN.lastIndex = 0;
  try {
    for (;;) {
      const match = IntrinsicReflectApply(
        RegExpPrototypeExec,
        HTTP_URL_PATTERN,
        [code],
      ) as RegExpExecArray | null;
      if (match === null) break;
      const quote = match[1]!;
      const url = match[2]!;
      const placeholder = `${VFURL_PLACEHOLDER_PREFIX}${counter++}__`;
      IntrinsicReflectApply(MapPrototypeSet, urlMap, [placeholder, url]);
      masked += stringSlice(code, cursor, match.index) + `${quote}${placeholder}${quote}`;
      cursor = match.index + match[0].length;
    }
  } finally {
    HTTP_URL_PATTERN.lastIndex = 0;
  }
  masked += stringSlice(code, cursor);

  return { masked, urlMap };
}

function unmaskHttpUrls(code: string, urlMap: Map<string, string>): string {
  let result = code;

  IntrinsicReflectApply(MapPrototypeForEach, urlMap, [
    (url: string, placeholder: string) => {
      result = replaceAllLiteral(result, placeholder, url);
    },
  ]);

  return result;
}

function getLexer(): ModuleLexer {
  return resolveContract<ModuleLexer>("ModuleLexer");
}

export async function initLexer(): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }

  const lexer = getLexer();
  initPromise = lexer.init ? lexer.init() : Promise.resolve();
  await initPromise;
}

function logParseError(error: unknown, code: string): void {
  const errorMsg = error instanceof Error ? error.message : IntrinsicString(error);
  const match = IntrinsicReflectApply(
    RegExpPrototypeExec,
    PARSE_ERROR_LOCATION_PATTERN,
    [errorMsg],
  ) as RegExpExecArray | null;
  if (!match) return;

  const line = Number.parseInt(match[1] ?? "", 10);
  const col = Number.parseInt(match[2] ?? "", 10);
  const lines = splitLines(code);
  const start = Math.max(0, line - 3);
  let context = "";
  for (let index = start; index < lines.length && index < line + 2; index++) {
    const text = lines[index]!;
    const lineNum = index + 1;
    const prefix = lineNum === line ? ">>> " : "    ";
    const snippet = text.length > 200 ? `${stringSlice(text, 0, 200)}...` : text;
    if (context.length > 0) context += "\n";
    context += `${prefix}${lineNum}: ${snippet}`;
  }

  logger.error("Parse error", { line, col, context });
}

export async function parseImports(code: string): Promise<readonly ImportSpecifier[]> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);

  let imports: readonly ImportSpecifier[];
  try {
    imports = getLexer().parse(masked);
  } catch (error) {
    logParseError(error, masked);
    throw error;
  }

  if (IntrinsicReflectApply(MapSizeGetter, urlMap, []) === 0) return imports;

  return primordialArrayMap(imports, (imp) => {
    if (!imp.n) return imp;

    const restoredN = unmaskHttpUrls(imp.n, urlMap);
    return restoredN === imp.n ? imp : { ...imp, n: restoredN };
  });
}

/** A parse whose positions index into a masked copy of the source. */
export interface MaskedParse {
  /** The source with HTTP URLs replaced by fixed-width placeholders. */
  masked: string;
  /** Specifiers whose every positional field indexes into {@link masked}. */
  imports: readonly ImportSpecifier[];
  /** Restore the masked HTTP URLs in a string derived from {@link masked}. */
  unmask: (text: string) => string;
}

/**
 * Parse imports and hand back the masked source the positions belong to.
 *
 * Masking changes offsets, so `imp.s`, `imp.a` and friends are meaningless
 * against the original text. Callers that splice by position must edit
 * `masked` and run the result through `unmask`; callers that only need
 * specifier names should use {@link parseImports} instead.
 */
export async function parseMaskedImports(code: string): Promise<MaskedParse> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);

  let imports: readonly ImportSpecifier[];
  try {
    imports = getLexer().parse(masked);
  } catch (error) {
    logParseError(error, masked);
    throw error;
  }

  return { masked, imports, unmask: (text) => unmaskHttpUrls(text, urlMap) };
}

/**
 * Replace import specifiers (the path string) in the code.
 * Safe for simple re-mappings like aliases or rewriting URLs.
 */
export async function replaceSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);
  const imports = getLexer().parse(masked);

  let result = masked;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp?.n) continue;

    const originalSpecifier = unmaskHttpUrls(imp.n, urlMap);
    const isDynamic = imp.d > -1;
    const replacement = replacer(originalSpecifier, isDynamic);

    if (!replacement || replacement === originalSpecifier) continue;

    if (!isDynamic) {
      result = stringSlice(result, 0, imp.s) + replacement + stringSlice(result, imp.e);
      continue;
    }

    // For dynamic imports with string literals, es-module-lexer's s/e include the quotes.
    // We need to preserve the quote style when replacing.
    const quote = result[imp.s];
    if (quote === '"' || quote === "'" || quote === "`") {
      result = stringSlice(result, 0, imp.s) + quote + replacement + quote +
        stringSlice(result, imp.e);
      continue;
    }

    // Dynamic import with expression, not string literal - shouldn't happen if n is defined
    result = stringSlice(result, 0, imp.s) + replacement + stringSlice(result, imp.e);
  }

  return unmaskHttpUrls(result, urlMap);
}

/**
 * Rewrite entire import statements.
 * Useful for complex transformations like vendor splitting.
 */
export async function rewriteImports(
  code: string,
  rewriter: (imp: ImportSpecifier, statement: string) => string | null,
): Promise<string> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);
  const imports = getLexer().parse(masked);

  let result = masked;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;

    const unmaskedImp = imp.n ? { ...imp, n: unmaskHttpUrls(imp.n, urlMap) } : imp;
    const statement = unmaskHttpUrls(stringSlice(masked, imp.ss, imp.se), urlMap);

    const replacement = rewriter(unmaskedImp, statement);
    if (replacement === null) continue;

    result = stringSlice(result, 0, imp.ss) + replacement + stringSlice(result, imp.se);
  }

  return unmaskHttpUrls(result, urlMap);
}
