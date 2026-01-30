/**
 * Parse cache for es-module-lexer.
 *
 * Single parse per file - reused across all strategies.
 * This eliminates redundant parsing that happened with the fragmented system.
 */

import { init, parse } from "es-module-lexer";
import type { ImportSpecifierInfo } from "./types.js";
import type { ImportSpecifier } from "../esm/lexer.js";

let initPromise: Promise<void> | null = null;

/**
 * Initialize es-module-lexer (must be called before parsing).
 */
export async function initLexer(): Promise<void> {
  if (!initPromise) {
    const anyInit = init as unknown;
    initPromise = typeof anyInit === "function"
      ? (anyInit as () => Promise<void>)()
      : (anyInit as Promise<void>);
  }
  await initPromise;
}

// Matches HTTP/HTTPS URLs in string literals (single, double, or backtick quotes)
const HTTP_URL_PATTERN = /(?<!\\)(['"`])(https?:\/\/[^'"`\n\\]+)\1/g;

interface UrlMaskResult {
  masked: string;
  urlMap: Map<string, string>;
}

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

function unmaskUrl(specifier: string, urlMap: Map<string, string>): string {
  if (urlMap.size === 0) return specifier;
  for (const [placeholder, url] of urlMap) {
    if (specifier.includes(placeholder)) {
      return specifier.replace(placeholder, url);
    }
  }
  return specifier;
}

/**
 * Parsed import information with position data.
 */
export interface ParsedImports {
  /** All imports found in the code */
  imports: ImportSpecifierInfo[];
  /** URL map for restoring masked HTTP URLs */
  urlMap: Map<string, string>;
  /** Original masked code (for position calculations) */
  maskedCode: string;
}

/**
 * Parse all imports from code using es-module-lexer.
 * Returns structured import info with position data.
 */
export async function parseAllImports(code: string): Promise<ParsedImports> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);
  const [rawImports] = parse(masked);

  const imports: ImportSpecifierInfo[] = rawImports
    .filter((imp) => imp.n !== undefined)
    .map((imp) => ({
      specifier: unmaskUrl(imp.n!, urlMap),
      isDynamic: imp.d > -1,
      start: imp.s,
      end: imp.e,
      statementStart: imp.ss,
      statementEnd: imp.se,
      raw: imp as ImportSpecifier,
    }));

  return { imports, urlMap, maskedCode: masked };
}

/**
 * Apply import rewrites to code.
 *
 * Takes the parsed imports and a map of specifier -> replacement.
 * Applies replacements from end to start to preserve positions.
 *
 * IMPORTANT: Positions from es-module-lexer are relative to the masked code
 * (HTTP URLs replaced with short placeholders). We must apply rewrites to the
 * masked code first, then unmask the final result to restore any untouched URLs.
 */
export function applyRewrites(
  _code: string,
  parsed: ParsedImports,
  rewrites: Map<number, { specifier?: string | null; statement?: string }>,
): string {
  // Work on masked code since positions are from the masked parse
  let result = parsed.maskedCode;

  // Sort by start position descending to apply from end to start
  const sortedIndices = Array.from(rewrites.keys()).sort((a, b) => {
    const impA = parsed.imports[a];
    const impB = parsed.imports[b];
    return (impB?.start ?? 0) - (impA?.start ?? 0);
  });

  for (const idx of sortedIndices) {
    const imp = parsed.imports[idx];
    const rewrite = rewrites.get(idx);
    if (!imp || !rewrite) continue;

    if (rewrite.statement !== undefined) {
      // Replace entire statement
      result = result.substring(0, imp.statementStart) +
        rewrite.statement +
        result.substring(imp.statementEnd);
    } else if (rewrite.specifier !== null && rewrite.specifier !== undefined) {
      // Replace just the specifier
      if (imp.isDynamic) {
        // For dynamic imports, preserve the quote style
        const quote = result[imp.start];
        if (quote === '"' || quote === "'" || quote === "`") {
          result = result.substring(0, imp.start) +
            quote +
            rewrite.specifier +
            quote +
            result.substring(imp.end);
        } else {
          result = result.substring(0, imp.start) +
            rewrite.specifier +
            result.substring(imp.end);
        }
      } else {
        result = result.substring(0, imp.start) +
          rewrite.specifier +
          result.substring(imp.end);
      }
    }
  }

  // Restore any remaining masked URLs that weren't rewritten
  if (parsed.urlMap.size > 0) {
    for (const [placeholder, url] of parsed.urlMap) {
      result = result.replaceAll(placeholder, url);
    }
  }

  return result;
}

/**
 * Simple specifier replacement (for strategies that don't need full statement control).
 */
export async function replaceSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string> {
  const parsed = await parseAllImports(code);
  const rewrites = new Map<number, { specifier?: string | null }>();

  for (let i = 0; i < parsed.imports.length; i++) {
    const imp = parsed.imports[i]!;
    const replacement = replacer(imp.specifier, imp.isDynamic);
    if (replacement !== null && replacement !== undefined && replacement !== imp.specifier) {
      rewrites.set(i, { specifier: replacement });
    }
  }

  if (rewrites.size === 0) return code;

  return applyRewrites(code, parsed, rewrites);
}
