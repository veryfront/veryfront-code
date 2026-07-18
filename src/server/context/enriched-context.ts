import { buildRenderCachePrefix } from "#veryfront/cache/keys.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { HandlerContext } from "#veryfront/types/server.ts";
import type { BuildEnrichedContextOptions, EnrichedContext } from "./enriched-context-types.ts";
import { getReadyManifestForRender } from "#veryfront/release-assets/manifest-cache.ts";
export type {
  BuildEnrichedContextOptions,
  EnrichedContext,
  Environment,
} from "./enriched-context-types.ts";

export function buildEnrichedContext(options: BuildEnrichedContextOptions): EnrichedContext {
  if (!options.contentSourceId) {
    throw INVALID_ARGUMENT.create({ detail: `Missing contentSourceId for ${options.projectSlug}` });
  }

  let releaseKey: string;
  if (options.isLocalProject) {
    releaseKey = options.branch ?? "main";
  } else if (options.environment === "production") {
    if (!options.releaseId) {
      throw INVALID_ARGUMENT.create({
        detail: "Production requires releaseId for cache isolation",
      });
    }
    releaseKey = options.releaseId;
  } else {
    releaseKey = options.branch ?? "main";
  }

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
    cachePrefix: buildRenderCachePrefix(
      options.projectId,
      options.environment,
      releaseKey,
      getReadyManifestForRender(options.releaseId)?.manifestVersion,
    ),

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
