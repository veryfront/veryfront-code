/**
 * Transform context factory and utilities.
 *
 * Provides functions for creating and managing transform context
 * as it flows through the pipeline stages.
 */

import { computeContentHash } from "../esm/transform-utils.ts";
import type {
  TransformContext,
  TransformOptions,
  TransformStage,
  TransformTarget,
} from "./types.ts";

/**
 * Create a new transform context from source and options.
 */
export async function createTransformContext(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
): Promise<TransformContext> {
  const contentHash = await computeContentHash(source);
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
  };
}

/**
 * Create context synchronously when content hash is already known.
 */
export function createTransformContextSync(
  source: string,
  filePath: string,
  projectDir: string,
  contentHash: string,
  options: TransformOptions,
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
  };
}

/**
 * Record timing for a stage.
 */
export function recordStageTiming(
  ctx: TransformContext,
  stage: TransformStage,
  startTime: number,
): void {
  ctx.timing.set(stage, performance.now() - startTime);
}

/**
 * Get total timing from context.
 */
export function getTotalTiming(ctx: TransformContext): number {
  let total = 0;
  for (const ms of ctx.timing.values()) {
    total += ms;
  }
  return total;
}

/**
 * Format timing data for logging.
 */
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

/**
 * Check if context is for SSR.
 */
export function isSSR(ctx: TransformContext): boolean {
  return ctx.target === "ssr";
}

/**
 * Check if context is for browser.
 */
export function isBrowser(ctx: TransformContext): boolean {
  return ctx.target === "browser";
}

/**
 * Check if file is MDX.
 */
export function isMDX(ctx: TransformContext): boolean {
  return ctx.filePath.endsWith(".mdx");
}

/**
 * Check if file is TypeScript.
 */
export function isTypeScript(ctx: TransformContext): boolean {
  return ctx.filePath.endsWith(".ts") || ctx.filePath.endsWith(".tsx");
}

/**
 * Get file extension.
 */
export function getExtension(ctx: TransformContext): string {
  const dot = ctx.filePath.lastIndexOf(".");
  return dot >= 0 ? ctx.filePath.slice(dot) : "";
}
