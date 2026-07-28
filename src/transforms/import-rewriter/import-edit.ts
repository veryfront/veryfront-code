/****
 * Lexer-bounded import edit primitives.
 *
 * Single parse per file - reused across all strategies.
 * This eliminates redundant parsing that happened with the fragmented system.
 */

import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import type { ImportSpecifierInfo } from "./types.ts";
import type { ImportSpecifier } from "../esm/lexer.ts";

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
export interface ParsedImportEdits {
  /** All imports found in the code */
  imports: ImportSpecifierInfo[];
  /**
   * @deprecated HTTP URLs are parsed directly. Retained as an empty map for
   * compatibility with callers compiled against the earlier result shape.
   */
  urlMap: Map<string, string>;
  /**
   * Source code indexed by the import positions.
   *
   * The historical name is retained for API compatibility; the source is no
   * longer masked.
   */
  maskedCode: string;
}

/**
 * Parse all imports from code using es-module-lexer.
 * Returns structured import info with position data.
 */
export async function parseImportEdits(code: string): Promise<ParsedImportEdits> {
  await initLexer();

  const rawImports = getLexer().parse(code);

  const imports: ImportSpecifierInfo[] = rawImports
    .filter((imp) => imp.n !== undefined)
    .map((imp) => ({
      specifier: imp.n!,
      isDynamic: imp.d > -1,
      start: imp.s,
      end: imp.e,
      statementStart: imp.ss,
      statementEnd: imp.se,
      raw: imp as ImportSpecifier,
    }));

  return { imports, urlMap: new Map(), maskedCode: code };
}

/**
 * Apply import rewrites to code.
 *
 * Takes the parsed imports and a map of specifier -> replacement.
 * Applies replacements from end to start to preserve positions.
 *
 * Positions from the module lexer index directly into `parsed.maskedCode`.
 * Despite its compatibility-preserving name, that field contains the original
 * unmasked source.
 */
export function applyImportEdits(
  parsed: ParsedImportEdits,
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

  return result;
}

/**
 * Simple specifier replacement (for strategies that don't need full statement control).
 */
export async function replaceImportSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string> {
  const parsed = await parseImportEdits(code);
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

  return applyImportEdits(parsed, rewrites);
}

/**
 * The range holding everything a specifier declares after its own text: the
 * `with` clause of a static import, or the options argument of a dynamic one.
 *
 * The range is empty when the import declares no attributes.
 */
export function importAttributeRange(imp: ImportSpecifier): { start: number; end: number } {
  // Static: `e` indexes the closing quote and `se` ends the statement before
  // any semicolon, so the clause and its keyword lie between them.
  if (imp.d === -1) return { start: imp.e + 1, end: imp.se };

  // Dynamic: `e` is already past the closing quote and `se` is past the
  // closing paren, so the comma and the options argument lie between them.
  return { start: imp.e, end: imp.se - 1 };
}
