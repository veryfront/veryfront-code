export type {
  SSRImportRewriteTarget,
  SSRRewriteOptions,
} from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
export {
  resolveSSRImportTargetModulePathCompat as resolveSSRImportTargetModulePath,
  rewriteSSRImportsCompat as applySSRImportRewrites,
  rewriteSSRImportsCompatAsync as applySSRImportRewritesAsync,
  stripSSRModuleJsExtensionCompat as stripSSRModuleJsExtension,
} from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
