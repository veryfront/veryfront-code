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
  /** Module server URL for rewritten browser imports */
  moduleServerUrl?: string;
  /** Absolute request origin used to emit browser-loadable static asset URLs. */
  moduleServerOrigin?: string;
  /** Vendor bundle hash for rewritten vendor imports */
  vendorBundleHash?: string;
  /** API base URL for rewritten cross-project imports */
  apiBaseUrl?: string;
  /** Enable Studio Navigator embed */
  studioEmbed?: boolean;
  /** Development mode */
  dev?: boolean;
  /** Stable VERYFRONT_DEPENDENCY_PINNING + package dependency-map state. */
  dependencyPinningCacheKey?: string;
  /** Exact filesystem URLs inserted by the trusted SSR module loader. */
  allowedFilesystemImportSpecifiers?: ReadonlySet<string>;
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
  const allowedFilesystemImportSpecifiers = config.allowedFilesystemImportSpecifiers?.size
    ? [...config.allowedFilesystemImportSpecifiers].sort()
    : undefined;
  const normalized = {
    transformVersion: VERSION,
    reactVersion: config.reactVersion ?? DEFAULT_REACT_VERSION,
    jsxImportSource: config.jsxImportSource ?? "react",
    moduleServerUrl: config.moduleServerUrl ?? null,
    vendorBundleHash: config.vendorBundleHash ?? null,
    apiBaseUrl: config.apiBaseUrl ?? null,
    studioEmbed: config.studioEmbed ?? false,
    dev: config.dev ?? false,
    ...(dependencyPinningCacheVariant ? { dependencyPinningCacheVariant } : {}),
    ...(allowedFilesystemImportSpecifiers ? { allowedFilesystemImportSpecifiers } : {}),
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
    encodeConfigPart("modules", config.moduleServerUrl),
    encodeConfigPart("vendor", config.vendorBundleHash),
    encodeConfigPart("api", config.apiBaseUrl),
    config.studioEmbed ? "studio" : "",
    config.dev ? "dev" : "",
  ].filter(Boolean);
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );
  if (dependencyPinningCacheVariant) {
    parts.push(`pins:${dependencyPinningCacheVariant}`);
  }
  if (config.allowedFilesystemImportSpecifiers?.size) {
    parts.push(
      encodeConfigPart(
        "filesystem-imports",
        JSON.stringify([...config.allowedFilesystemImportSpecifiers].sort()),
      ),
    );
  }

  return parts.join(":");
}

function encodeConfigPart(label: string, value: string | undefined): string {
  if (!value) return "";
  return `${label}:${value.length}:${value}`;
}
