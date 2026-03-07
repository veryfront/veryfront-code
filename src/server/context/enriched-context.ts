import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext, ParsedDomain } from "#veryfront/types";
import { buildRenderCachePrefix } from "#veryfront/cache/keys.ts";

export type Environment = "preview" | "production";
type RenderMode = "development" | "production";

interface ProjectData {
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
  isLocalProject: boolean;
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

interface BuildEnrichedContextOptions {
  projectId: string;
  projectSlug: string;
  projectDir: string;
  token: string;
  environment: Environment;
  branch: string | null;
  isLocalProject: boolean;
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
    isLocalProject: options.isLocalProject,
    mode: options.isLocalProject ? "development" : "production",

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

function shouldUseNoCacheHeadersFromEnriched(enriched: EnrichedContext): boolean {
  return enriched.isLocalProject || enriched.environment === "preview";
}

export function shouldUseNoCacheHeadersFromHandler(ctx: HandlerContext): boolean {
  if (ctx.enriched) return shouldUseNoCacheHeadersFromEnriched(ctx.enriched);
  if (ctx.isLocalProject) return true;

  return (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "preview";
}
