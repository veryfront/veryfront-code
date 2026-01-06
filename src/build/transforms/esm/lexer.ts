import { init, parse } from "es-module-lexer";

let initPromise: Promise<void> | null = null;

// ============================================================================
// URL Masking - es-module-lexer cannot parse HTTP URLs with special chars
// We temporarily replace them with safe placeholders before parsing
// ============================================================================

// Matches HTTP/HTTPS URLs in string literals (single, double, or backtick quotes)
const HTTP_URL_PATTERN = /(['"`])(https?:\/\/[^'"`\n]+)\1/g;

type UrlMaskResult = {
  masked: string;
  urlMap: Map<string, string>;
};

function maskHttpUrls(code: string): UrlMaskResult {
  const urlMap = new Map<string, string>();
  let counter = 0;

  const masked = code.replace(HTTP_URL_PATTERN, (match, quote, url) => {
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

export async function initLexer() {
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

  // Mask HTTP URLs to avoid es-module-lexer parse errors
  const { masked, urlMap } = maskHttpUrls(code);
  const [imports] = parse(masked);

  // If no URLs were masked, return as-is
  if (urlMap.size === 0) {
    return imports;
  }

  // Restore original URLs in import specifiers
  return imports.map((imp) => {
    if (imp.n) {
      const restoredN = unmaskHttpUrls(imp.n, urlMap);
      if (restoredN !== imp.n) {
        return { ...imp, n: restoredN };
      }
    }
    return imp;
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

  // Mask HTTP URLs to avoid es-module-lexer parse errors
  const { masked, urlMap } = maskHttpUrls(code);
  const [imports] = parse(masked);

  let result = masked;

  // Process in reverse order to maintain indices
  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;
    if (imp.n === undefined) continue;

    // Unmask the specifier for the replacer to see the original URL
    const originalSpecifier = unmaskHttpUrls(imp.n, urlMap);
    const replacement = replacer(originalSpecifier, imp.d > -1);

    if (replacement && replacement !== originalSpecifier) {
      // Replace only the specifier part [s, e]
      // imp.s and imp.e are indices in the masked string.
      // Since we modify 'result' from right to left, these indices are valid for 'result' too.
      const before = result.substring(0, imp.s);
      const after = result.substring(imp.e);
      result = before + replacement + after;
    }
  }

  // Unmask any remaining HTTP URLs that weren't replaced
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

  // Mask HTTP URLs to avoid es-module-lexer parse errors
  const { masked, urlMap } = maskHttpUrls(code);
  const [imports] = parse(masked);

  let result = masked;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;

    // Unmask the import specifier for the rewriter
    const unmaskedImp = imp.n
      ? { ...imp, n: unmaskHttpUrls(imp.n, urlMap) }
      : imp;

    // Extract the full statement from the masked code and unmask it
    const statement = unmaskHttpUrls(masked.substring(imp.ss, imp.se), urlMap);

    const replacement = rewriter(unmaskedImp, statement);

    if (replacement !== null) {
      const before = result.substring(0, imp.ss);
      const after = result.substring(imp.se);
      result = before + replacement + after;
    }
  }

  // Unmask any remaining HTTP URLs
  return unmaskHttpUrls(result, urlMap);
}
