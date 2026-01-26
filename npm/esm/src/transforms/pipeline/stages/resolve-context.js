import { TransformStage } from "../types.js";
export const resolveContextPlugin = {
    name: "resolve-context",
    stage: TransformStage.RESOLVE_CONTEXT,
    transform(ctx) {
        return Promise.resolve(ctx.code);
    },
};
export default resolveContextPlugin;
