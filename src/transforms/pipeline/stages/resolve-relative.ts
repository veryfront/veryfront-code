import {
  blockExternalUrlImports,
  resolveRelativeImports,
  resolveRelativeImportsForSSR,
  resolveVeryfrontImports,
} from "../../esm/path-resolver.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { isBrowser, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

export const resolveRelativePlugin: TransformPlugin = {
  name: "resolve-relative",
  stage: TransformStage.RESOLVE_RELATIVE,

  async transform(ctx: TransformContext): Promise<string> {
    if (isSSR(ctx)) {
      const urlBlockResult = await blockExternalUrlImports(ctx.code, ctx.filePath);

      if (urlBlockResult.blockedUrls.length > 0) {
        logger.warn("[PIPELINE:resolve-relative] Blocked external URL imports in SSR mode", {
          file: ctx.filePath.slice(-60),
          blockedUrls: urlBlockResult.blockedUrls,
        });
      }

      let code = await resolveRelativeImportsForSSR(urlBlockResult.code);
      code = await resolveVeryfrontImports(code);
      return code;
    }

    if (isBrowser(ctx)) {
      return resolveRelativeImports(
        ctx.code,
        ctx.filePath,
        ctx.projectDir,
        ctx.moduleServerUrl,
      );
    }

    return ctx.code;
  },
};

export default resolveRelativePlugin;
