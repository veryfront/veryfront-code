/**
 * Unified import resolution pipeline stage.
 *
 * Replaces: resolve-aliases, resolve-react, resolve-relative, resolve-bare
 * Uses the unified import rewriter for all import transformations.
 */

import { stripJsonImportAttributes } from "../../esm/import-attributes.ts";
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

  if (!ctx.importMap) {
    throw new Error("SSR transform context is missing its import-map snapshot");
  }
  rewriteCtx.importMap = ctx.importMap;

  return rewriteCtx;
}

export const resolveImportsPlugin: TransformPlugin = {
  name: "resolve-imports",
  stage: TransformStage.RESOLVE_ALIASES,

  async transform(ctx: TransformContext): Promise<string> {
    const rewriteCtx = await buildRewriteContext(ctx);
    const code = await rewriteImports(ctx.code, rewriteCtx);
    return stripJsonImportAttributes(
      code,
      (specifier) => specifier === "/_vf_modules/_veryfront/_deno-config.js",
    );
  },
};
