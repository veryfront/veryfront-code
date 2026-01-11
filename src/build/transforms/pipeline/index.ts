/**
 * ESM Transform Pipeline Orchestrator.
 *
 * Executes transform plugins in stage order, tracking timing and handling caching.
 * This replaces the monolithic transform-core.ts with a modular, testable architecture.
 */

import {
  generateCacheKey,
  getCachedTransform,
  setCachedTransform,
} from "../esm/transform-cache.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { createTransformContext, formatTimingLog, recordStageTiming } from "./context.ts";
import type {
  PipelineConfig,
  TransformOptions,
  TransformPlugin,
  TransformResult,
} from "./types.ts";
import {
  compilePlugin,
  finalizePlugin,
  parsePlugin,
  resolveAliasesPlugin,
  resolveBarePlugin,
  resolveContextPlugin,
  resolveReactPlugin,
  resolveRelativePlugin,
  ssrHttpStubPlugin,
} from "./stages/index.ts";

/**
 * Default SSR pipeline configuration.
 * Runs all stages in order with SSR-specific resolution.
 */
const SSR_PIPELINE: TransformPlugin[] = [
  parsePlugin,
  compilePlugin,
  resolveAliasesPlugin,
  resolveReactPlugin,
  resolveContextPlugin,
  ssrHttpStubPlugin, // Stub browser-only HTTP imports during SSR
  resolveRelativePlugin,
  resolveBarePlugin,
  finalizePlugin,
];

/**
 * Default browser pipeline configuration.
 * Runs all stages in order with browser-specific resolution.
 */
const BROWSER_PIPELINE: TransformPlugin[] = [
  parsePlugin,
  compilePlugin,
  resolveAliasesPlugin,
  resolveReactPlugin,
  resolveContextPlugin,
  resolveRelativePlugin,
  resolveBarePlugin,
  finalizePlugin,
];

/**
 * Run the transform pipeline on source code.
 *
 * @param source - Source code to transform
 * @param filePath - Path to the source file
 * @param projectDir - Project root directory
 * @param options - Transform options
 * @param config - Optional pipeline configuration
 * @returns Transform result with code and timing info
 */
export async function runPipeline(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
  config?: PipelineConfig,
): Promise<TransformResult> {
  const transformStart = performance.now();

  // Create transform context
  const ctx = await createTransformContext(source, filePath, projectDir, options);
  ctx.debug = config?.debug ?? false;

  // Generate cache key and check cache (content-addressable)
  const cacheKey = generateCacheKey(
    filePath,
    ctx.contentHash,
    options.ssr ?? false,
  );
  const cached = getCachedTransform(cacheKey);

  if (cached) {
    return {
      code: cached.code,
      contentHash: ctx.contentHash,
      timing: new Map(),
      totalMs: performance.now() - transformStart,
      cached: true,
    };
  }

  // Select pipeline based on target
  const basePipeline = options.ssr ? SSR_PIPELINE : BROWSER_PIPELINE;

  // Merge with custom plugins if provided
  const pipeline = config?.plugins
    ? [...basePipeline, ...config.plugins].sort((a, b) => a.stage - b.stage)
    : basePipeline;

  // Execute pipeline stages
  for (const plugin of pipeline) {
    // Check condition if present
    if (plugin.condition && !plugin.condition(ctx)) {
      continue;
    }

    const stageStart = performance.now();

    try {
      ctx.code = await plugin.transform(ctx);
    } catch (error) {
      logger.error(`[PIPELINE:${plugin.name}] Stage failed`, {
        file: filePath.slice(-60),
        stage: plugin.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    recordStageTiming(ctx, plugin.stage, stageStart);
  }

  // Cache the result
  setCachedTransform(cacheKey, ctx.code, ctx.contentHash);

  const totalMs = performance.now() - transformStart;

  // Log timing in debug mode
  if (ctx.debug) {
    logger.debug("[PIPELINE] Transform complete", formatTimingLog(ctx));
  }

  return {
    code: ctx.code,
    contentHash: ctx.contentHash,
    timing: ctx.timing,
    totalMs,
    cached: false,
  };
}

/**
 * Transform source to ESM.
 *
 * Drop-in replacement for the legacy transformToESM function.
 * Returns just the code string for backwards compatibility.
 *
 * @param source - Source code to transform
 * @param filePath - Path to the source file
 * @param projectDir - Project root directory
 * @param _adapter - Runtime adapter (unused, kept for API compatibility)
 * @param options - Transform options
 * @returns Transformed ESM code
 */
export async function transformToESM(
  source: string,
  filePath: string,
  projectDir: string,
  _adapter: unknown,
  options: TransformOptions,
): Promise<string> {
  // CSS and JSON files don't need JS transforms - return as-is
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
    return source;
  }

  const result = await runPipeline(source, filePath, projectDir, options);
  return result.code;
}

/**
 * Get available plugins for a target.
 */
export function getDefaultPlugins(ssr: boolean): TransformPlugin[] {
  return ssr ? [...SSR_PIPELINE] : [...BROWSER_PIPELINE];
}

// Re-export types for consumers
export type {
  PipelineConfig,
  TransformContext,
  TransformOptions,
  TransformPlugin,
  TransformResult,
  TransformTarget,
} from "./types.ts";

export { TransformStage } from "./types.ts";

// Re-export context utilities
export {
  createTransformContext,
  createTransformContextSync,
  isBrowser,
  isMDX,
  isSSR,
  isTypeScript,
} from "./context.ts";
