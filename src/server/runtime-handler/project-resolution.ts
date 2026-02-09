/**
 * Project Resolution Module
 *
 * Handles project slug resolution from various sources:
 * - Request headers (x-project-slug, x-project-id, etc.)
 * - Domain parsing (*.veryfront.com subdomains)
 * - API domain lookup (custom domains)
 * - Config file defaults
 *
 * @module server/runtime-handler/project-resolution
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { type ParsedDomain, parseProjectDomain } from "../utils/domain-parser.ts";
import { getEnvironmentType, lookupProjectByDomain } from "../utils/domain-lookup.ts";
import { parseProxyEnvironment, type ProxyEnvironment } from "./proxy-environment.ts";
import { SpanNames, withSpan } from "./tracing.ts";
import { isInternalHost } from "./request-utils.ts";

const logger = getBaseLogger("SERVER");

/**
 * Injection interface for testing project resolution dependencies
 */
export interface ProjectResolutionDeps {
  lookupProjectByDomain?: typeof lookupProjectByDomain;
  parseProjectDomain?: typeof parseProjectDomain;
  getEnvironmentType?: typeof getEnvironmentType;
}

let injectedDeps: ProjectResolutionDeps | null = null;

/**
 * Inject dependencies for testing. Pass null to reset to defaults.
 */
export function __injectDepsForTests(deps: ProjectResolutionDeps | null): void {
  injectedDeps = deps;
}

function getDeps(): Required<ProjectResolutionDeps> {
  return {
    lookupProjectByDomain: injectedDeps?.lookupProjectByDomain ?? lookupProjectByDomain,
    parseProjectDomain: injectedDeps?.parseProjectDomain ?? parseProjectDomain,
    getEnvironmentType: injectedDeps?.getEnvironmentType ?? getEnvironmentType,
  };
}

export interface RequestHeaders {
  /** Project slug from x-project-slug header */
  projectSlug: string | undefined;
  /** Project ID from x-project-id header */
  projectId: string | undefined;
  /** Release ID from x-release-id header */
  releaseId: string | undefined;
  /** Branch ID from x-branch-id header */
  branchId: string | undefined;
  /** Branch name from x-branch-name header */
  branchName: string | undefined;
  /** Environment from x-environment header */
  environment: string | undefined;
  /** Token from authorization header */
  token: string | undefined;
  /** Content source ID from x-content-source-id header */
  contentSourceId: string | undefined;
  /** Project path from x-project-path header */
  projectPath: string | undefined;
}

/**
 * Extract project-related headers from a request.
 */
export function extractRequestHeaders(req: Request, url: URL): RequestHeaders {
  return {
    projectSlug: req.headers.get("x-project-slug") ?? undefined,
    projectId: req.headers.get("x-project-id") ?? undefined,
    releaseId: req.headers.get("x-release-id") ?? undefined,
    branchId: req.headers.get("x-branch-id") ?? undefined,
    branchName: req.headers.get("x-branch-name") ?? undefined,
    environment: req.headers.get("x-environment") ?? url.searchParams.get("x-environment") ??
      undefined,
    token: undefined, // Extracted separately from request context
    contentSourceId: req.headers.get("x-content-source-id") ?? undefined,
    projectPath: req.headers.get("x-project-path") ?? undefined,
  };
}

export interface ProjectResolutionResult {
  /** Resolved project slug */
  projectSlug: string | undefined;
  /** Resolved project ID */
  projectId: string | undefined;
  /** Resolved release ID */
  releaseId: string | undefined;
  /** Environment name (e.g., "staging") */
  environmentName: string | undefined;
  /** Resolved proxy environment (preview/production) */
  proxyEnv: ProxyEnvironment | undefined;
  /** Parsed domain information */
  parsedDomain: ParsedDomain;
}

export interface ProjectResolutionOptions {
  /** Config from veryfront.config.ts */
  config: VeryfrontConfig | undefined;
  /** Request context from createRequestContext */
  reqCtx: {
    slug: string | undefined;
    mode: "preview" | "production" | undefined;
    branch: string | null | undefined;
    token: string | undefined;
  };
  /** Default project slug for standalone mode */
  defaultProjectSlug: string | undefined;
  /** Default project ID for standalone mode */
  defaultProjectId: string | undefined;
  /** WS slug override from query param */
  wsSlugOverride: string | undefined;
}

/**
 * Resolve project information from multiple sources.
 *
 * Priority order:
 * 1. Request headers (x-project-slug, etc.)
 * 2. WebSocket slug override (query param)
 * 3. Config file defaults
 * 4. Domain parsing (*.veryfront.com)
 * 5. API domain lookup (custom domains)
 */
