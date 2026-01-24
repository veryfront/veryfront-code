import type { CloudflareEnv } from "./types.ts";

/**
 * Cloudflare Workers execution context.
 * Defined locally to keep adapters module isolated.
 * @see https://developers.cloudflare.com/workers/runtime-apis/context
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export function createWorker(
  setup: (
    env: CloudflareEnv,
  ) => import("#veryfront/middleware/core/pipeline/index.ts").MiddlewarePipeline,
): { fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): unknown } {
  function fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): unknown {
    return setup(env).execute(request, env, ctx);
  }

  return { fetch };
}
