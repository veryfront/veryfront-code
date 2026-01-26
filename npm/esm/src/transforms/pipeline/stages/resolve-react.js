import { addDepsToEsmShUrls, resolveReactImports } from "../../esm/react-imports.js";
import { isBrowser, isSSR } from "../context.js";
import { TransformStage } from "../types.js";
export const resolveReactPlugin = {
    name: "resolve-react",
    stage: TransformStage.RESOLVE_REACT,
    async transform(ctx) {
        const ssr = isSSR(ctx);
        let code = await resolveReactImports(ctx.code, ssr, ctx.reactVersion);
        code = await addDepsToEsmShUrls(code, ssr, ctx.reactVersion);
        if (ctx.dev && isBrowser(ctx)) {
            code = code.replace(/(['"])https?:\/\/[a-zA-Z0-9-]+\.(?:com|org|net|io|dev|app|veryfront\.com)\1/g, "location.origin");
        }
        return code;
    },
};
export default resolveReactPlugin;
