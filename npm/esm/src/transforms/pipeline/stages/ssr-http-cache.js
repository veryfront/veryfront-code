/**
 * SSR HTTP Cache Stage - caches HTTP imports to local file:// paths.
 *
 * Deno supports HTTP imports, but Node.js and Bun don't.
 * This stage normalizes all SSR dependencies by downloading HTTP modules
 * (esm.sh, npm:, etc.) into a shared cache and rewriting imports to file://.
 * This keeps SSR runtime-agnostic and avoids loader hooks.
 */
import { TransformStage } from "../types.js";
import { cacheHttpImportsToLocal } from "../../esm/http-cache.js";
import { getHttpBundleCacheDir } from "../../../utils/cache-dir.js";
import { loadImportMap } from "../../../modules/import-map/index.js";
import { rendererLogger as logger } from "../../../utils/index.js";
const LOG_PREFIX = "[SSR-HTTP-CACHE]";
export const ssrHttpCachePlugin = {
    name: "ssr-http-cache",
    stage: TransformStage.FINALIZE - 1, // Run just before finalize
    // Run on ALL runtimes including Deno.
    // While Deno supports HTTP imports natively, esm.sh modules with external=react
    // have bare `react` imports. Import maps don't apply inside HTTPS modules,
    // so bare specifiers can't resolve to our shared-*.ts files.
    // By caching HTTP imports to file://, bare react imports resolve via import map.
    condition: () => true,
    async transform(ctx) {
        const cachedMap = ctx.metadata.get("importMap");
        const importMap = cachedMap ?? (await loadImportMap(ctx.projectDir));
        if (!cachedMap) {
            ctx.metadata.set("importMap", importMap);
        }
        const result = await cacheHttpImportsToLocal(ctx.code, {
            cacheDir: getHttpBundleCacheDir(),
            importMap,
            reactVersion: ctx.reactVersion,
        });
        if (result.code !== ctx.code) {
            logger.debug(`${LOG_PREFIX} Cached HTTP imports for ${ctx.filePath.slice(-40)}`);
        }
        // Store bundle manifest ID in context metadata for downstream consumers
        if (result.bundleManifestId) {
            ctx.metadata.set("bundleManifestId", result.bundleManifestId);
        }
        return result.code;
    },
};
