/**
 * Unified import resolution pipeline stage.
 *
 * Replaces: resolve-aliases, resolve-react, resolve-relative, resolve-bare
 * Uses the unified import rewriter for all import transformations.
 */

import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { stripJsonImportAttributes } from "../../esm/import-attributes.ts";
import type { DependencyResolutionObservation } from "../../import-rewriter/dependency-resolution.ts";
import { type RewriteContext, rewriteImports } from "../../import-rewriter/index.ts";
import { extractDependencyPinningPathKey } from "../../import-rewriter/url-builder.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

const DEPENDENCY_RESOLUTION_OBSERVATIONS = "dependencyResolutionObservations";
const DENO_CONFIG_STUB_PATH = "/_vf_modules/_veryfront/_deno-config.js";

function isDenoConfigStubUrl(specifier: string): boolean {
  const separatorIndex = specifier.search(/[?#]/);
  const pathname = separatorIndex === -1 ? specifier : specifier.slice(0, separatorIndex);
  const extracted = extractDependencyPinningPathKey(pathname);
  return !extracted.malformed && extracted.pathname === DENO_CONFIG_STUB_PATH;
}

export function getDependencyResolutionObservations(
  ctx: TransformContext,
): readonly DependencyResolutionObservation[] {
  const observations = ctx.metadata.get(DEPENDENCY_RESOLUTION_OBSERVATIONS);
  if (!(observations instanceof Map)) return [];
  return [...observations.values()].sort((left, right) =>
    left.packageName.localeCompare(right.packageName)
  );
}

async function buildRewriteContext(ctx: TransformContext): Promise<RewriteContext> {
  const observations = new Map<string, DependencyResolutionObservation>();
  ctx.metadata.set(DEPENDENCY_RESOLUTION_OBSERVATIONS, observations);

  const rewriteCtx: RewriteContext = {
    filePath: ctx.filePath,
    projectDir: ctx.projectDir,
    projectId: ctx.projectId,
    target: ctx.target,
    dev: ctx.dev,
    moduleServerUrl: ctx.moduleServerUrl,
    moduleServerOrigin: ctx.moduleServerOrigin,
    vendorBundleHash: ctx.vendorBundleHash,
    apiBaseUrl: ctx.apiBaseUrl,
    reactVersion: ctx.reactVersion,
    serverExternalPackages: ctx.serverExternalPackages,
    dependencyPinningCacheKey: ctx.dependencyPinningCacheKey,
    dependencyPinningDependencies: ctx.dependencyPinningDependencies,
    dependencyPinningSource: ctx.dependencyPinningSource,
    onDependencyResolutionObserved: (observation) => {
      observations.set(observation.packageName, observation);
      ctx.onDependencyResolutionObserved?.(observation);
    },
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
    const code = await rewriteImports(ctx.code, rewriteCtx);
    return stripJsonImportAttributes(code, isDenoConfigStubUrl);
  },
};
