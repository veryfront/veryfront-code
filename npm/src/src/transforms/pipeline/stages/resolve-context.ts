import { type TransformContext, type TransformPlugin, TransformStage } from "../types.js";

export const resolveContextPlugin: TransformPlugin = {
  name: "resolve-context",
  stage: TransformStage.RESOLVE_CONTEXT,
  transform(ctx: TransformContext): Promise<string> {
    return Promise.resolve(ctx.code);
  },
};

export default resolveContextPlugin;
