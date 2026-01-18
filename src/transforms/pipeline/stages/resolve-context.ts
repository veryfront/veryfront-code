/**
 * Resolve context stage - placeholder for context package resolution.
 *
 * Previously handled context-dependent packages (react-query, etc.) but these
 * are now user-controlled via project import maps. This stage is kept as a
 * no-op placeholder to preserve stage ordering for other plugins.
 */

import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Resolve context plugin - no-op placeholder.
 *
 * Context packages are now user-controlled via project import maps.
 * This plugin is kept to preserve stage ordering (ssrHttpStubPlugin uses RESOLVE_CONTEXT + 1).
 */
export const resolveContextPlugin: TransformPlugin = {
  name: "resolve-context",
  stage: TransformStage.RESOLVE_CONTEXT,

  transform(ctx: TransformContext): Promise<string> {
    return Promise.resolve(ctx.code);
  },
};

export default resolveContextPlugin;
