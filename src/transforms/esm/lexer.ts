import { logger as baseLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ImportSpecifier, ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";

export type { ImportSpecifier };

const logger = baseLogger.component("es-module-lexer");

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

type UrlMaskResult = {
  masked: string;
  urlMap: Map<string, string>;
};

function maskHttpUrls(code: string): UrlMaskResult {
  const urlMap = new Map<string, string>();
  let counter = 0;

  const masked = code.replace(HTTP_URL_PATTERN, (_match, quote: string, url: string) => {
    const placeholder = `${VFURL_PLACEHOLDER_PREFIX}${counter++}__`;
    urlMap.set(placeholder, url);
    return `${quote}${placeholder}${quote}`;
  });

  return { masked, urlMap };
}

function unmaskHttpUrls(code: string, urlMap: Map<string, string>): string {
  let result = code;

  for (const [placeholder, url] of urlMap) {
    result = result.replaceAll(placeholder, url);
  }

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
  const errorMsg = error instanceof Error ? error.message : String(error);
  const match = errorMsg.match(/@:(\d+):(\d+)/);
  if (!match) return;

  const line = Number.parseInt(match[1] ?? "", 10);
  const col = Number.parseInt(match[2] ?? "", 10);
  const lines = code.split("\n");
  const start = Math.max(0, line - 3);

  const context = lines
    .slice(start, line + 2)
    .map((l, i) => {
      const lineNum = start + i + 1;
      const prefix = lineNum === line ? ">>> " : "    ";
      const snippet = l.length > 200 ? `${l.substring(0, 200)}...` : l;
      return `${prefix}${lineNum}: ${snippet}`;
    })
    .join("\n");

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

  if (urlMap.size === 0) return imports;

  return imports.map((imp) => {
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
      result = result.substring(0, imp.s) + replacement + result.substring(imp.e);
      continue;
    }

    // For dynamic imports with string literals, es-module-lexer's s/e include the quotes.
    // We need to preserve the quote style when replacing.
    const quote = result[imp.s];
    if (quote === '"' || quote === "'" || quote === "`") {
      result = result.substring(0, imp.s) + quote + replacement + quote + result.substring(imp.e);
      continue;
    }

    // Dynamic import with expression, not string literal - shouldn't happen if n is defined
    result = result.substring(0, imp.s) + replacement + result.substring(imp.e);
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
    const statement = unmaskHttpUrls(masked.substring(imp.ss, imp.se), urlMap);

    const replacement = rewriter(unmaskedImp, statement);
    if (replacement === null) continue;

    result = result.substring(0, imp.ss) + replacement + result.substring(imp.se);
  }

  return unmaskHttpUrls(result, urlMap);
}
