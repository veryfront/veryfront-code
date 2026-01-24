/**
 * SSR HTTP Cache Stage - caches HTTP imports to local file:// paths.
 *
 * Deno supports HTTP imports, but Node.js and Bun don't.
 * This stage normalizes all SSR dependencies by downloading HTTP modules
 * (esm.sh, npm:, etc.) into a shared cache and rewriting imports to file://.
 * This keeps SSR runtime-agnostic and avoids loader hooks.
 */

import type { TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { cacheHttpImportsToLocal } from "../../esm/http-cache.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";

const LOG_PREFIX = "[SSR-HTTP-CACHE]";

export const ssrHttpCachePlugin: TransformPlugin = {
  name: "ssr-http-cache",
  stage: TransformStage.FINALIZE - 1, // Run just before finalize
  // Previously skipped on Deno since it supports HTTP imports natively.
  // However, esm.sh modules with external=react have bare `react` imports
  // that Deno can't resolve to our shared-*.ts files (import maps don't
  // apply to imports inside HTTPS modules). Caching to file:// lets us
  // rewrite their internal imports to use our shared React instance.
  // Note: file:// paths are pod-specific but hash-based so consistent.
  condition: () => true,

  async transform(ctx) {
    const cachedMap = ctx.metadata.get("importMap") as ImportMapConfig | undefined;
    const importMap = cachedMap ?? await loadImportMap(ctx.projectDir);
    if (!cachedMap) {
      ctx.metadata.set("importMap", importMap);
    }

    const cacheDir = getHttpBundleCacheDir();
    const updated = await cacheHttpImportsToLocal(ctx.code, {
      cacheDir,
      importMap,
      reactVersion: ctx.reactVersion,
    });

    if (updated !== ctx.code) {
      logger.debug(`${LOG_PREFIX} Cached HTTP imports for ${ctx.filePath.slice(-40)}`);
    }

    return updated;
  },
};
