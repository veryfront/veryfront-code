/**
 * Environment Resolution Module
 *
 * Handles resolution of the runtime environment (preview vs production)
 * and validates release ID requirements.
 *
 * @module server/runtime-handler/environment-resolution
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { ErrorPages } from "../utils/error-html.ts";
import type { ProxyEnvironment } from "./proxy-environment.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("environment-resolution");

export interface EnvironmentResolutionResult {
  /** Resolved environment (preview/production) */
  resolvedEnvironment: "preview" | "production" | undefined;
  /** Resolved release ID (may be synthetic for standalone mode) */
  releaseId: string | undefined;
  /** Error response if validation fails */
  errorResponse: Response | undefined;
}

export interface EnvironmentResolutionOptions {
  /** Environment from proxy headers */
  proxyEnv: ProxyEnvironment | undefined;
  /** Mode from request context */
  reqCtxMode: "preview" | "production" | undefined;
  /** Release ID from headers */
  releaseId: string | undefined;
  /** Project slug */
  projectSlug: string | undefined;
  /** Project ID */
  projectId: string | undefined;
  /** Environment name */
  environmentName: string | undefined;
  /** Host header */
  host: string;
  /** Whether this is a local project */
  isLocalProject: boolean;
  /** Whether running in proxy mode */
  isProxyMode: boolean;
  /** Pathname (for WS/HMR skip) */
  pathname: string;
  /** Default environment for standalone mode */
  defaultEnvironment: "preview" | "production" | undefined;
}

/**
 * Resolve the runtime environment and validate release ID requirements.
 *
 * Returns an error response if validation fails (e.g., missing releaseId in production).
 */
export function resolveEnvironment(
  opts: EnvironmentResolutionOptions,
): EnvironmentResolutionResult {
  let resolvedEnvironment: "preview" | "production" | undefined =
    opts.proxyEnv === "preview" || opts.proxyEnv === "production" ? opts.proxyEnv : opts.reqCtxMode;

  let releaseId = opts.releaseId;

  // Skip releaseId validation for WebSocket/HMR endpoints - they're for development
  // features and shouldn't require release context
  const isWebSocketOrHMR = opts.pathname === "/_ws" || opts.pathname.startsWith("/_veryfront/");

  // Validate releaseId in proxy mode production
  if (
    opts.isProxyMode &&
    resolvedEnvironment === "production" &&
    opts.projectSlug &&
    !releaseId &&
    !opts.isLocalProject &&
    !isWebSocketOrHMR
  ) {
    logger.warn("Project not yet deployed (proxy mode)", {
      projectSlug: opts.projectSlug,
      projectId: opts.projectId,
      environmentName: opts.environmentName,
      host: opts.host,
      proxyEnv: opts.proxyEnv,
      resolvedEnvironment,
    });

    return {
      resolvedEnvironment,
      releaseId,
      errorResponse: new Response(ErrorPages.notFound(), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    };
  }

  // Handle standalone mode without release ID
  const isStandaloneWithoutRelease = !opts.isProxyMode &&
    resolvedEnvironment === "production" &&
    !releaseId &&
    !opts.isLocalProject;

  if (isStandaloneWithoutRelease) {
    const fallbackEnv = opts.defaultEnvironment ?? "preview";
    logger.debug(
      "[environment-resolution] Standalone mode without releaseId, using fallback environment",
      {
        projectSlug: opts.projectSlug,
        resolvedEnvironment,
        fallbackEnv,
      },
    );

    resolvedEnvironment = fallbackEnv;

    if (fallbackEnv === "production" && !releaseId) {
      releaseId = "standalone-dev";
      logger.debug(
        "[environment-resolution] Using synthetic releaseId for standalone production mode",
        {
          projectSlug: opts.projectSlug,
          releaseId,
        },
      );
    }
  }

  return {
    resolvedEnvironment,
    releaseId,
    errorResponse: undefined,
  };
}
