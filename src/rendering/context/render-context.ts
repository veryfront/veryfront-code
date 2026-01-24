import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext } from "../../server/handlers/types.ts";
import type { EnrichedContext } from "../../server/context/enriched-context.ts";
import {
  buildRenderCacheKey,
  buildRenderCachePrefix,
  parseRenderCacheKey,
} from "../../cache/keys.ts";

export type RenderEnvironment = "preview" | "production";

export interface RenderContext {
  projectId: string;
  projectSlug: string;
  projectDir: string;
  config: VeryfrontConfig;
  mode: "development" | "production";
  adapter: RuntimeAdapter;
  cachePrefix: string;
  environment: RenderEnvironment;
  branch?: string | null;
  releaseId?: string;
  proxyToken?: string;
  moduleServerUrl?: string;
  port?: number;
  nonce?: string;
}

export interface CreateRenderContextOptions {
  port?: number;
  moduleServerUrl?: string;
  nonce?: string;
}

export function createRenderContext(
  ctx: HandlerContext,
  options?: CreateRenderContextOptions,
): RenderContext {
  if (ctx.enriched) {
    return createRenderContextFromEnriched(ctx.enriched, options);
  }

  if (!ctx.config) {
    throw new Error("RenderContext requires config to be pre-loaded");
  }
  if (!ctx.adapter) {
    throw new Error("RenderContext requires adapter");
  }

  const environment: RenderEnvironment = ctx.requestContext?.mode ?? "preview";
  const branch = ctx.requestContext?.branch ?? null;
  const projectId = ctx.projectId ?? ctx.projectSlug ?? "__single__";
  const projectSlug = ctx.projectSlug ?? ctx.projectId ?? "__single__";
  const releaseKey = environment === "production"
    ? (ctx.releaseId ?? "latest")
    : (branch ?? "main");
  const cachePrefix = buildRenderCachePrefix(projectId, environment, releaseKey);

  return {
    projectId,
    projectSlug,
    projectDir: ctx.projectDir,
    config: ctx.config,
    mode: ctx.requestContext?.isLocalDev ? "development" : "production",
    adapter: ctx.adapter,
    cachePrefix,
    environment,
    branch,
    releaseId: ctx.releaseId,
    proxyToken: ctx.proxyToken,
    moduleServerUrl: options?.moduleServerUrl ?? ctx.moduleServerUrl,
    port: options?.port,
    nonce: options?.nonce,
  };
}

export function createRenderContextFromEnriched(
  enriched: EnrichedContext,
  options?: CreateRenderContextOptions,
): RenderContext {
  if (!enriched.config) {
    throw new Error("EnrichedContext is missing required config");
  }
  if (!enriched.adapter) {
    throw new Error("EnrichedContext is missing required adapter");
  }

  return {
    projectId: enriched.projectId,
    projectSlug: enriched.projectSlug,
    projectDir: enriched.projectDir,
    config: enriched.config,
    mode: enriched.mode,
    adapter: enriched.adapter,
    cachePrefix: enriched.cachePrefix,
    environment: enriched.environment,
    branch: enriched.branch,
    releaseId: enriched.releaseId,
    proxyToken: enriched.token ?? undefined,
    moduleServerUrl: options?.moduleServerUrl ?? enriched.moduleServerUrl,
    port: options?.port,
    nonce: options?.nonce ?? enriched.nonce,
  };
}

export function createCacheKey(ctx: RenderContext, contentKey: string): string {
  return buildRenderCacheKey(ctx.cachePrefix, contentKey);
}

export const parseCacheKey = parseRenderCacheKey;

export function isSameTenant(a: RenderContext, b: RenderContext): boolean {
  return a.cachePrefix === b.cachePrefix;
}
