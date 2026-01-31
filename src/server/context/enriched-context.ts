import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext, ParsedDomain } from "../../types/server.ts";
import { buildRenderCachePrefix } from "../../cache/keys.ts";

export type Environment = "preview" | "production";
export type RenderMode = "development" | "production";

export interface ProjectData {
  id: string;
  slug: string;
  name?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface EnrichedContext {
  projectId: string;
  projectSlug: string;
  projectDir: string;

  token: string;
  environment: Environment;
  branch: string | null;
  isLocalDev: boolean;
  mode: RenderMode;

  /** Content source identifier for cache isolation (e.g., "release-abc123", "preview-main", "local-main") */
  contentSourceId: string;
  releaseId?: string;
  environmentName?: string;
  parsedDomain: ParsedDomain;
  projectData?: ProjectData;

  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  cachePrefix: string;

  moduleServerUrl?: string;
  nonce?: string;
  debug?: boolean;

  createdAt: number;
}

export interface BuildEnrichedContextOptions {
  projectId: string;
  projectSlug: string;
  projectDir: string;
  token: string;
  environment: Environment;
  branch: string | null;
  isLocalDev: boolean;
  /** Content source identifier for cache isolation - computed by proxy */
  contentSourceId: string;
  parsedDomain: ParsedDomain;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;

  releaseId?: string;
  environmentName?: string;
  projectData?: ProjectData;
  moduleServerUrl?: string;
  nonce?: string;
  debug?: boolean;
}

export function buildEnrichedContext(options: BuildEnrichedContextOptions): EnrichedContext {
  if (!options.contentSourceId) {
    throw new Error(`Missing contentSourceId for ${options.projectSlug}`);
  }

  const releaseKey = options.environment === "production"
    ? (options.releaseId ?? "unknown")
    : (options.branch ?? "main");

  return {
    projectId: options.projectId,
    projectSlug: options.projectSlug,
    projectDir: options.projectDir,

    token: options.token,
    environment: options.environment,
    branch: options.branch,
    isLocalDev: options.isLocalDev,
    mode: options.isLocalDev ? "development" : "production",

    contentSourceId: options.contentSourceId,
    releaseId: options.releaseId,
    environmentName: options.environmentName,
    parsedDomain: options.parsedDomain,
    projectData: options.projectData,

    adapter: options.adapter,
    config: options.config,
    cachePrefix: buildRenderCachePrefix(options.projectId, options.environment, releaseKey),

    moduleServerUrl: options.moduleServerUrl,
    nonce: options.nonce,
    debug: options.debug,

    createdAt: Date.now(),
  };
}

export function toRequestContext(enriched: EnrichedContext): {
  token: string;
  slug: string;
  branch: string | null;
  mode: Environment;
  isLocalDev: boolean;
} {
  return {
    token: enriched.token,
    slug: enriched.projectSlug,
    branch: enriched.branch,
    mode: enriched.environment,
    isLocalDev: enriched.isLocalDev,
  };
}

export function shouldEnableCacheFromEnriched(enriched: EnrichedContext): boolean {
  return !enriched.isLocalDev && enriched.environment !== "preview";
}

export function shouldUseNoCacheHeadersFromEnriched(enriched: EnrichedContext): boolean {
  return enriched.isLocalDev || enriched.environment === "preview";
}

export function shouldUseNoCacheHeadersFromHandler(ctx: HandlerContext): boolean {
  if (ctx.enriched) return shouldUseNoCacheHeadersFromEnriched(ctx.enriched);
  if (ctx.requestContext?.isLocalDev) return true;

  return (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "preview";
}
