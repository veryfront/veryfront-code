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
import { isDeno, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";

const LOG_PREFIX = "[SSR-HTTP-CACHE]";

export const ssrHttpCachePlugin: TransformPlugin = {
  name: "ssr-http-cache",
  stage: TransformStage.FINALIZE - 1, // Run just before finalize
  // Native Deno handles HTTP imports directly — no need to cache to file://.
  // Compiled Deno binaries cannot do dynamic HTTP imports at runtime.
  condition: () => !(isDeno && !isDenoCompiled),

  async transform(ctx) {
    const cachedMap = ctx.metadata.get("importMap") as ImportMapConfig | undefined;
    const importMap = cachedMap ?? (await loadImportMap(ctx.projectDir));

    if (!cachedMap) {
      ctx.metadata.set("importMap", importMap);
    }

    const { code, bundleManifestId } = await cacheHttpImportsToLocal(ctx.code, {
      cacheDir: getHttpBundleCacheDir(),
      importMap,
      reactVersion: ctx.reactVersion,
    });

    if (code !== ctx.code) {
      logger.debug(`${LOG_PREFIX} Cached HTTP imports for ${ctx.filePath.slice(-40)}`);
    }

    // Store bundle manifest ID in context metadata for downstream consumers
    if (bundleManifestId) {
      ctx.metadata.set("bundleManifestId", bundleManifestId);
    }

    return code;
  },
};
