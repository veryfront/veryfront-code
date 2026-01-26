import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { HandlerContext } from "../../server/handlers/types.js";
import type { EnrichedContext } from "../../server/context/enriched-context.js";
import {
  buildRenderCacheKey,
  buildRenderCachePrefix,
  computeContentSourceId,
  parseRenderCacheKey,
} from "../../cache/keys.js";

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
  /** Content source identifier for cache isolation (e.g., "release-abc123", "preview-main", "local-main") */
  contentSourceId: string;
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

  // Fallback path: when no enriched context (legacy/edge cases)
  // Validate required fields - no bandaids
  if (!ctx.config) {
    throw new Error("RenderContext requires config to be pre-loaded");
  }
  if (!ctx.adapter) {
    throw new Error("RenderContext requires adapter");
  }
  if (!ctx.projectSlug && !ctx.projectId) {
    throw new Error("RenderContext requires projectSlug or projectId");
  }

  const environment: RenderEnvironment = ctx.requestContext?.mode ?? "preview";
  const branch = ctx.requestContext?.branch ?? null;
  const projectId = ctx.projectId ?? ctx.projectSlug!;
  const projectSlug = ctx.projectSlug ?? ctx.projectId!;
  const isLocalDev = ctx.requestContext?.isLocalDev ?? false;

  // Use shared utility for contentSourceId - this will throw if production without releaseId
  const contentSourceId = computeContentSourceId(isLocalDev, environment, branch, ctx.releaseId);

  // For local dev, always use branch as releaseKey (no real releases in local dev)
  // For remote production, use releaseId; for remote preview, use branch
  const releaseKey = isLocalDev
    ? (branch ?? "main")
    : (environment === "production" ? ctx.releaseId! : (branch ?? "main"));
  const cachePrefix = buildRenderCachePrefix(projectId, environment, releaseKey);

  return {
    projectId,
    projectSlug,
    projectDir: ctx.projectDir,
    config: ctx.config,
    mode: isLocalDev ? "development" : "production",
    adapter: ctx.adapter,
    cachePrefix,
    environment,
    contentSourceId,
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
  if (!enriched.contentSourceId) {
    throw new Error("EnrichedContext is missing required contentSourceId");
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
    contentSourceId: enriched.contentSourceId,
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
