import { logger } from "#veryfront/utils";
import { init, parse } from "es-module-lexer";

let initPromise: Promise<void> | null = null;

// Matches HTTP/HTTPS URLs in string literals (single, double, or backtick quotes)
// Uses negative lookbehind to avoid matching URLs inside escaped quotes (like \")
const HTTP_URL_PATTERN = /(?<!\\)(['"`])(https?:\/\/[^'"`\n\\]+)\1/g;

type UrlMaskResult = {
  masked: string;
  urlMap: Map<string, string>;
};

function maskHttpUrls(code: string): UrlMaskResult {
  const urlMap = new Map<string, string>();
  let counter = 0;

  const masked = code.replace(HTTP_URL_PATTERN, (_match, quote: string, url: string) => {
    const placeholder = `__VFURL_${counter++}__`;
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

export async function initLexer(): Promise<void> {
  if (!initPromise) {
    // es-module-lexer@1.5 exports init as a Promise (not a function) in ESM build
    // but some typings expect a function. Handle both to avoid type errors.
    const anyInit = init as unknown;
    initPromise = typeof anyInit === "function"
      ? (anyInit as () => Promise<void>)()
      : (anyInit as Promise<void>);
  }
  await initPromise;
}

export type ImportSpecifier = {
  n: string | undefined; // The module specifier (e.g., "react")
  s: number; // Start of module specifier
  e: number; // End of module specifier
  ss: number; // Start of import statement
  se: number; // End of import statement
  d: number; // > -1 if dynamic import
  a: number; // assert index
};

export async function parseImports(code: string): Promise<readonly ImportSpecifier[]> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);

  let imports: readonly ImportSpecifier[];
  try {
    [imports] = parse(masked);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const match = errorMsg.match(/@:(\d+):(\d+)/);

    if (match) {
      const line = Number.parseInt(match[1] ?? "", 10);
      const col = Number.parseInt(match[2] ?? "", 10);
      const lines = masked.split("\n");
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

      logger.error("[es-module-lexer] Parse error", { line, col, context });
    }

    throw error;
  }

  if (urlMap.size === 0) return imports;

  return imports.map((imp) => {
    if (!imp.n) return imp;

    const restoredN = unmaskHttpUrls(imp.n, urlMap);
    return restoredN === imp.n ? imp : { ...imp, n: restoredN };
  });
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
  const [imports] = parse(masked);

  let result = masked;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp?.n) continue;

    const originalSpecifier = unmaskHttpUrls(imp.n, urlMap);
    const replacement = replacer(originalSpecifier, imp.d > -1);

    if (!replacement || replacement === originalSpecifier) continue;

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
  const [imports] = parse(masked);

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
