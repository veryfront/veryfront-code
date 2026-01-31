/**
 * Import Rewriting Utilities for SSR Module Loader
 *
 * Pure functions that rewrite import specifiers in transformed code
 * to use hashed temp file paths (file:// URLs).
 *
 * @module module-system/react-loader/ssr-module-loader/import-rewriter
 */

const IMPORT_FROM_PREFIX = "from\\s*[\"']";
const IMPORT_FROM_SUFFIX = "[\"']";
const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(value: string): string {
  return value.replace(REGEX_ESCAPE, "\\$&");
}

/**
 * Rewrite a cross-project import specifier to use a local temp path.
 */
export function rewriteCrossProjectImport(
  transformed: string,
  specifier: string,
  tempPath: string,
): string {
  const jsSpecifier = toJsExtension(specifier);
  const escapedSpecifier = escapeRegExp(specifier);
  const escapedJsSpecifier = escapeRegExp(jsSpecifier);
  const pattern = new RegExp(
    `${IMPORT_FROM_PREFIX}(${escapedSpecifier}|${escapedJsSpecifier})${IMPORT_FROM_SUFFIX}`,
    "g",
  );

  return transformed.replace(pattern, `from "file://${tempPath}"`);
}

/**
 * Rewrite local imports to use hashed temp paths.
 * This ensures each content version uses its own cached module file.
 */
export function rewriteLocalImports(
  transformed: string,
  localImportPaths: Map<string, string>,
  fromFilePath: string,
  projectDir: string,
): string {
  if (localImportPaths.size === 0) return transformed;

  const normalizedProjectDir = projectDir.replace(/\/$/, "");
  const fromFileDir = fromFilePath.substring(0, fromFilePath.lastIndexOf("/"));
  const fromRelativeDir = fromFileDir.startsWith(normalizedProjectDir)
    ? fromFileDir.substring(normalizedProjectDir.length + 1)
    : fromFileDir;

  let result = transformed;

  for (const [specifierOrPath, tempPath] of localImportPaths) {
    const patterns = buildImportPatterns(specifierOrPath, fromRelativeDir, normalizedProjectDir);

    for (const pattern of patterns) {
      const escapedPattern = escapeRegExp(pattern);
      const regex = new RegExp(
        `${IMPORT_FROM_PREFIX}(${escapedPattern})${IMPORT_FROM_SUFFIX}`,
        "g",
      );
      result = result.replace(regex, `from "file://${tempPath}"`);
    }
  }

  return result;
}

/**
 * Build import patterns for a given specifier to match in transformed code.
 */
function buildImportPatterns(
  specifierOrPath: string,
  fromRelativeDir: string,
  projectDir: string,
): string[] {
  if (specifierOrPath.startsWith("@/")) {
    return buildAliasImportPatterns(specifierOrPath, fromRelativeDir);
  }

  if (specifierOrPath.startsWith("/") || specifierOrPath.startsWith(projectDir)) {
    return buildAbsoluteImportPatterns(specifierOrPath, fromRelativeDir, projectDir);
  }

  if (specifierOrPath.startsWith("./") || specifierOrPath.startsWith("../")) {
    return buildRelativeImportPatterns(specifierOrPath);
  }

  return [];
}

function buildAliasImportPatterns(specifier: string, fromRelativeDir: string): string[] {
  const aliasPath = specifier.substring(2); // Remove @/
  const depth = fromRelativeDir.split("/").filter(Boolean).length;
  const relativePrefix = depth === 0 ? "./" : "../".repeat(depth);

  const patterns = [`${relativePrefix}${aliasPath}.js`];

  if (/\.(tsx?|jsx|mdx)$/.test(aliasPath)) {
    patterns.push(`${relativePrefix}${toJsExtension(aliasPath)}`);
  }

  return patterns;
}

function buildAbsoluteImportPatterns(
  absolutePath: string,
  fromRelativeDir: string,
  projectDir: string,
): string[] {
  const depRelativePath = absolutePath.startsWith(projectDir)
    ? absolutePath.substring(projectDir.length + 1)
    : absolutePath.substring(1);

  const lastSlash = depRelativePath.lastIndexOf("/");
  const depDir = depRelativePath.substring(0, lastSlash);
  const depFile = depRelativePath.substring(lastSlash + 1);

  const relativePath = computeRelativePath(fromRelativeDir, depDir, depFile);
  return [toJsExtension(relativePath)];
}

function buildRelativeImportPatterns(specifier: string): string[] {
  const jsPath = toJsExtension(specifier);
  const patterns = [jsPath];

  if (!jsPath.endsWith(".js")) {
    patterns.push(`${jsPath}.js`);
  }

  return patterns;
}

/**
 * Compute relative path from source directory to target file.
 */
function computeRelativePath(fromDir: string, toDir: string, fileName: string): string {
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = toDir.split("/").filter(Boolean);

  let commonPrefixLen = 0;
  while (
    commonPrefixLen < fromParts.length &&
    commonPrefixLen < toParts.length &&
    fromParts[commonPrefixLen] === toParts[commonPrefixLen]
  ) {
    commonPrefixLen++;
  }

  const upCount = fromParts.length - commonPrefixLen;
  const downParts = toParts.slice(commonPrefixLen);

  if (upCount === 0 && downParts.length === 0) return `./${fileName}`;
  if (upCount === 0) return `./${downParts.join("/")}/${fileName}`;

  const upPath = "../".repeat(upCount);
  const downPath = downParts.length > 0 ? `${downParts.join("/")}/` : "";
  return `${upPath}${downPath}${fileName}`;
}

/**
 * Convert TypeScript/JSX extension to .js
 */
function toJsExtension(path: string): string {
  return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
}
