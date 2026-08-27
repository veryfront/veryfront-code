/**
 * Import Rewriting Utilities for SSR Module Loader
 *
 * Pure functions that rewrite import specifiers in transformed code
 * to use hashed temp file paths (file:// URLs).
 *
 * @module module-system/react-loader/ssr-module-loader/import-rewriter
 */

import { replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";

const reflectApply = Reflect.apply;
const arrayJoin = Array.prototype.join;
const mapConstructor = Map;
const mapForEach = Map.prototype.forEach;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const regexpTest = RegExp.prototype.test;
const stringEndsWith = String.prototype.endsWith;
const stringLastIndexOf = String.prototype.lastIndexOf;
const stringReplace = String.prototype.replace;
const stringRepeat = String.prototype.repeat;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;
const stringSubstring = String.prototype.substring;

function startsWithString(value: string, prefix: string): boolean {
  return reflectApply(stringStartsWith, value, [prefix]) as boolean;
}

function substringString(value: string, start: number, end?: number): string {
  return reflectApply(
    stringSubstring,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function splitNonEmpty(value: string): string[] {
  const parts = reflectApply(stringSplit, value, ["/"]) as string[];
  const nonEmpty: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part) nonEmpty[nonEmpty.length] = part;
  }
  return nonEmpty;
}

function getMapValue(map: Map<string, string>, key: string): string | undefined {
  return reflectApply(mapGet, map, [key]) as string | undefined;
}

function setMapValue(map: Map<string, string>, key: string, value: string): void {
  reflectApply(mapSet, map, [key, value]);
}

/**
 * Rewrite a cross-project import specifier to use a local temp path.
 */
export async function rewriteCrossProjectImport(
  transformed: string,
  specifier: string,
  tempPath: string,
): Promise<string> {
  const jsSpecifier = toJsExtension(specifier);
  const replacement = `file://${tempPath}`;
  const replacements = new mapConstructor<string, string>();
  setMapValue(replacements, specifier, replacement);
  setMapValue(replacements, jsSpecifier, replacement);

  return await replaceSpecifiers(
    transformed,
    (importSpecifier) => getMapValue(replacements, importSpecifier) ?? null,
  );
}

/**
 * Rewrite local imports to use hashed temp paths.
 * This ensures each content version uses its own cached module file.
 */
export async function rewriteLocalImports(
  transformed: string,
  localImportPaths: Map<string, string>,
  fromFilePath: string,
  projectDir: string,
): Promise<string> {
  const normalizedProjectDir = reflectApply(stringReplace, projectDir, [/\/$/, ""]) as string;
  const lastSlash = reflectApply(stringLastIndexOf, fromFilePath, ["/"]) as number;
  const fromFileDir = substringString(fromFilePath, 0, lastSlash);
  const fromRelativeDir = startsWithString(fromFileDir, normalizedProjectDir)
    ? substringString(fromFileDir, normalizedProjectDir.length + 1)
    : fromFileDir;

  const replacements = new mapConstructor<string, string>();
  let replacementCount = 0;

  reflectApply(mapForEach, localImportPaths, [
    (tempPath: string, specifierOrPath: string) => {
      const patterns = buildImportPatterns(specifierOrPath, fromRelativeDir, normalizedProjectDir);

      for (let index = 0; index < patterns.length; index++) {
        const pattern = patterns[index]!;
        if (!(reflectApply(mapHas, replacements, [pattern]) as boolean)) {
          setMapValue(replacements, pattern, `file://${tempPath}`);
          replacementCount++;
        }
      }
    },
  ]);

  if (replacementCount === 0) return transformed;

  return await replaceSpecifiers(
    transformed,
    (importSpecifier) => getMapValue(replacements, importSpecifier) ?? null,
  );
}

/**
 * Build import patterns for a given specifier to match in transformed code.
 */
function buildImportPatterns(
  specifierOrPath: string,
  fromRelativeDir: string,
  projectDir: string,
): string[] {
  if (startsWithString(specifierOrPath, "file://")) {
    return [specifierOrPath];
  }

  if (startsWithString(specifierOrPath, "@/")) {
    return buildAliasImportPatterns(specifierOrPath, fromRelativeDir);
  }

  if (startsWithString(specifierOrPath, "/") || startsWithString(specifierOrPath, projectDir)) {
    return buildAbsoluteImportPatterns(specifierOrPath, fromRelativeDir, projectDir);
  }

  if (startsWithString(specifierOrPath, "./") || startsWithString(specifierOrPath, "../")) {
    return buildRelativeImportPatterns(specifierOrPath);
  }

  return [];
}

function buildAliasImportPatterns(specifier: string, fromRelativeDir: string): string[] {
  const aliasPath = substringString(specifier, 2); // Remove @/
  const depth = splitNonEmpty(fromRelativeDir).length;
  const relativePrefix = depth === 0 ? "./" : reflectApply(stringRepeat, "../", [depth]) as string;
  const compiledAliasPath = reflectApply(regexpTest, /\.(tsx?|jsx|mdx)$/, [aliasPath]) as boolean
    ? toJsExtension(aliasPath)
    : reflectApply(regexpTest, /\.(mjs|cjs|css)$/, [aliasPath]) as boolean
    ? aliasPath
    : `${aliasPath}.js`;
  const patterns = [
    specifier,
    `${relativePrefix}${compiledAliasPath}`,
    `/_vf_modules/${compiledAliasPath}`,
    `_vf_modules/${compiledAliasPath}`,
  ];
  return patterns;
}

function buildAbsoluteImportPatterns(
  absolutePath: string,
  fromRelativeDir: string,
  projectDir: string,
): string[] {
  const depRelativePath = startsWithString(absolutePath, projectDir)
    ? substringString(absolutePath, projectDir.length + 1)
    : substringString(absolutePath, 1);

  const lastSlash = reflectApply(stringLastIndexOf, depRelativePath, ["/"]) as number;
  const depDir = substringString(depRelativePath, 0, lastSlash);
  const depFile = substringString(depRelativePath, lastSlash + 1);

  const relativePath = computeRelativePath(fromRelativeDir, depDir, depFile);
  return [toJsExtension(relativePath)];
}

function buildRelativeImportPatterns(specifier: string): string[] {
  const jsPath = toJsExtension(specifier);
  const patterns = [jsPath];

  if (!(reflectApply(stringEndsWith, jsPath, [".js"]) as boolean)) {
    patterns[patterns.length] = `${jsPath}.js`;
  }

  return patterns;
}

/**
 * Compute relative path from source directory to target file.
 */
function computeRelativePath(fromDir: string, toDir: string, fileName: string): string {
  const fromParts = splitNonEmpty(fromDir);
  const toParts = splitNonEmpty(toDir);

  let commonPrefixLen = 0;
  while (
    commonPrefixLen < fromParts.length &&
    commonPrefixLen < toParts.length &&
    fromParts[commonPrefixLen] === toParts[commonPrefixLen]
  ) {
    commonPrefixLen++;
  }

  const upCount = fromParts.length - commonPrefixLen;
  const downParts: string[] = [];
  for (let index = commonPrefixLen; index < toParts.length; index++) {
    downParts[downParts.length] = toParts[index]!;
  }

  if (upCount === 0 && downParts.length === 0) return `./${fileName}`;
  const downPath = reflectApply(arrayJoin, downParts, ["/"]) as string;
  if (upCount === 0) return `./${downPath}/${fileName}`;

  const upPath = reflectApply(stringRepeat, "../", [upCount]) as string;
  return `${upPath}${downParts.length > 0 ? `${downPath}/` : ""}${fileName}`;
}

/**
 * Convert TypeScript/JSX extension to .js
 */
function toJsExtension(path: string): string {
  return reflectApply(stringReplace, path, [/\.(tsx?|jsx|mdx)$/, ".js"]) as string;
}
