import { bundleHttpImports } from "../../esm/http-bundler.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

export const finalizePlugin: TransformPlugin = {
  name: "finalize",
  stage: TransformStage.FINALIZE,

  async transform(ctx: TransformContext): Promise<string> {
    if (!isSSR(ctx)) return ctx.code;

    return await bundleHttpImports(
      ctx.code,
      getHttpBundleCacheDir(),
      ctx.contentHash,
      ctx.reactVersion,
    );
  },
};

export default finalizePlugin;
