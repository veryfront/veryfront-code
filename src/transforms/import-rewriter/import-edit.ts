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

// Matches HTTP/HTTPS URLs in string literals (single, double, or backtick quotes)
const HTTP_URL_PATTERN = /(?<!\\)(['"`])(https?:\/\/[^'"`\n\\]+)\1/gi;

interface UrlMaskResult {
  masked: string;
  urlMap: Map<string, string>;
}

function maskHttpUrls(code: string): UrlMaskResult {
  const urlMap = new Map<string, string>();
  let counter = 0;

  const masked = code.replace(
    HTTP_URL_PATTERN,
    (_match, quote: string, url: string) => {
      let placeholder: string;
      do {
        placeholder = `__VFURL_${counter++}__`;
      } while (code.includes(placeholder) || urlMap.has(placeholder));
      urlMap.set(placeholder, url);
      return `${quote}${placeholder}${quote}`;
    },
  );

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
export interface ParsedImportEdits {
  /** All imports found in the code */
  imports: ImportSpecifierInfo[];
  /** Dynamic imports whose specifier is an expression rather than a literal. */
  computedDynamicImports: Array<{
    start: number;
    end: number;
    dynamicImportStart: number;
  }>;
  /** URL map for restoring masked HTTP URLs */
  urlMap: Map<string, string>;
  /** Original masked code (for position calculations) */
  maskedCode: string;
}

/**
 * Parse all imports from code using es-module-lexer.
 * Returns structured import info with position data.
 */
export async function parseImportEdits(code: string): Promise<ParsedImportEdits> {
  await initLexer();

  const { masked, urlMap } = maskHttpUrls(code);
  const rawImports = getLexer().parse(masked);

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
  const computedDynamicImports = rawImports
    .filter((imp) => imp.n === undefined && imp.d >= 0)
    .map((imp) => ({
      start: imp.s,
      end: imp.e,
      dynamicImportStart: imp.d,
    }));

  return { imports, computedDynamicImports, urlMap, maskedCode: masked };
}

const COMPUTED_DYNAMIC_IMPORT_MARKER = "__vf_dependency_pinned__";

function hasPrefixAt(value: string, prefix: string, offset: number): boolean {
  if (value.length - offset < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (value[offset + index] !== prefix[index]) return false;
  }
  return true;
}

function isSafeModuleServerPath(value: string, offset: number): boolean {
  const modulePrefix = "/_vf_modules/";
  if (!hasPrefixAt(value, modulePrefix, offset)) return false;

  let segmentStart = offset + 1;
  for (let index = offset; index <= value.length; index++) {
    const character = value[index];
    if (character === "\\") return false;
    if (character === "%") {
      const high = value[index + 1];
      const low = value[index + 2];
      const encodedDotOrSlash = high === "2" &&
        (low === "e" || low === "E" || low === "f" || low === "F");
      const encodedBackslash = high === "5" && (low === "c" || low === "C");
      if (encodedDotOrSlash || encodedBackslash) return false;
    }
    if (character === "?" || character === "#" || character === "/" || character === undefined) {
      const segmentLength = index - segmentStart;
      if (
        (segmentLength === 1 && value[segmentStart] === ".") ||
        (segmentLength === 2 && value[segmentStart] === "." && value[segmentStart + 1] === ".")
      ) return false;
      if (character === "?" || character === "#" || character === undefined) break;
      segmentStart = index + 1;
    }
  }
  return true;
}

/** Return whether an SSR import names a host filesystem path instead of the module server. */
export function isFilesystemImportSpecifier(value: string): boolean {
  const isFileUrl = value.length >= 5 &&
    (value[0] === "f" || value[0] === "F") &&
    (value[1] === "i" || value[1] === "I") &&
    (value[2] === "l" || value[2] === "L") &&
    (value[3] === "e" || value[3] === "E") &&
    value[4] === ":";
  if (isFileUrl || value[0] === "\\") return true;
  if (value[0] === "/") {
    if (value[1] !== "/") return !isSafeModuleServerPath(value, 0);
    let pathStart = 2;
    while (
      pathStart < value.length && value[pathStart] !== "/" &&
      value[pathStart] !== "\\" && value[pathStart] !== "?" && value[pathStart] !== "#"
    ) pathStart++;
    return !isSafeModuleServerPath(value, pathStart);
  }

  const first = value[0];
  const isDriveLetter = first !== undefined &&
    ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z"));
  return isDriveLetter && value[1] === ":" &&
    (value[2] === "/" || value[2] === "\\");
}

function restoreMaskedUrls(result: string, urlMap: Map<string, string>): string {
  if (urlMap.size === 0) return result;

  for (const [placeholder, url] of urlMap) {
    result = result.replaceAll(placeholder, url);
  }
  return result;
}

function buildComputedDynamicImportHelper(
  name: string,
  isSSR: boolean,
  guardFrameworkImports: boolean,
  guardFilesystemImports: boolean,
): string {
  const frameworkImportGuard = guardFrameworkImports
    ? `
  const specifier = typeof value === "string" ? value : \`\${value}\`;
  const frameworkPrefix = "#veryfront";
  let isFrameworkImport = specifier.length >= frameworkPrefix.length;
  for (let index = 0; isFrameworkImport && index < frameworkPrefix.length; index++) {
    if (specifier[index] !== frameworkPrefix[index]) isFrameworkImport = false;
  }
  if (isFrameworkImport) {
    const separator = specifier[frameworkPrefix.length];
    isFrameworkImport = separator === undefined || separator === "/" || separator === "\\\\" || separator === "%";
  }
  if (isFrameworkImport) {
    return ${name}RejectedSpecifier("Computed #veryfront imports must use a string literal");
  }
  if (${guardFilesystemImports} && ${name}IsFilesystemSpecifier(specifier)) {
    return ${name}RejectedSpecifier("Computed filesystem imports must use a string literal");
  }`
    : `
  const specifier = value;
  if (typeof specifier !== "string") return specifier;`;
  return `
function ${name}HasPrefixAt(value, prefix, offset) {
  if (value.length - offset < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (value[offset + index] !== prefix[index]) return false;
  }
  return true;
}
function ${name}HasPrefix(value, prefix) {
  return ${name}HasPrefixAt(value, prefix, 0);
}
function ${name}IsSafeModulePath(value, offset) {
  const modulePrefix = "/_vf_modules/";
  if (!${name}HasPrefixAt(value, modulePrefix, offset)) return false;

  let segmentStart = offset + 1;
  for (let index = offset; index <= value.length; index++) {
    const character = value[index];
    if (character === "\\\\") return false;
    if (character === "%") {
      const high = value[index + 1];
      const low = value[index + 2];
      const encodedDotOrSlash = high === "2" &&
        (low === "e" || low === "E" || low === "f" || low === "F");
      const encodedBackslash = high === "5" && (low === "c" || low === "C");
      if (encodedDotOrSlash || encodedBackslash) return false;
    }
    if (character === "?" || character === "#" || character === "/" || character === undefined) {
      const segmentLength = index - segmentStart;
      if (
        (segmentLength === 1 && value[segmentStart] === ".") ||
        (segmentLength === 2 && value[segmentStart] === "." && value[segmentStart + 1] === ".")
      ) return false;
      if (character === "?" || character === "#" || character === undefined) break;
      segmentStart = index + 1;
    }
  }
  return true;
}
function ${name}IsFilesystemSpecifier(value) {
  const isFileUrl = value.length >= 5 &&
    (value[0] === "f" || value[0] === "F") &&
    (value[1] === "i" || value[1] === "I") &&
    (value[2] === "l" || value[2] === "L") &&
    (value[3] === "e" || value[3] === "E") &&
    value[4] === ":";
  if (isFileUrl || value[0] === "\\\\") return true;
  if (value[0] === "/") {
    if (value[1] !== "/") return !${name}IsSafeModulePath(value, 0);
    let pathStart = 2;
    while (
      pathStart < value.length && value[pathStart] !== "/" &&
      value[pathStart] !== "\\\\" && value[pathStart] !== "?" && value[pathStart] !== "#"
    ) pathStart++;
    return !${name}IsSafeModulePath(value, pathStart);
  }

  const first = value[0];
  const isDriveLetter = first !== undefined &&
    ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z"));
  return isDriveLetter && value[1] === ":" &&
    (value[2] === "/" || value[2] === "\\\\");
}
${
    guardFrameworkImports
      ? `function ${name}RejectedSpecifier(message) {
  return {
    [Symbol.toPrimitive]() {
      throw new TypeError(message);
    },
  };
}`
      : ""
  }
function ${name}(value, parentUrl, modulePath) {
  ${frameworkImportGuard}
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const isProjectAlias = specifier.startsWith("@/");
  const isRootModule = specifier.startsWith("/_vf_modules/");
  const isAbsoluteUrl = /^https?:\\/\\//i.test(specifier) || specifier.startsWith("//");
  if (!isRelative && !isProjectAlias && !isRootModule && !isAbsoluteUrl) return specifier;

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
    if (!cacheKey || !/^on:[A-Za-z0-9._-]+$/.test(cacheKey)) return specifier;

    const modulePrefix = "/_vf_modules/";
    const anchor = modulePrefix + "_pins/" + encodeURIComponent(cacheKey) + "/";
    const crossProjectMatch = base.pathname.match(
      /^\\/_vf_modules\\/_pins\\/[^/]+\\/(_cross\\/[^/]+\\/@\\/)/
    );
    const crossProjectRoot = crossProjectMatch
      ? anchor + crossProjectMatch[1]
      : undefined;
    if (isProjectAlias) {
      if (!crossProjectRoot) return specifier;
      const target = new URL(crossProjectRoot + specifier.slice(2), parent.origin);
      ${isSSR ? 'target.searchParams.set("ssr", "true");' : ""}
      return target.pathname.startsWith(crossProjectRoot)
        ? target.pathname + target.search + target.hash
        : modulePrefix + "_pins/invalid";
    }

    const target = new URL(specifier, isRelative ? base : parent);
    if (target.origin !== parent.origin) return specifier;
    if (!target.pathname.startsWith(modulePrefix)) return specifier;

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
    return specifier;
  }
}`.trim();
}

/**
 * Guard computed framework imports and apply dependency pinning when enabled.
 *
 * es-module-lexer 2.3 exposes `s..e` as the first-argument expression even
 * when a second import-options argument exists. Values are coerced exactly once
 * so a caller-controlled coercion cannot present a public value to the guard and
 * a private value to the native import operation.
 */
export function applyComputedDynamicImportPinning(
  parsed: ParsedImportEdits,
  modulePath?: string,
  options: {
    ssr?: boolean;
    guardFrameworkImports?: boolean;
    guardFilesystemImports?: boolean;
  } = {},
): string {
  // A project can write the marker itself, so it is not proof that the
  // security guard came from this transformer. Re-wrap guarded imports on
  // every pass; nested guards are safe and keep forged markers fail-closed.
  const pending = parsed.computedDynamicImports.filter((imp) =>
    options.guardFrameworkImports === true ||
    !parsed.maskedCode
      .slice(imp.dynamicImportStart, imp.start)
      .includes(COMPUTED_DYNAMIC_IMPORT_MARKER)
  );
  if (pending.length === 0) return restoreMaskedUrls(parsed.maskedCode, parsed.urlMap);

  let helperName = "__veryfrontPinDynamicImport";
  while (parsed.maskedCode.includes(helperName)) helperName += "_";

  let result = parsed.maskedCode;
  for (const imported of pending.sort((left, right) => right.start - left.start)) {
    const expression = parsed.maskedCode.slice(imported.start, imported.end);
    const replacement = `/*${COMPUTED_DYNAMIC_IMPORT_MARKER}*/${helperName}(` +
      `${expression},import.meta.url,${modulePath ? JSON.stringify(modulePath) : "undefined"})`;
    result = result.slice(0, imported.start) + replacement + result.slice(imported.end);
  }

  result += `\n${
    buildComputedDynamicImportHelper(
      helperName,
      options.ssr === true,
      options.guardFrameworkImports === true,
      options.guardFilesystemImports === true,
    )
  }\n`;
  return restoreMaskedUrls(result, parsed.urlMap);
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

  return restoreMaskedUrls(result, parsed.urlMap);
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
