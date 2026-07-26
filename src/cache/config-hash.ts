/**
 * Configuration hash for transform cache keys.
 *
 * Computes a hash of transform-affecting configuration to ensure
 * cache entries are invalidated when configuration changes.
 */

import { computeHash } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import {
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  TAILWIND_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { buildDependencyPinningCacheVariant } from "./keys/dependency-pinning.ts";

/**
 * Configuration that affects transform output.
 */
interface TransformConfig {
  /** React version for esm.sh URLs */
  reactVersion?: string;
  /** JSX import source */
  jsxImportSource?: string;
  /** Module server base embedded into rewritten browser/SSR imports. */
  moduleServerUrl?: string;
  /** Absolute request origin used to emit browser-loadable static asset URLs. */
  moduleServerOrigin?: string;
  /** Vendor bundle revision embedded into rewritten React imports. */
  vendorBundleHash?: string;
  /** Enable Studio Navigator embed */
  studioEmbed?: boolean;
  /** Development mode */
  dev?: boolean;
  /** Stable VERYFRONT_DEPENDENCY_PINNING + package dependency-map state. */
  dependencyPinningCacheKey?: string;
}

/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export function computeConfigHash(config: TransformConfig): Promise<string> {
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );
  const normalized = {
    transformVersion: VERSION,
    reactVersion: config.reactVersion ?? DEFAULT_REACT_VERSION,
    jsxImportSource: config.jsxImportSource ?? "react",
    ...(dependencyPinningCacheVariant
      ? {
        moduleServerUrl: config.moduleServerUrl ?? null,
        vendorBundleHash: config.vendorBundleHash ?? null,
      }
      : {}),
    studioEmbed: config.studioEmbed ?? false,
    dev: config.dev ?? false,
    ...(dependencyPinningCacheVariant ? { dependencyPinningCacheVariant } : {}),
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
  const parts = [
    `v${VERSION}`,
    config.reactVersion ?? DEFAULT_REACT_VERSION,
    config.jsxImportSource ?? "react",
    config.studioEmbed ? "studio" : "",
    config.dev ? "dev" : "",
  ].filter(Boolean);
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );
  if (dependencyPinningCacheVariant) {
    parts.push(`modules:${config.moduleServerUrl ?? ""}`);
    parts.push(`vendor:${config.vendorBundleHash ?? ""}`);
    parts.push(`pins:${dependencyPinningCacheVariant}`);
  }

  return parts.join(":");
}
