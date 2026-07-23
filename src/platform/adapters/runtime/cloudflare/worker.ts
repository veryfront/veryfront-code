import type { CloudflareEnv } from "./types.ts";
import { isWebSocketUpgradeResponse, type RuntimeResponse } from "../../base.ts";

/**
 * Cloudflare Workers execution context.
 * Defined locally to keep adapters module isolated.
 * @see https://developers.cloudflare.com/workers/runtime-apis/context
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface CloudflareWorker<Env extends object = CloudflareEnv> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

/** Structural request-pipeline contract accepted by Cloudflare workers. */
export interface CloudflareRequestPipeline {
  execute(
    request: Request,
    env?: Record<string, unknown>,
    executionContext?: ExecutionContext,
  ): Promise<RuntimeResponse>;
}

export type CloudflarePipelineSource<Env extends object> =
  | CloudflareRequestPipeline
  | ((env: Env) => CloudflareRequestPipeline);

/**
 * Create a Workers fetch handler.
 *
 * A resolver is called for every request so binding-only deployments cannot
 * retain a pipeline that captured stale bindings. Pass a pipeline instance
 * directly when middleware state must persist across requests; the current
 * request environment is still supplied to every execution.
 */
export function createWorker<Env extends object = CloudflareEnv>(
  source: CloudflarePipelineSource<Env>,
): CloudflareWorker<Env> {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const pipeline = typeof source === "function" ? source(env) : source;
      const response = await pipeline.execute(request, env as Record<string, unknown>, ctx);
      if (isWebSocketUpgradeResponse(response)) {
        throw new TypeError("Cloudflare WebSocket upgrades must return the native response");
      }
      return response;
    },
  };
}
