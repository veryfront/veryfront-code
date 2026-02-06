/**
 * Handler Context Builder Module
 *
 * Builds the HandlerContext object that is passed to all route handlers.
 * Combines information from various sources into a unified context.
 *
 * @module server/runtime-handler/handler-context-builder
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { SecurityConfig } from "#veryfront/types";

/** CSP user header type (from SecurityConfigLoader, string or null) */
export type CspUserHeader = string | null;
import type { ParsedDomain } from "../utils/domain-parser.ts";
import type { HandlerContext } from "../handlers/types.ts";
import type { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { buildEnrichedContext } from "../context/enriched-context.ts";
import { computeContentSourceId } from "../../cache/keys.ts";

export interface HandlerContextOptions {
  /** Project directory */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** Security config */
  securityConfig: SecurityConfig | null;
  /** CSP user header */
  cspUserHeader: CspUserHeader | null;
  /** Debug mode */
  debug: boolean | undefined;
  /** Veryfront config */
  config: VeryfrontConfig | undefined;
  /** Parsed domain info */
  parsedDomain: ParsedDomain;
  /** Project slug */
  projectSlug: string | undefined;
  /** Project ID */
  projectId: string | undefined;
  /** Release ID */
  releaseId: string | undefined;
  /** Proxy token (undefined for local projects) */
  proxyToken: string | undefined;
  /** Environment name */
  environmentName: string | undefined;
  /** Resolved environment */
  resolvedEnvironment: "preview" | "production";
  /** Request context (from createRequestContext) */
  requestContext: import("../context/request-context.ts").RequestContext;
  /** Route registry */
  routeRegistry: RouteRegistry;
  /** Whether this is a local project */
  isLocalProject: boolean;
  /** Module server URL */
  moduleServerUrl: string | undefined;
}

/**
 * Build the HandlerContext for route handlers.
 */
export function buildHandlerContext(opts: HandlerContextOptions): HandlerContext {
  const contentSourceId = computeContentSourceId(
    opts.requestContext.isLocalDev || opts.isLocalProject,
    opts.resolvedEnvironment,
    opts.requestContext.branch,
    opts.releaseId,
  );

  // Build enriched context if we have config and project slug
  const enrichedContext = opts.config && opts.projectSlug
    ? buildEnrichedContext({
      projectId: opts.projectId ?? opts.projectSlug,
      projectSlug: opts.projectSlug,
      projectDir: opts.projectDir,
      token: opts.isLocalProject ? "" : (opts.proxyToken ?? ""),
      environment: opts.resolvedEnvironment,
      branch: opts.requestContext.branch,
      isLocalDev: opts.requestContext.isLocalDev || opts.isLocalProject,
      contentSourceId,
      parsedDomain: opts.parsedDomain,
      adapter: opts.adapter,
      config: opts.config,
      releaseId: opts.releaseId,
      environmentName: opts.environmentName,
      moduleServerUrl: opts.moduleServerUrl,
      debug: opts.debug,
    })
    : undefined;

  return {
    projectDir: opts.projectDir,
    adapter: opts.adapter,
    moduleServerUrl: opts.moduleServerUrl,
    securityConfig: opts.securityConfig,
    cspUserHeader: opts.cspUserHeader,
    debug: opts.debug,
    config: opts.config,
    parsedDomain: opts.parsedDomain,
    projectSlug: opts.projectSlug,
    projectId: opts.projectId,
    releaseId: opts.releaseId,
    proxyToken: opts.isLocalProject ? undefined : opts.proxyToken,
    environmentName: opts.environmentName,
    resolvedEnvironment: opts.resolvedEnvironment,
    requestContext: { ...opts.requestContext, mode: opts.resolvedEnvironment },
    routeRegistry: opts.routeRegistry,
    enriched: enrichedContext,
  };
}

/**
 * Build a minimal context for monitoring endpoints.
 */
export function buildMinimalContext(
  projectDir: string,
  adapter: RuntimeAdapter,
  securityConfig: SecurityConfig | null,
  cspUserHeader: CspUserHeader | null,
  debug: boolean | undefined,
  config: VeryfrontConfig | undefined,
): HandlerContext {
  return {
    projectDir,
    adapter,
    securityConfig,
    cspUserHeader,
    debug,
    config,
  };
}
