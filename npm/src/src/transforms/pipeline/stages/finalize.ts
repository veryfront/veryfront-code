import { bundleHttpImports } from "../../esm/http-bundler.js";
import { getHttpBundleCacheDir } from "../../../utils/cache-dir.js";
import { isSSR } from "../context.js";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.js";

export const finalizePlugin: TransformPlugin = {
  name: "finalize",
  stage: TransformStage.FINALIZE,

  async transform(ctx: TransformContext): Promise<string> {
    if (!isSSR(ctx)) return ctx.code;

    const result = bundleHttpImports(ctx.code, getHttpBundleCacheDir(), ctx.contentHash);
    return result instanceof Promise ? await result : result;
  },
};

export default finalizePlugin;
