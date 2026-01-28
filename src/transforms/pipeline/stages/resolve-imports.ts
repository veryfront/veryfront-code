/**
 * Unified import resolution pipeline stage.
 *
 * Replaces: resolve-aliases, resolve-react, resolve-relative, resolve-bare
 * Uses the unified import rewriter for all import transformations.
 */

import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { type RewriteContext, rewriteImports } from "../../import-rewriter/index.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Build RewriteContext from TransformContext.
 */
async function buildRewriteContext(ctx: TransformContext): Promise<RewriteContext> {
  const rewriteCtx: RewriteContext = {
    filePath: ctx.filePath,
    projectDir: ctx.projectDir,
    projectId: ctx.projectId,
    target: ctx.target,
    dev: ctx.dev,
    moduleServerUrl: ctx.moduleServerUrl,
    vendorBundleHash: ctx.vendorBundleHash,
    apiBaseUrl: ctx.apiBaseUrl,
    reactVersion: ctx.reactVersion,
  };

  // Load import map for SSR transforms
  if (ctx.target === "ssr") {
    const cachedMap = ctx.metadata.get("importMap") as RewriteContext["importMap"] | undefined;
    if (cachedMap) {
      rewriteCtx.importMap = cachedMap;
    } else {
      const importMap = await loadImportMap(ctx.projectDir);
      ctx.metadata.set("importMap", importMap);
      rewriteCtx.importMap = importMap;
    }
  }

  return rewriteCtx;
}

/**
 * Unified import resolution plugin.
 *
 * This single plugin handles all import rewrites:
 * - React imports → esm.sh URLs
 * - @/ aliases → relative paths
 * - #veryfront/* → module server URLs (browser) or keep (SSR)
 * - Relative imports → resolved paths with .js extension
 * - Cross-project imports → module server URLs
 * - Bare npm imports → esm.sh URLs (browser) or import map (SSR)
 * - Vendor bundle → React from vendor.js (browser with vendor hash)
 */
export const resolveImportsPlugin: TransformPlugin = {
  name: "resolve-imports",
  stage: TransformStage.RESOLVE_ALIASES, // Run at first resolve stage

  async transform(ctx: TransformContext): Promise<string> {
    const rewriteCtx = await buildRewriteContext(ctx);
    return rewriteImports(ctx.code, rewriteCtx);
  },
};

export default resolveImportsPlugin;
