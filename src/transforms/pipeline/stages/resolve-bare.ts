import { rewriteBareImports, rewriteVendorImports } from "../../esm/import-rewriter.ts";
import { loadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { isBrowser, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

export const resolveBarePlugin: TransformPlugin = {
  name: "resolve-bare",
  stage: TransformStage.RESOLVE_BARE,

  async transform(ctx: TransformContext): Promise<string> {
    if (isSSR(ctx)) {
      const cachedMap = ctx.metadata.get("importMap") as ImportMapConfig | undefined;
      const importMap = cachedMap ?? (await loadImportMap(ctx.projectDir));

      if (!cachedMap) ctx.metadata.set("importMap", importMap);

      return transformImportsWithMap(ctx.code, importMap, undefined, { resolveBare: true });
    }

    if (!isBrowser(ctx)) return ctx.code;

    if (ctx.moduleServerUrl && ctx.vendorBundleHash) {
      return rewriteVendorImports(ctx.code, ctx.moduleServerUrl, ctx.vendorBundleHash);
    }

    return rewriteBareImports(ctx.code, ctx.moduleServerUrl);
  },
};

export default resolveBarePlugin;
