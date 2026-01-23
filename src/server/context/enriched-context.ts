/**
 * EnrichedContext - Single source of truth for all request-scoped data
 *
 * Built once at universal-handler entry (after domain lookups) and passed
 * through the entire request pipeline. This eliminates redundant data fetching
 * and provides a unified context for all stages.
 *
 * Design principles:
 * - All data is immutable after creation
 * - No lazy loading - everything resolved upfront
 * - All required fields have values (no optional for critical data)
 * - Includes timing metadata for observability
 *
 * @module server/context/enriched-context
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ParsedDomain } from "../../types/server.ts";
import { buildRenderCachePrefix } from "../../cache/keys.ts";

/**
 * Environment type for rendering
 */
export type Environment = "preview" | "production";

/**
 * Mode type for rendering (derived from isLocalDev)
 */
export type RenderMode = "development" | "production";

/**
 * Project data from API (cached from initialization)
 */
export interface ProjectData {
  id: string;
  slug: string;
  name?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * EnrichedContext - Unified request context
 *
 * Contains all data needed throughout the request lifecycle.
 * Built once, used everywhere.
 */
export interface EnrichedContext {
  // ═══════════════════════════════════════════════════════════════════════════
  // Core Identification (always present, immutable)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Project UUID from domain lookup or config */
  projectId: string;

  /** Human-readable project identifier (subdomain or config value) */
  projectSlug: string;

  /** Absolute path to project directory (filesystem or virtual for API-backed) */
  projectDir: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Request-Level Data (from headers/domain parsing, immutable)
  // ═══════════════════════════════════════════════════════════════════════════

  /** API token for authenticated requests (from x-token header or env) */
  token: string;

  /** Environment determines content source: preview = draft, production = released */
  environment: Environment;

  /** Branch name for branch previews (e.g., "feature" from app--feature.preview.veryfront.com) */
  branch: string | null;

  /** Whether running in local development mode (NODE_ENV !== "production") */
  isLocalDev: boolean;

  /** Rendering mode derived from isLocalDev */
  mode: RenderMode;

  // ═══════════════════════════════════════════════════════════════════════════
  // Domain/Environment Data (from API lookups, immutable)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Release ID for production environments (from domain lookup) */
  releaseId?: string;

  /** Actual environment name from API (e.g., "Development", "Production") */
  environmentName?: string;

  /** Parsed domain information */
  parsedDomain: ParsedDomain;

  /** Cached project data from API initialization */
  projectData?: ProjectData;

  // ═══════════════════════════════════════════════════════════════════════════
  // Execution Context (pre-resolved, immutable)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Runtime adapter for filesystem/API access */
  adapter: RuntimeAdapter;

  /** Veryfront configuration (pre-loaded, never re-load) */
  config: VeryfrontConfig;

  /**
   * Cache key prefix for tenant isolation
   * Format: "{projectId}:{environment}:{releaseId|'draft'}"
   * Pre-computed once, used for all cache operations.
   */
  cachePrefix: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Optional/Computed (present when applicable)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Module server URL for client-side imports */
  moduleServerUrl?: string;

  /** Security nonce for inline scripts (CSP) */
  nonce?: string;

  /** Debug mode enabled */
  debug?: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // Timing Metadata (for observability)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Timestamp when context was created (for cache TTL decisions) */
  createdAt: number;
}

/**
 * Options for building an EnrichedContext
 */
export interface BuildEnrichedContextOptions {
  // Required fields
  projectId: string;
  projectSlug: string;
  projectDir: string;
  token: string;
  environment: Environment;
  branch: string | null;
  isLocalDev: boolean;
  parsedDomain: ParsedDomain;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;

  // Optional fields
  releaseId?: string;
  environmentName?: string;
  projectData?: ProjectData;
  moduleServerUrl?: string;
  nonce?: string;
  debug?: boolean;
}

/**
 * Build an EnrichedContext from resolved data.
 *
 * This should be called after all domain lookups and config loading are complete.
 * The resulting context is immutable and should be passed through all stages.
 *
 * @param options - All resolved context data
 * @returns Fully populated EnrichedContext
 */
export function buildEnrichedContext(options: BuildEnrichedContextOptions): EnrichedContext {
  const {
    projectId,
    projectSlug,
    projectDir,
    token,
    environment,
    branch,
    isLocalDev,
    parsedDomain,
    adapter,
    config,
    releaseId,
    environmentName,
    projectData,
    moduleServerUrl,
    nonce,
    debug,
  } = options;

  // Compute cache prefix once
  const releaseKey = releaseId ?? "draft";
  const cachePrefix = buildRenderCachePrefix(projectId, environment, releaseKey);

  // Derive mode from isLocalDev
  const mode: RenderMode = isLocalDev ? "development" : "production";

  return {
    // Core identification
    projectId,
    projectSlug,
    projectDir,

    // Request-level data
    token,
    environment,
    branch,
    isLocalDev,
    mode,

    // Domain/environment data
    releaseId,
    environmentName,
    parsedDomain,
    projectData,

    // Execution context
    adapter,
    config,
    cachePrefix,

    // Optional
    moduleServerUrl,
    nonce,
    debug,

    // Timing
    createdAt: Date.now(),
  };
}

/**
 * Extract RequestContext-compatible data from EnrichedContext.
 * For backward compatibility during migration.
 */
export function toRequestContext(enriched: EnrichedContext) {
  return {
    token: enriched.token,
    slug: enriched.projectSlug,
    branch: enriched.branch,
    mode: enriched.environment,
    isLocalDev: enriched.isLocalDev,
  };
}

/**
 * Check if caching should be enabled based on EnrichedContext.
 *
 * Returns false for:
 * - Local development (NODE_ENV !== "production")
 * - Preview mode (requires cache invalidation, handled separately)
 */
export function shouldEnableCacheFromEnriched(enriched: EnrichedContext): boolean {
  if (enriched.isLocalDev) return false;
  if (enriched.environment === "preview") return false;
  return true;
}

/**
 * Check if HTTP response should use no-cache headers.
 *
 * Returns true for:
 * - Local development (always fresh, no caching)
 * - Preview mode (browser must fetch fresh, server handles caching)
 */
export function shouldUseNoCacheHeadersFromEnriched(enriched: EnrichedContext): boolean {
  if (enriched.isLocalDev) return true;
  if (enriched.environment === "preview") return true;
  return false;
}
