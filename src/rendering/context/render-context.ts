/**
 * RenderContext - Per-request context for rendering
 *
 * This interface encapsulates all project-specific data needed for rendering.
 * The Renderer uses this to maintain tenant isolation while sharing
 * expensive services (esbuild, MDX compiler) across all projects.
 *
 * @module rendering/context/render-context
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { HandlerContext } from "../../server/handlers/types.ts";
import {
  buildRenderCacheKey,
  buildRenderCachePrefix,
  parseRenderCacheKey,
} from "../../core/cache/keys.ts";

/**
 * Environment type for rendering context
 */
export type RenderEnvironment = "preview" | "production";

/**
 * Per-request rendering context
 *
 * Contains all project-specific data needed to render a page.
 * This is created fresh for each request and passed through
 * the rendering pipeline to ensure tenant isolation.
 *
 * CRITICAL: All services that access project data MUST receive
 * this context. Never share mutable state without including
 * the context's cachePrefix in cache keys.
 */
export interface RenderContext {
  /** Project UUID for cache isolation */
  projectId: string;

  /** Human-readable project identifier (from subdomain) */
  projectSlug: string;

  /** Absolute path to project directory (virtual for API-backed) */
  projectDir: string;

  /** Veryfront configuration for this project */
  config: VeryfrontConfig;

  /** Rendering mode */
  mode: "development" | "production";

  /** Runtime adapter for filesystem/API access */
  adapter: RuntimeAdapter;

  /**
   * Cache key prefix for tenant isolation
   * Format: "{projectId}:{environment}:{releaseId|'draft'}"
   *
   * All cache entries MUST use this prefix to prevent
   * cross-project data leakage.
   */
  cachePrefix: string;

  /** Environment (preview = draft content, production = released) */
  environment: RenderEnvironment;

  /** Release ID for production environments */
  releaseId?: string;

  /** OAuth token from proxy for API access */
  proxyToken?: string;

  /** Module server URL for client-side imports */
  moduleServerUrl?: string;

  /** Dashboard/dev server port */
  port?: number;

  /** Security nonce for inline scripts */
  nonce?: string;
}

/**
 * Options for creating a render context
 */
export interface CreateRenderContextOptions {
  /** Override port (defaults to ctx or 3001) */
  port?: number;

  /** Override module server URL */
  moduleServerUrl?: string;

  /** Security nonce for CSP */
  nonce?: string;
}

/**
 * Create a RenderContext from HandlerContext
 *
 * This is the primary factory function for creating render contexts.
 * It extracts all necessary data from the handler context and computes
 * the cache prefix for tenant isolation.
 *
 * @param ctx - Handler context from request processing
 * @param options - Optional overrides
 * @returns Fully populated RenderContext
 * @throws Error if required fields are missing
 */
export function createRenderContext(
  ctx: HandlerContext,
  options?: CreateRenderContextOptions,
): RenderContext {
  // Validate required fields
  if (!ctx.config) {
    throw new Error("RenderContext requires config to be pre-loaded");
  }
  if (!ctx.adapter) {
    throw new Error("RenderContext requires adapter");
  }

  // Determine environment
  const environment: RenderEnvironment = ctx.proxyEnvironment ?? "preview";

  // Compute project identifier (prefer ID, fall back to slug, default to __single__)
  // Single-project mode (local dev without subdomain) uses "__single__"
  const projectId = ctx.projectId ?? ctx.projectSlug ?? "__single__";
  const projectSlug = ctx.projectSlug ?? ctx.projectId ?? "__single__";

  // Compute cache prefix for tenant isolation using centralized builder
  // Format: "{projectId}:{environment}:{releaseId|'draft'}:{frameworkVersion}"
  const releaseKey = ctx.releaseId ?? "draft";
  const cachePrefix = buildRenderCachePrefix(projectId, environment, releaseKey);

  return {
    projectId,
    projectSlug,
    projectDir: ctx.projectDir,
    config: ctx.config,
    mode: ctx.mode,
    adapter: ctx.adapter,
    cachePrefix,
    environment,
    releaseId: ctx.releaseId,
    proxyToken: ctx.proxyToken,
    moduleServerUrl: options?.moduleServerUrl ?? ctx.moduleServerUrl,
    port: options?.port,
    nonce: options?.nonce,
  };
}

/**
 * Create a cache key with proper tenant isolation
 *
 * @param ctx - Render context with cachePrefix
 * @param contentKey - The content-specific key (e.g., slug, path)
 * @returns Fully qualified cache key with tenant prefix
 */
export function createCacheKey(ctx: RenderContext, contentKey: string): string {
  return buildRenderCacheKey(ctx.cachePrefix, contentKey);
}

/**
 * Parse a cache key to extract components
 *
 * @param cacheKey - Full cache key
 * @returns Parsed components or null if invalid format
 */
export const parseCacheKey = parseRenderCacheKey;

/**
 * Check if two render contexts belong to the same tenant
 *
 * @param a - First context
 * @param b - Second context
 * @returns True if same project/environment/release
 */
export function isSameTenant(a: RenderContext, b: RenderContext): boolean {
  return a.cachePrefix === b.cachePrefix;
}
