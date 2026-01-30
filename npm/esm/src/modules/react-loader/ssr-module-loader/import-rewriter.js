/**
 * Import Rewriting Utilities for SSR Module Loader
 *
 * Pure functions that rewrite import specifiers in transformed code
 * to use hashed temp file paths (file:// URLs).
 *
 * @module module-system/react-loader/ssr-module-loader/import-rewriter
 */
/**
 * Rewrite a cross-project import specifier to use a local temp path.
 */
export function rewriteCrossProjectImport(transformed, specifier, tempPath) {
    const jsSpecifier = specifier.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedJsSpecifier = jsSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`from\\s*["'](${escapedSpecifier}|${escapedJsSpecifier})["']`, "g");
    return transformed.replace(pattern, `from "file://${tempPath}"`);
}
/**
 * Rewrite local imports to use hashed temp paths.
 * This ensures each content version uses its own cached module file.
 */
export function rewriteLocalImports(transformed, localImportPaths, fromFilePath, projectDir) {
    if (localImportPaths.size === 0)
        return transformed;
    const normalizedProjectDir = projectDir.replace(/\/$/, "");
    const fromFileDir = fromFilePath.substring(0, fromFilePath.lastIndexOf("/"));
    const fromRelativeDir = fromFileDir.startsWith(normalizedProjectDir)
        ? fromFileDir.substring(normalizedProjectDir.length + 1)
        : fromFileDir;
    let result = transformed;
    for (const [specifierOrPath, tempPath] of localImportPaths.entries()) {
        const patterns = buildImportPatterns(specifierOrPath, fromRelativeDir, normalizedProjectDir);
        for (const pattern of patterns) {
            const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`from\\s*["'](${escapedPattern})["']`, "g");
            result = result.replace(regex, `from "file://${tempPath}"`);
        }
    }
    return result;
}
/**
 * Build import patterns for a given specifier to match in transformed code.
 */
function buildImportPatterns(specifierOrPath, fromRelativeDir, projectDir) {
    // Handle @/ alias imports (e.g., @/components/Welcome)
    if (specifierOrPath.startsWith("@/")) {
        return buildAliasImportPatterns(specifierOrPath, fromRelativeDir);
    }
    // Handle absolute paths
    if (specifierOrPath.startsWith("/") || specifierOrPath.startsWith(projectDir)) {
        return buildAbsoluteImportPatterns(specifierOrPath, fromRelativeDir, projectDir);
    }
    // Handle relative imports (./foo, ../foo)
    if (specifierOrPath.startsWith("./") || specifierOrPath.startsWith("../")) {
        return buildRelativeImportPatterns(specifierOrPath);
    }
    return [];
}
function buildAliasImportPatterns(specifier, fromRelativeDir) {
    const aliasPath = specifier.substring(2); // Remove @/
    const depth = fromRelativeDir.split("/").filter(Boolean).length;
    const relativePrefix = depth === 0 ? "./" : "../".repeat(depth);
    const patterns = [`${relativePrefix}${aliasPath}.js`];
    // Handle paths that already have an extension
    if (/\.(tsx?|jsx|mdx)$/.test(aliasPath)) {
        patterns.push(`${relativePrefix}${toJsExtension(aliasPath)}`);
    }
    return patterns;
}
function buildAbsoluteImportPatterns(absolutePath, fromRelativeDir, projectDir) {
    const depRelativePath = absolutePath.startsWith(projectDir)
        ? absolutePath.substring(projectDir.length + 1)
        : absolutePath.substring(1);
    const lastSlash = depRelativePath.lastIndexOf("/");
    const depDir = depRelativePath.substring(0, lastSlash);
    const depFile = depRelativePath.substring(lastSlash + 1);
    const relativePath = computeRelativePath(fromRelativeDir, depDir, depFile);
    return [toJsExtension(relativePath)];
}
function buildRelativeImportPatterns(specifier) {
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
function computeRelativePath(fromDir, toDir, fileName) {
    const fromParts = fromDir.split("/").filter(Boolean);
    const toParts = toDir.split("/").filter(Boolean);
    let commonPrefixLen = 0;
    while (commonPrefixLen < fromParts.length &&
        commonPrefixLen < toParts.length &&
        fromParts[commonPrefixLen] === toParts[commonPrefixLen]) {
        commonPrefixLen++;
    }
    const upCount = fromParts.length - commonPrefixLen;
    const downParts = toParts.slice(commonPrefixLen);
    if (upCount === 0 && downParts.length === 0) {
        return `./${fileName}`;
    }
    if (upCount === 0) {
        return `./${downParts.join("/")}/${fileName}`;
    }
    const upPath = "../".repeat(upCount);
    const downPath = downParts.length > 0 ? `${downParts.join("/")}/` : "";
    return `${upPath}${downPath}${fileName}`;
}
/**
 * Convert TypeScript/JSX extension to .js
 */
function toJsExtension(path) {
    return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
}
