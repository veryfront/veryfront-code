/**
 * Resolve aliases stage - @/ → relative/absolute paths.
 *
 * Transforms path aliases to appropriate paths based on target:
 * - SSR: file:// URLs pointing to project directory
 * - Browser: module server URLs
 */

import { resolvePathAliases, resolveCrossProjectImports } from "../../esm/path-resolver.ts";
import { isSSR } from "../context.ts";
import { TransformStage, type TransformContext, type TransformPlugin } from "../types.ts";

/**
 * Resolve aliases plugin - transforms @/ imports.
 */
export const resolveAliasesPlugin: TransformPlugin = {
  name: "resolve-aliases",
  stage: TransformStage.RESOLVE_ALIASES,

  async transform(ctx: TransformContext): Promise<string> {
    let code = ctx.code;

    // Resolve @/ path aliases
    code = await resolvePathAliases(code, ctx.filePath, ctx.projectDir, isSSR(ctx));

    // Resolve cross-project versioned imports (e.g., demo@0.0.1/@/components/Button)
    // Must be done before other import rewrites since it transforms to absolute URLs
    const apiBaseUrl = ctx.apiBaseUrl ||
      Deno.env.get("VERYFRONT_API_BASE_URL") ||
      Deno.env.get("VERYFRONT_API_URL")?.replace("/graphql", "/api") ||
      "http://api.lvh.me:4000/api";

    code = await resolveCrossProjectImports(code, {
      apiBaseUrl,
      ssr: isSSR(ctx),
    });

    return code;
  },
};

export default resolveAliasesPlugin;
