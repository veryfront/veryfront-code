import {
  generateCacheKey,
  getCachedTransformAsync,
  setCachedTransform,
} from "../esm/transform-cache.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { createTransformContext, formatTimingLog, recordStageTiming } from "./context.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { computeConfigHash } from "../../cache/config-hash.js";
import { computeDepsHash } from "../../cache/dependency-graph.js";
import type {
  PipelineConfig,
  TransformOptions,
  TransformPlugin,
  TransformResult,
} from "./types.js";
import {
  compilePlugin,
  finalizePlugin,
  parsePlugin,
  resolveImportsPlugin,
  ssrHttpCachePlugin,
  ssrHttpStubPlugin,
} from "./stages/index.js";
import { createFileSystem } from "../../platform/compat/fs.js";

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

      // Compute config hash (cheap, no I/O)
      const configHash = await computeConfigHash({
        reactVersion: ctx.reactVersion,
        jsxImportSource: ctx.jsxImportSource,
        studioEmbed: ctx.studioEmbed,
        dev: ctx.dev,
      });

      // Compute dependency hash when file reader is available
      const depsHash = options.readFile
        ? await computeDepsHash(filePath, options.readFile, projectDir).catch((err) => {
          logger.debug("[PIPELINE] depsHash computation failed, skipping", {
            file: filePath.slice(-60),
            error: err instanceof Error ? err.message : String(err),
          });
          return undefined;
        })
        : undefined;

      const cacheKey = generateCacheKey(
        filePath,
        ctx.contentHash,
        options.ssr ?? false,
        options.studioEmbed ?? false,
        { depsHash, configHash, projectId: options.projectId },
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
  adapter: unknown,
  options: TransformOptions,
): Promise<string> {
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
    return source;
  }

  // Extract readFile from adapter for dependency tracking
  const enrichedOptions = options.readFile ? options : {
    ...options,
    readFile: buildReadFile(adapter, projectDir),
  };

  const { code } = await runPipeline(source, filePath, projectDir, enrichedOptions);
  return code;
}

/** Extract readFile from adapter if available, for dependency hash computation. */
function extractReadFile(adapter: unknown): ((path: string) => Promise<string>) | undefined {
  const a = adapter as { fs?: { readFile?: (path: string) => Promise<string> } } | null;
  return typeof a?.fs?.readFile === "function" ? (p: string) => a.fs!.readFile!(p) : undefined;
}

/**
 * Build a readFile helper that avoids routing local framework paths
 * through the remote adapter.
 *
 * This prevents API fetches for file:// or absolute paths outside projectDir
 * (e.g. framework files under /usr/local/lib/node_modules/veryfront).
 */
function buildReadFile(
  adapter: unknown,
  projectDir: string,
): (path: string) => Promise<string> {
  const adapterRead = extractReadFile(adapter);
  const fs = createFileSystem();
  const normalizedProjectDir = projectDir.replace(/\/+$/, "");

  return async (path: string): Promise<string> => {
    let normalizedPath = path;
    if (normalizedPath.startsWith("file://")) {
      normalizedPath = normalizedPath.slice("file://".length);
    }

    const isAbsolute = normalizedPath.startsWith("/");
    const isOutsideProject = isAbsolute &&
      normalizedProjectDir.length > 0 &&
      !normalizedPath.startsWith(normalizedProjectDir);

    if (isOutsideProject) {
      return await fs.readTextFile(normalizedPath);
    }

    if (adapterRead) {
      return await adapterRead(normalizedPath);
    }

    return await fs.readTextFile(normalizedPath);
  };
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
} from "./types.js";

export { TransformStage } from "./types.js";

export {
  createTransformContext,
  createTransformContextSync,
  isBrowser,
  isMDX,
  isSSR,
  isTypeScript,
} from "./context.js";
