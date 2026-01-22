/**
 * Request Context
 *
 * Unified context for handling requests. Two orthogonal concerns:
 * - `mode`: Determined by `.preview.` in hostname (preview | production)
 * - `env`: Determined by NODE_ENV (development | production)
 *
 * @module server/context/request-context
 */

import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

/**
 * Request context containing all resolved request-scoped values.
 *
 * Created once at request entry, used throughout the request lifecycle.
 */
export interface RequestContext {
  /** API token for authenticated requests */
  token: string;
  /** Project slug extracted from domain or headers */
  slug: string;
  /** Branch name if using branch preview (e.g., app--feature.preview.veryfront.com) */
  branch: string | null;
  /** Mode determines content source and CSS delivery */
  mode: "preview" | "production";
}

/**
 * Create request context from an incoming request.
 *
 * Resolution order (headers take precedence for proxy scenarios):
 * 1. Headers (x-token, x-project-slug, x-environment) - set by proxy
 * 2. Domain parsing - extracts slug, branch, mode from hostname
 * 3. Environment variables - fallback for direct mode
 *
 * Mode resolution:
 * 1. If hostname has `.preview.`, it's preview mode (veryfront/local domains)
 * 2. Otherwise, check x-environment header (custom domains via proxy)
 * 3. Default to production
 *
 * @param req - Incoming request
 * @returns Fully resolved request context
 */
export function createRequestContext(req: Request): RequestContext {
  const url = new URL(req.url);
  const hostname = url.hostname;
  const parsed = parseProjectDomain(hostname);

  // Determine mode from hostname or x-environment header
  let mode: "preview" | "production" = "production";
  if (hostname.includes(".preview.")) {
    mode = "preview";
  } else if (req.headers.get("x-environment") === "preview") {
    mode = "preview";
  }

  return {
    token: req.headers.get("x-token") ?? getEnv("VERYFRONT_API_TOKEN") ?? "",
    slug: req.headers.get("x-project-slug") ?? parsed.slug ?? "",
    branch: parsed.branch,
    mode,
  };
}

/**
 * Check if running in local development environment.
 *
 * When true:
 * - ALL caching is disabled (both HTTP headers and memory caches)
 * - Local Dev HMR is enabled
 * - Debug endpoints are available
 * - Verbose error messages
 *
 * @returns true if NODE_ENV/DENO_ENV is not "production"
 */
export function isLocalDev(): boolean {
  const env = getEnv("NODE_ENV") || getEnv("DENO_ENV") || "development";
  return env !== "production";
}

/**
 * Determine the caching strategy based on environment and mode.
 *
 * - `none`: No caching at all (development - always fresh)
 * - `invalidate`: Cache with invalidation on file change (preview - instant updates)
 * - `immutable`: Cache by release ID (production - stable content)
 *
 * @param ctx - Request context
 * @returns Caching strategy to use
 */
export function getCacheStrategy(ctx: RequestContext): "none" | "invalidate" | "immutable" {
  if (isLocalDev()) return "none";
  if (ctx.mode === "preview") return "invalidate";
  return "immutable";
}

/**
 * Check if caching should be enabled for the given context.
 *
 * Returns false for:
 * - Local development (NODE_ENV !== "production")
 * - Preview mode (requires cache invalidation, handled separately)
 *
 * @param ctx - Request context
 * @returns true if caching should be enabled
 */
export function shouldEnableCache(ctx: RequestContext): boolean {
  return getCacheStrategy(ctx) === "immutable";
}
