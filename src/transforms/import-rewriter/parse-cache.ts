/****
 * Parse cache for es-module-lexer.
 *
 * Single parse per file - reused across all strategies.
 * This eliminates redundant parsing that happened with the fragmented system.
 */

import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import type { ImportSpecifierInfo } from "./types.ts";
import type { ImportSpecifier } from "../esm/lexer.ts";
import { maskHttpUrls, unmaskHttpUrls } from "../esm/http-url-mask.ts";

let initPromise: Promise<void> | null = null;

function getLexer(): ModuleLexer {
  return resolveContract<ModuleLexer>("ModuleLexer");
}

/**
 * Initialize the ModuleLexer (must be called before parsing).
 */
export async function initLexer(): Promise<void> {
  if (!initPromise) {
    const lexer = getLexer();
    initPromise = lexer.init ? lexer.init() : Promise.resolve();
  }

  await initPromise;
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
  const rawImports = getLexer().parse(masked);

  const imports: ImportSpecifierInfo[] = rawImports
    .filter((imp) => imp.n !== undefined)
    .map((imp) => ({
      specifier: unmaskHttpUrls(imp.n!, urlMap),
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
  let result = parsed.maskedCode;

  const sortedIndices = Array.from(rewrites.keys()).sort((a, b) => {
    const startA = parsed.imports[a]?.start ?? 0;
    const startB = parsed.imports[b]?.start ?? 0;
    return startB - startA;
  });

  for (const idx of sortedIndices) {
    const imp = parsed.imports[idx];
    const rewrite = rewrites.get(idx);
    if (!imp || !rewrite) continue;

    if (rewrite.statement !== undefined) {
      result = result.substring(0, imp.statementStart) +
        rewrite.statement +
        result.substring(imp.statementEnd);
      continue;
    }

    const specifier = rewrite.specifier;
    if (specifier === null || specifier === undefined) continue;

    if (!imp.isDynamic) {
      result = result.substring(0, imp.start) + specifier + result.substring(imp.end);
      continue;
    }

    const quote = result[imp.start];
    if (quote === `"` || quote === `'` || quote === "`") {
      result = result.substring(0, imp.start) +
        quote +
        specifier +
        quote +
        result.substring(imp.end);
      continue;
    }

    result = result.substring(0, imp.start) + specifier + result.substring(imp.end);
  }

  if (parsed.urlMap.size === 0) return result;

  return unmaskHttpUrls(result, parsed.urlMap);
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

    if (
      replacement !== null &&
      replacement !== undefined &&
      replacement !== imp.specifier
    ) {
      rewrites.set(i, { specifier: replacement });
    }
  }

  if (rewrites.size === 0) return code;

  return applyRewrites(code, parsed, rewrites);
}
