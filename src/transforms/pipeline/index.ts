import {
  generateCacheKey,
  getCachedTransformAsync,
  setCachedTransform,
} from "../esm/transform-cache.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { createTransformContext, formatTimingLog, recordStageTiming } from "./context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
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
  resolveImportsPlugin,
  ssrHttpCachePlugin,
  ssrHttpStubPlugin,
} from "./stages/index.ts";

const SSR_PIPELINE: TransformPlugin[] = [
  parsePlugin,
  compilePlugin,
  resolveImportsPlugin, // Unified import resolution
  ssrHttpStubPlugin,
  ssrHttpCachePlugin,
  finalizePlugin,
];

const BROWSER_PIPELINE: TransformPlugin[] = [
  parsePlugin,
  compilePlugin,
  resolveImportsPlugin, // Unified import resolution
  finalizePlugin,
];

export function runPipeline(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
  config?: PipelineConfig,
): Promise<TransformResult> {
  const fileName = filePath.split("/").pop() || filePath;

  return withSpan(
    "transform.pipeline",
    async () => {
      const transformStart = performance.now();

      const ctx = await createTransformContext(source, filePath, projectDir, options);
      ctx.debug = config?.debug ?? false;

      const cacheKey = generateCacheKey(
        filePath,
        ctx.contentHash,
        options.ssr ?? false,
        options.studioEmbed ?? false,
      );

      const cached = await getCachedTransformAsync(cacheKey);
      if (cached) {
        return {
          code: cached.code,
          contentHash: ctx.contentHash,
          timing: new Map(),
          totalMs: performance.now() - transformStart,
          cached: true,
        };
      }

      const basePipeline = options.ssr ? SSR_PIPELINE : BROWSER_PIPELINE;
      const pipeline = config?.plugins
        ? [...basePipeline, ...config.plugins].sort((a, b) => a.stage - b.stage)
        : basePipeline;

      for (const plugin of pipeline) {
        if (plugin.condition?.(ctx) === false) {
          continue;
        }

        const stageStart = performance.now();

        try {
          ctx.code = await withSpan(
            `transform.stage.${plugin.name}`,
            async () => await plugin.transform(ctx),
            { "transform.stage": plugin.name, "transform.stage_order": plugin.stage },
          );
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

      setCachedTransform(cacheKey, ctx.code, ctx.contentHash);

      const totalMs = performance.now() - transformStart;

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
    },
    {
      "transform.file": fileName,
      "transform.target": options.ssr ? "ssr" : "browser",
      "transform.studio_embed": options.studioEmbed ?? false,
    },
  );
}

export async function transformToESM(
  source: string,
  filePath: string,
  projectDir: string,
  _adapter: unknown,
  options: TransformOptions,
): Promise<string> {
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
    return source;
  }

  const { code } = await runPipeline(source, filePath, projectDir, options);
  return code;
}

export function getDefaultPlugins(ssr: boolean): TransformPlugin[] {
  return ssr ? [...SSR_PIPELINE] : [...BROWSER_PIPELINE];
}

export type {
  PipelineConfig,
  TransformContext,
  TransformOptions,
  TransformPlugin,
  TransformResult,
  TransformTarget,
} from "./types.ts";

export { TransformStage } from "./types.ts";

export {
  createTransformContext,
  createTransformContextSync,
  isBrowser,
  isMDX,
  isSSR,
  isTypeScript,
} from "./context.ts";
