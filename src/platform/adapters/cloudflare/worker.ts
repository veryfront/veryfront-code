import type { ExecutionContext } from "@veryfront/middleware/core/types.ts";
import type { CloudflareEnv } from "./types.ts";

export function createWorker(
  setup: (
    env: CloudflareEnv,
  ) => import("@veryfront/middleware/core/pipeline/index.ts").MiddlewarePipeline,
) {
  return {
    fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
      const pipeline = setup(env);
      return pipeline.execute(request, env, ctx);
    },
  };
}
