import { resolveCrossProjectImports, resolvePathAliases, resolveVeryfrontSubpathImports, } from "../../esm/path-resolver.js";
import { isSSR } from "../context.js";
import { TransformStage } from "../types.js";
import { getApiBaseUrlEnv } from "../../../config/env.js";
export const resolveAliasesPlugin = {
    name: "resolve-aliases",
    stage: TransformStage.RESOLVE_ALIASES,
    async transform(ctx) {
        const ssr = isSSR(ctx);
        let code = await resolvePathAliases(ctx.code, ctx.filePath, ctx.projectDir, ssr);
        code = await resolveVeryfrontSubpathImports(code, ssr);
        const apiBaseUrl = ctx.apiBaseUrl ?? getApiBaseUrlEnv();
        return resolveCrossProjectImports(code, { apiBaseUrl, ssr });
    },
};
export default resolveAliasesPlugin;
