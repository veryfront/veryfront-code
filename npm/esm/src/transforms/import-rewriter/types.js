/**
 * Unified import rewriting types.
 *
 * This module defines the strategy pattern interface for import rewriting.
 * All import transformations go through this unified system.
 */
/**
 * Classify a specifier for strategy matching.
 */
export function classifySpecifier(specifier) {
    // React and React-DOM packages
    if (specifier === "react" ||
        specifier === "react-dom" ||
        specifier.startsWith("react/") ||
        specifier.startsWith("react-dom/")) {
        return "react";
    }
    // URL imports (esm.sh, CDN, etc.)
    if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
        return "url";
    }
    // Veryfront framework imports
    if (specifier.startsWith("#veryfront/") ||
        specifier.startsWith("veryfront/") ||
        specifier.startsWith("@veryfront/") ||
        specifier === "veryfront" ||
        specifier === "@veryfront") {
        return "veryfront";
    }
    // Path alias imports
    if (specifier.startsWith("@/")) {
        return "alias";
    }
    // Relative imports
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return "relative";
    }
    // Cross-project imports (project@version/@/path or project/@/path)
    if (/^[a-z0-9-]+(?:@[\d^~x][\d.x^~-]*)?\/@\//.test(specifier)) {
        return "cross-project";
    }
    // Bare specifiers (npm packages)
    return "bare";
}
/**
 * Check if specifier is a React package.
 */
export function isReactSpecifier(specifier) {
    return classifySpecifier(specifier) === "react";
}
/**
 * Check if specifier is a relative import.
 */
export function isRelativeSpecifier(specifier) {
    return classifySpecifier(specifier) === "relative";
}
/**
 * Check if specifier is a bare npm package.
 */
export function isBareSpecifier(specifier) {
    return classifySpecifier(specifier) === "bare";
}
/**
 * Check if specifier is a URL.
 */
export function isUrlSpecifier(specifier) {
    return classifySpecifier(specifier) === "url";
}
