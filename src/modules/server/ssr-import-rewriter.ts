export type {
  SSRImportRewriteTarget,
  SSRRewriteOptions,
} from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
export {
  resolveSSRImportTargetModulePathCompat as resolveSSRImportTargetModulePath,
  rewriteSSRImportsCompatAsync as applySSRImportRewritesAsync,
  stripSSRModuleJsExtensionCompat as stripSSRModuleJsExtension,
} from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
