import { bundleHttpImports } from "../../esm/http-bundler.js";
import { getHttpBundleCacheDir } from "../../../utils/cache-dir.js";
import { isSSR } from "../context.js";
import { TransformStage } from "../types.js";
export const finalizePlugin = {
    name: "finalize",
    stage: TransformStage.FINALIZE,
    async transform(ctx) {
        if (!isSSR(ctx))
            return ctx.code;
        const result = bundleHttpImports(ctx.code, getHttpBundleCacheDir(), ctx.contentHash, ctx.reactVersion);
        return result instanceof Promise ? await result : result;
    },
};
export default finalizePlugin;
