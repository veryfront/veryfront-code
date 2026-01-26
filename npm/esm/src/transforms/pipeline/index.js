import { generateCacheKey, getCachedTransformAsync, setCachedTransform, } from "../esm/transform-cache.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { createTransformContext, formatTimingLog, recordStageTiming } from "./context.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { compilePlugin, finalizePlugin, parsePlugin, resolveAliasesPlugin, resolveBarePlugin, resolveContextPlugin, resolveReactPlugin, resolveRelativePlugin, ssrHttpCachePlugin, ssrHttpStubPlugin, } from "./stages/index.js";
const SSR_PIPELINE = [
    parsePlugin,
    compilePlugin,
    resolveAliasesPlugin,
    resolveReactPlugin,
    resolveContextPlugin,
    ssrHttpStubPlugin,
    resolveRelativePlugin,
    resolveBarePlugin,
    ssrHttpCachePlugin,
    finalizePlugin,
];
const BROWSER_PIPELINE = [
    parsePlugin,
    compilePlugin,
    resolveAliasesPlugin,
    resolveReactPlugin,
    resolveContextPlugin,
    resolveRelativePlugin,
    resolveBarePlugin,
    finalizePlugin,
];
export function runPipeline(source, filePath, projectDir, options, config) {
    const fileName = filePath.split("/").pop() || filePath;
    return withSpan("transform.pipeline", async () => {
        const transformStart = performance.now();
        const ctx = await createTransformContext(source, filePath, projectDir, options);
        ctx.debug = config?.debug ?? false;
        const cacheKey = generateCacheKey(filePath, ctx.contentHash, options.ssr ?? false, options.studioEmbed ?? false);
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
                ctx.code = await withSpan(`transform.stage.${plugin.name}`, async () => await plugin.transform(ctx), { "transform.stage": plugin.name, "transform.stage_order": plugin.stage });
            }
            catch (error) {
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
    }, {
        "transform.file": fileName,
        "transform.target": options.ssr ? "ssr" : "browser",
        "transform.studio_embed": options.studioEmbed ?? false,
    });
}
export async function transformToESM(source, filePath, projectDir, _adapter, options) {
    if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
        return source;
    }
    const { code } = await runPipeline(source, filePath, projectDir, options);
    return code;
}
export function getDefaultPlugins(ssr) {
    return ssr ? [...SSR_PIPELINE] : [...BROWSER_PIPELINE];
}
export { TransformStage } from "./types.js";
export { createTransformContext, createTransformContextSync, isBrowser, isMDX, isSSR, isTypeScript, } from "./context.js";
