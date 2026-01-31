/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations in the codebase.
 * This module replaces the fragmented import rewriting implementations.
 *
 * @module transforms/import-rewriter
 */

export type {
  ImportMapConfig,
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
  RewriteTarget,
  SpecifierType,
} from "./types.ts";

export {
  classifySpecifier,
  isBareSpecifier,
  isReactSpecifier,
  isRelativeSpecifier,
  isUrlSpecifier,
} from "./types.ts";

export {
  addEsmShDeps,
  buildCrossProjectUrl,
  buildEsmShUrl,
  buildModuleServerUrl,
  buildReactUrl,
  buildVeryfrontModuleUrl,
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  getReactImportMap,
  isEsmShUrl,
  normalizeExtension,
  TAILWIND_VERSION,
} from "./url-builder.ts";

export {
  applyRewrites,
  initLexer,
  parseAllImports,
  type ParsedImports,
  replaceSpecifiers,
} from "./parse-cache.ts";

export {
  defaultRewriter,
  rewriteImports,
  type RewriteOptions,
  UnifiedImportRewriter,
} from "./unified-rewriter.ts";

export {
  AliasStrategy,
  aliasStrategy,
  BareStrategy,
  bareStrategy,
  CrossProjectStrategy,
  crossProjectStrategy,
  ImportMapStrategy,
  importMapStrategy,
  isCrossProjectImport,
  NodeBuiltinStrategy,
  nodeBuiltinStrategy,
  parseCrossProjectImport,
  ReactStrategy,
  reactStrategy,
  RelativeStrategy,
  relativeStrategy,
  resolveImportWithMap,
  UrlStrategy,
  urlStrategy,
  VendorStrategy,
  vendorStrategy,
  VeryfrontStrategy,
  veryfrontStrategy,
} from "./strategies/index.ts";
