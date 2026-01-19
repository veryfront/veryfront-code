/**
 * Resolve React stage - react/jsx-runtime → esm.sh URLs.
 *
 * Handles React-specific import resolution based on target environment.
 * For SSR: Resolves React to esm.sh URLs (later cached to file://) and veryfront modules to file:// URLs
 * For browser: Resolves to esm.sh URLs
 */

import { addDepsToEsmShUrls, resolveReactImports } from "../../esm/react-imports.ts";
import { isBrowser, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Resolve React plugin - transforms react imports to target-appropriate URLs.
 */
export const resolveReactPlugin: TransformPlugin = {
  name: "resolve-react",
  stage: TransformStage.RESOLVE_REACT,

  async transform(ctx: TransformContext): Promise<string> {
    let code = ctx.code;

    // Resolve react imports based on target, using project's React version
    code = await resolveReactImports(code, isSSR(ctx), ctx.reactVersion);

    // Add deps to esm.sh URLs for consistent React versions
    code = await addDepsToEsmShUrls(code, isSSR(ctx), ctx.reactVersion);

    // In dev mode for browser, rewrite hardcoded project domain URLs
    // to use current origin for local dev server compatibility
    if (ctx.dev && isBrowser(ctx)) {
      code = code.replace(
        /(['"])https?:\/\/[a-zA-Z0-9-]+\.(?:com|org|net|io|dev|app|veryfront\.com)\1/g,
        "location.origin",
      );
    }

    return code;
  },
};

export default resolveReactPlugin;