export async function resolveProject(
  req: Request,
  url: URL,
  headers: RequestHeaders,
  opts: ProjectResolutionOptions,
): Promise<ProjectResolutionResult> {
  const hostHeader = req.headers.get("host") ?? url.host;
  const forwardedHost = req.headers.get("x-forwarded-host") ?? undefined;
  const host = forwardedHost ?? hostHeader;

  const deps = getDeps();
  const parsedDomain = deps.parseProjectDomain(host);
  const configuredSlug = opts.config?.fs?.veryfront?.projectSlug;

  // Initial resolution from headers/config/context
  // Use || for slug (empty string should fall through to defaults)
  let projectSlug = opts.reqCtx.slug || opts.wsSlugOverride || configuredSlug ||
    opts.defaultProjectSlug;
  let projectId: string | undefined = headers.projectId ?? opts.defaultProjectId;
  let releaseId: string | undefined = headers.releaseId;
  let environmentName: string | undefined;
  let proxyEnv = parseProxyEnvironment(headers.environment ?? null);

  const shouldSkipDomainLookup = isInternalHost(host);

  // Custom domain lookup
  if (
    !projectSlug &&
    !parsedDomain.isVeryfrontDomain &&
    opts.config?.fs?.veryfront &&
    !shouldSkipDomainLookup
  ) {
    const effectiveToken = opts.reqCtx.token ?? opts.config.fs.veryfront.apiToken ?? "";
    const baseUrl = opts.config.fs.veryfront.apiBaseUrl ?? "https://api.veryfront.com";

    if (effectiveToken) {
      logger.debug("[project-resolution] Custom domain detected, looking up project", {
        host,
        forwardedHost,
      });

      const lookupResult = await withSpan(
        SpanNames.DOMAIN_LOOKUP,
        () =>
          deps.lookupProjectByDomain(host, {
            apiBaseUrl: baseUrl,
            apiToken: effectiveToken,
          }),
        { "domain.host": host },
      );

      if (lookupResult) {
        projectSlug = lookupResult.project_slug;
        projectId = projectId ?? lookupResult.project_id;
        releaseId = releaseId ?? lookupResult.release_id ?? undefined;
        environmentName = lookupResult.environment?.name;

        if (!proxyEnv) proxyEnv = deps.getEnvironmentType(lookupResult);

        logger.debug("[project-resolution] Domain lookup successful", {
          domain: host,
          projectSlug: lookupResult.project_slug,
          projectId: lookupResult.project_id,
          environment: proxyEnv,
        });
      } else {
        logger.warn("[project-resolution] No project found for domain", { host });
      }
    }
  }

  // Veryfront domain release lookup (for production domains without releaseId)
  // Check headers.releaseId to skip if proxy already resolved it
  const proxyAlreadyResolvedRelease = !!headers.releaseId;

  if (
    parsedDomain.isVeryfrontDomain &&
    parsedDomain.isDraft === false &&
    projectSlug &&
    !releaseId &&
    !proxyAlreadyResolvedRelease &&
    opts.config?.fs?.veryfront &&
    !shouldSkipDomainLookup
  ) {
    const effectiveToken = opts.reqCtx.token ?? opts.config.fs.veryfront.apiToken ?? "";
    const baseUrl = opts.config.fs.veryfront.apiBaseUrl ?? "https://api.veryfront.com";

    if (effectiveToken) {
      const lookupResult = await withSpan(
        SpanNames.DOMAIN_RELEASE_LOOKUP,
        () =>
          deps.lookupProjectByDomain(host, {
            apiBaseUrl: baseUrl,
            apiToken: effectiveToken,
          }),
        { "domain.host": host, "domain.project_slug": projectSlug },
      );

      if (lookupResult?.release_id) {
        releaseId = lookupResult.release_id;
        projectId = lookupResult.project_id;
        environmentName = environmentName ?? lookupResult.environment?.name;
        proxyEnv = "production";

        logger.debug("[project-resolution] Veryfront domain release lookup successful", {
          projectSlug,
          releaseId,
          projectId,
        });
      }
    }
  }

  return {
    projectSlug,
    projectId,
    releaseId,
    environmentName,
    proxyEnv,
    parsedDomain,
  };
}

// Re-export for convenience
export { type ParsedDomain, parseProjectDomain } from "../utils/domain-parser.ts";
export { parseProxyEnvironment, type ProxyEnvironment } from "./proxy-environment.ts";
