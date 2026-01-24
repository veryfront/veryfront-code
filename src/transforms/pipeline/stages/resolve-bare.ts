/**
 * Resolve bare stage - bare npm imports → esm.sh URLs.
 *
 * Transforms bare package imports (e.g., "lodash") to CDN URLs.
 * - SSR: Applies import map to normalize remaining bare specifiers
 * - Browser: Rewrites to esm.sh URLs or vendor bundle paths
 */

import { rewriteBareImports, rewriteVendorImports } from "../../esm/import-rewriter.ts";
import { loadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { isBrowser, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Resolve bare plugin - transforms bare imports to CDN URLs.
 */
export const resolveBarePlugin: TransformPlugin = {
  name: "resolve-bare",
  stage: TransformStage.RESOLVE_BARE,

  async transform(ctx: TransformContext): Promise<string> {
    let code = ctx.code;

    if (isSSR(ctx)) {
      // SSR: Apply import map to normalize remaining bare specifiers
      // This ensures all imports of the same package use the same module instance,
      // preventing React context mismatch issues
      const cachedMap = ctx.metadata.get("importMap") as ImportMapConfig | undefined;
      const importMap = cachedMap ?? await loadImportMap(ctx.projectDir);
      if (!cachedMap) {
        ctx.metadata.set("importMap", importMap);
      }

      code = transformImportsWithMap(
        code,
        importMap,
        undefined,
        { resolveBare: true },
      );
    } else if (isBrowser(ctx)) {
      // Browser: Rewrite bare imports to CDN URLs
      if (ctx.moduleServerUrl && ctx.vendorBundleHash) {
        // Use vendor bundle if available
        code = await rewriteVendorImports(code, ctx.moduleServerUrl, ctx.vendorBundleHash);
      } else {
        // Fall back to esm.sh URLs
        code = await rewriteBareImports(code, ctx.moduleServerUrl);
      }
    }

    return code;
  },
};

export default resolveBarePlugin;
