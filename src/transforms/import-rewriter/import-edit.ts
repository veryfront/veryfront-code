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
  /** Dynamic imports whose specifier is an expression rather than a literal. */
  computedDynamicImports: Array<{
    start: number;
    end: number;
    dynamicImportStart: number;
  }>;
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
  const computedDynamicImports = rawImports
    .filter((imp) => imp.n === undefined && imp.d >= 0)
    .map((imp) => ({
      start: imp.s,
      end: imp.e,
      dynamicImportStart: imp.d,
    }));

  return {
    imports,
    computedDynamicImports,
    urlMap: new Map(),
    maskedCode: code,
  };
}

const COMPUTED_DYNAMIC_IMPORT_MARKER = "__vf_dependency_pinned__";

function buildComputedDynamicImportHelper(name: string, isSSR: boolean): string {
  return `
function ${name}(value, parentUrl, modulePath) {
  if (typeof value !== "string") return value;
  const isRelative = value.startsWith("./") || value.startsWith("../");
  const isProjectAlias = value.startsWith("@/");
  const isRootModule = value.startsWith("/_vf_modules/");
  const isAbsoluteUrl = /^https?:\\/\\//i.test(value) || value.startsWith("//");
  if (!isRelative && !isProjectAlias && !isRootModule && !isAbsoluteUrl) return value;

  try {
    const parent = new URL(parentUrl);
    const base = modulePath ? new URL(modulePath, parent.origin) : parent;
    const pathMatch = base.pathname.match(/^\\/_vf_modules\\/_pins\\/([^/]+)\\//);
    const queryPins = parent.searchParams.getAll("pins");
    const cacheKey = pathMatch
      ? decodeURIComponent(pathMatch[1])
      : queryPins.length === 1
      ? queryPins[0]
      : undefined;
    if (!cacheKey || !/^on:[A-Za-z0-9._-]+$/.test(cacheKey)) return value;

    const modulePrefix = "/_vf_modules/";
    const anchor = modulePrefix + "_pins/" + encodeURIComponent(cacheKey) + "/";
    const crossProjectMatch = base.pathname.match(
      /^\\/_vf_modules\\/_pins\\/[^/]+\\/(_cross\\/[^/]+\\/@\\/)/
    );
    const crossProjectRoot = crossProjectMatch
      ? anchor + crossProjectMatch[1]
      : undefined;
    if (isProjectAlias) {
      if (!crossProjectRoot) return value;
      const target = new URL(crossProjectRoot + value.slice(2), parent.origin);
      ${isSSR ? 'target.searchParams.set("ssr", "true");' : ""}
      return target.pathname.startsWith(crossProjectRoot)
        ? target.pathname + target.search + target.hash
        : modulePrefix + "_pins/invalid";
    }

    const target = new URL(value, isRelative ? base : parent);
    if (target.origin !== parent.origin) return value;
    if (!target.pathname.startsWith(modulePrefix)) return value;

    if (isRelative) {
      const requiredRoot = crossProjectRoot ?? anchor;
      ${isSSR ? 'target.searchParams.set("ssr", "true");' : ""}
      return target.pathname.startsWith(requiredRoot)
        ? target.pathname + target.search + target.hash
        : modulePrefix + "_pins/invalid";
    }

    let targetPath = target.pathname.slice(modulePrefix.length);
    if (targetPath.startsWith("_pins/")) {
      const existingKeyEnd = targetPath.indexOf("/", "_pins/".length);
      const encodedExistingKey = existingKeyEnd < 0
        ? targetPath.slice("_pins/".length)
        : targetPath.slice("_pins/".length, existingKeyEnd);
      let existingKey;
      try {
        existingKey = decodeURIComponent(encodedExistingKey);
      } catch {
        existingKey = undefined;
      }
      if (existingKey && /^on:[A-Za-z0-9._-]+$/.test(existingKey)) {
        if (existingKeyEnd < 0) return modulePrefix + "_pins/invalid";
        targetPath = targetPath.slice(existingKeyEnd + 1);
      }
    }
    target.pathname = anchor + targetPath;
    target.searchParams.delete("pins");
    ${isSSR ? 'target.searchParams.set("ssr", "true");' : ""}
    return target.pathname + target.search + target.hash;
  } catch {
    return value;
  }
}`.trim();
}

/**
 * Wrap computed browser imports without changing native import options.
 *
 * es-module-lexer 2.3 exposes `s..e` as the first-argument expression even
 * when a second import-options argument exists. Non-string values are returned
 * untouched so the native import operation retains responsibility for coercion.
 */
export function applyComputedDynamicImportPinning(
  parsed: ParsedImportEdits,
  modulePath?: string,
  options: { ssr?: boolean } = {},
): string {
  const pending = parsed.computedDynamicImports.filter((imp) =>
    !parsed.maskedCode
      .slice(imp.dynamicImportStart, imp.start)
      .includes(COMPUTED_DYNAMIC_IMPORT_MARKER)
  );
  if (pending.length === 0) return parsed.maskedCode;

  let helperName = "__veryfrontPinDynamicImport";
  while (parsed.maskedCode.includes(helperName)) helperName += "_";

  let result = parsed.maskedCode;
  for (const imported of pending.sort((left, right) => right.start - left.start)) {
    const expression = parsed.maskedCode.slice(imported.start, imported.end);
    const replacement = `/*${COMPUTED_DYNAMIC_IMPORT_MARKER}*/${helperName}(` +
      `${expression},import.meta.url,${modulePath ? JSON.stringify(modulePath) : "undefined"})`;
    result = result.slice(0, imported.start) + replacement + result.slice(imported.end);
  }

  result += `\n${buildComputedDynamicImportHelper(helperName, options.ssr === true)}\n`;
  return result;
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
