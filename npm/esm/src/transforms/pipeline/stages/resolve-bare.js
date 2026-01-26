import { rewriteBareImports, rewriteVendorImports } from "../../esm/import-rewriter.js";
import { loadImportMap, transformImportsWithMap } from "../../../modules/import-map/index.js";
import { isBrowser, isSSR } from "../context.js";
import { TransformStage } from "../types.js";
export const resolveBarePlugin = {
    name: "resolve-bare",
    stage: TransformStage.RESOLVE_BARE,
    async transform(ctx) {
        if (isSSR(ctx)) {
            const cachedMap = ctx.metadata.get("importMap");
            const importMap = cachedMap ?? (await loadImportMap(ctx.projectDir));
            if (!cachedMap)
                ctx.metadata.set("importMap", importMap);
            return transformImportsWithMap(ctx.code, importMap, undefined, { resolveBare: true });
        }
        if (!isBrowser(ctx))
            return ctx.code;
        if (ctx.moduleServerUrl && ctx.vendorBundleHash) {
            return rewriteVendorImports(ctx.code, ctx.moduleServerUrl, ctx.vendorBundleHash);
        }
        return rewriteBareImports(ctx.code, ctx.moduleServerUrl);
    },
};
export default resolveBarePlugin;
