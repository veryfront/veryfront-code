import { computeShortContentHash } from "../esm/transform-utils.ts";
import { REACT_VERSION } from "../esm/package-registry.ts";
import type {
  TransformContext,
  TransformOptions,
  TransformStage,
  TransformTarget,
} from "./types.ts";

/**
 * Get React version for transforms.
 * Uses REACT_VERSION constant - the centralized version from package-registry.
 * Prefer passing reactVersion through TransformOptions for per-project versions.
 */
function getDefaultReactVersion(): string {
  return REACT_VERSION;
}

function buildContext(
  source: string,
  filePath: string,
  projectDir: string,
  contentHash: string,
  options: TransformOptions,
  reactVersion: string,
): TransformContext {
  const target: TransformTarget = options.ssr ? "ssr" : "browser";

  return {
    code: source,
    originalSource: source,
    filePath,
    projectDir,
    projectId: options.projectId,
    target,
    dev: options.dev ?? true,
    contentHash,
    moduleServerUrl: options.moduleServerUrl,
    vendorBundleHash: options.vendorBundleHash,
    apiBaseUrl: options.apiBaseUrl,
    jsxImportSource: options.jsxImportSource ?? "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    studioEmbed: options.studioEmbed,
    reactVersion,
  };
}

export async function createTransformContext(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
): Promise<TransformContext> {
  const [contentHash, reactVersion] = await Promise.all([
    computeShortContentHash(source),
    Promise.resolve(options.reactVersion ?? getDefaultReactVersion()),
  ]);

  return buildContext(source, filePath, projectDir, contentHash, options, reactVersion);
}

export function createTransformContextSync(
  source: string,
  filePath: string,
  projectDir: string,
  contentHash: string,
  options: TransformOptions,
): TransformContext {
  return buildContext(
    source,
    filePath,
    projectDir,
    contentHash,
    options,
    options.reactVersion ?? REACT_VERSION,
  );
}

export function recordStageTiming(
  ctx: TransformContext,
  stage: TransformStage,
  startTime: number,
): void {
  ctx.timing.set(stage, performance.now() - startTime);
}

export function getTotalTiming(ctx: TransformContext): number {
  return [...ctx.timing.values()].reduce((sum, ms) => sum + ms, 0);
}

export function formatTimingLog(ctx: TransformContext): Record<string, string> {
  const stageNames = [
    "parse",
    "compile",
    "aliases",
    "react",
    "context",
    "relative",
    "bare",
    "finalize",
  ];

  const result: Record<string, string> = {
    file: ctx.filePath.slice(-40),
    target: ctx.target,
  };

  for (const [stage, ms] of ctx.timing) {
    const name = stageNames[stage] ?? `stage${stage}`;
    result[`${name}Ms`] = ms.toFixed(1);
  }

  result.totalMs = getTotalTiming(ctx).toFixed(1);
  return result;
}

export function isSSR(ctx: TransformContext): boolean {
  return ctx.target === "ssr";
}

export function isBrowser(ctx: TransformContext): boolean {
  return ctx.target === "browser";
}

export function isMDX(ctx: TransformContext): boolean {
  return ctx.filePath.endsWith(".mdx") || ctx.filePath.endsWith(".md");
}

export function isTypeScript(ctx: TransformContext): boolean {
  return ctx.filePath.endsWith(".ts") || ctx.filePath.endsWith(".tsx");
}

export { getExtension } from "../../utils/path-utils.ts";
