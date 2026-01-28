/**
 * Configuration hash for transform cache keys.
 *
 * Computes a hash of transform-affecting configuration to ensure
 * cache entries are invalidated when configuration changes.
 */

import { computeHash } from "#veryfront/utils";
import { TRANSFORM_CACHE_VERSION } from "../transforms/esm/package-registry.ts";
import {
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  TAILWIND_VERSION,
} from "../transforms/import-rewriter/url-builder.ts";

/**
 * Configuration that affects transform output.
 */
export interface TransformConfig {
  /** React version for esm.sh URLs */
  reactVersion?: string;
  /** JSX import source */
  jsxImportSource?: string;
  /** Enable Studio Navigator embed */
  studioEmbed?: boolean;
  /** Development mode */
  dev?: boolean;
}

/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export function computeConfigHash(config: TransformConfig): Promise<string> {
  const normalized = {
    // Core transform settings
    transformVersion: TRANSFORM_CACHE_VERSION,
    reactVersion: config.reactVersion ?? DEFAULT_REACT_VERSION,
    jsxImportSource: config.jsxImportSource ?? "react",

    // Feature flags
    studioEmbed: config.studioEmbed ?? false,
    dev: config.dev ?? false,

    // Package versions that affect output
    csstype: CSSTYPE_VERSION,
    tailwind: TAILWIND_VERSION,
  };

  return computeHash(JSON.stringify(normalized));
}

/**
 * Compute a quick config hash synchronously (less fields, faster).
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export function computeConfigHashSync(config: TransformConfig): string {
  // Simple string concatenation for sync hash
  const parts = [
    `v${TRANSFORM_CACHE_VERSION}`,
    config.reactVersion ?? DEFAULT_REACT_VERSION,
    config.jsxImportSource ?? "react",
    config.studioEmbed ? "studio" : "",
    config.dev ? "dev" : "",
  ].filter(Boolean);

  return parts.join(":");
}
