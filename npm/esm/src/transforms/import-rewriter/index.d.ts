/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations in the codebase.
 * This module replaces the fragmented import rewriting implementations.
 *
 * @module transforms/import-rewriter
 */
export type { ImportMapConfig, ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult, RewriteTarget, SpecifierType, } from "./types.js";
export { classifySpecifier, isBareSpecifier, isReactSpecifier, isRelativeSpecifier, isUrlSpecifier, } from "./types.js";
export { addEsmShDeps, buildCrossProjectUrl, buildEsmShUrl, buildModuleServerUrl, buildReactUrl, buildVeryfrontModuleUrl, CSSTYPE_VERSION, DEFAULT_REACT_VERSION, getReactImportMap, isEsmShUrl, normalizeExtension, TAILWIND_VERSION, } from "./url-builder.js";
export { applyRewrites, initLexer, parseAllImports, type ParsedImports, replaceSpecifiers, } from "./parse-cache.js";
export { defaultRewriter, rewriteImports, type RewriteOptions, UnifiedImportRewriter, } from "./unified-rewriter.js";
export { AliasStrategy, aliasStrategy, BareStrategy, bareStrategy, CrossProjectStrategy, crossProjectStrategy, ImportMapStrategy, importMapStrategy, isCrossProjectImport, NodeBuiltinStrategy, nodeBuiltinStrategy, parseCrossProjectImport, ReactStrategy, reactStrategy, RelativeStrategy, relativeStrategy, resolveImportWithMap, UrlStrategy, urlStrategy, VendorStrategy, vendorStrategy, VeryfrontStrategy, veryfrontStrategy, } from "./strategies/index.js";
//# sourceMappingURL=index.d.ts.map