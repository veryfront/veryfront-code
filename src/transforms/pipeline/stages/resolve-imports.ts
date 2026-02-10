/**
 * Unified import resolution pipeline stage.
 *
 * Replaces: resolve-aliases, resolve-react, resolve-relative, resolve-bare
 * Uses the unified import rewriter for all import transformations.
 */

import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { type RewriteContext, rewriteImports } from "../../import-rewriter/index.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

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

  if (ctx.target !== "ssr") return rewriteCtx;

  const cachedMap = ctx.metadata.get("importMap") as RewriteContext["importMap"] | undefined;
  if (cachedMap) {
    rewriteCtx.importMap = cachedMap;
    return rewriteCtx;
  }

  const importMap = await loadImportMap(ctx.projectDir);
  ctx.metadata.set("importMap", importMap);
  rewriteCtx.importMap = importMap;

  return rewriteCtx;
}

export const resolveImportsPlugin: TransformPlugin = {
  name: "resolve-imports",
  stage: TransformStage.RESOLVE_ALIASES,

  async transform(ctx: TransformContext): Promise<string> {
    const rewriteCtx = await buildRewriteContext(ctx);
    return rewriteImports(ctx.code, rewriteCtx);
  },
};
