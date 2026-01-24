import {
  resolveCrossProjectImports,
  resolvePathAliases,
  resolveVeryfrontSubpathImports,
} from "../../esm/path-resolver.ts";
import { isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";

export const resolveAliasesPlugin: TransformPlugin = {
  name: "resolve-aliases",
  stage: TransformStage.RESOLVE_ALIASES,

  async transform(ctx: TransformContext): Promise<string> {
    const ssr = isSSR(ctx);

    let code = await resolvePathAliases(ctx.code, ctx.filePath, ctx.projectDir, ssr);
    code = await resolveVeryfrontSubpathImports(code, ssr);

    const apiBaseUrl = ctx.apiBaseUrl ?? getApiBaseUrlEnv();

    return resolveCrossProjectImports(code, { apiBaseUrl, ssr });
  },
};

export default resolveAliasesPlugin;
