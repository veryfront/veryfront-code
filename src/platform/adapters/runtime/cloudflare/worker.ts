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

export interface CloudflareRequestPipeline {
  execute(
    request: Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
  ): Promise<Response>;
}

export function createWorker(
  setup: (env: CloudflareEnv) => CloudflareRequestPipeline,
): {
  fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response>;
} {
  return {
    async fetch(
      request: Request,
      env: CloudflareEnv,
      ctx: ExecutionContext,
    ): Promise<Response> {
      return await setup(env).execute(request, env, ctx);
    },
  };
}
