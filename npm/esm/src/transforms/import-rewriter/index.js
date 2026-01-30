/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations in the codebase.
 * This module replaces the fragmented import rewriting implementations.
 *
 * @module transforms/import-rewriter
 */
export { classifySpecifier, isBareSpecifier, isReactSpecifier, isRelativeSpecifier, isUrlSpecifier, } from "./types.js";
// URL building utilities (centralized constants)
export { addEsmShDeps, buildCrossProjectUrl, buildEsmShUrl, buildModuleServerUrl, buildReactUrl, buildVeryfrontModuleUrl, CSSTYPE_VERSION, DEFAULT_REACT_VERSION, getReactImportMap, isEsmShUrl, normalizeExtension, TAILWIND_VERSION, } from "./url-builder.js";
// Parse cache utilities
export { applyRewrites, initLexer, parseAllImports, replaceSpecifiers, } from "./parse-cache.js";
// Main rewriter
export { defaultRewriter, rewriteImports, UnifiedImportRewriter, } from "./unified-rewriter.js";
// Individual strategies (for testing and customization)
export { AliasStrategy, aliasStrategy, BareStrategy, bareStrategy, CrossProjectStrategy, crossProjectStrategy, ImportMapStrategy, importMapStrategy, isCrossProjectImport, NodeBuiltinStrategy, nodeBuiltinStrategy, parseCrossProjectImport, ReactStrategy, reactStrategy, RelativeStrategy, relativeStrategy, resolveImportWithMap, UrlStrategy, urlStrategy, VendorStrategy, vendorStrategy, VeryfrontStrategy, veryfrontStrategy, } from "./strategies/index.js";
