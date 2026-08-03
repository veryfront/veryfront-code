/**
 * Configuration hash for transform cache keys.
 *
 * Computes a hash of transform-affecting configuration to ensure
 * cache entries are invalidated when configuration changes.
 */

import { computeHash } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import {
  primordialArrayJoin as arrayJoin,
  primordialArrayPush as arrayPush,
} from "#veryfront/platform/compat/primordials/array.ts";
import {
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  TAILWIND_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { buildDependencyPinningCacheVariant } from "./keys/dependency-pinning.ts";

const JSONStringify = JSON.stringify;
const ObjectCreate = Object.create;

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
  // Null-prototype storage preserves the existing JSON cache-key format while
  // preventing project code from injecting an inherited toJSON hook.
  const normalized = ObjectCreate(null) as Record<string, string | boolean | null>;
  normalized.transformVersion = VERSION;
  normalized.reactVersion = config.reactVersion ?? DEFAULT_REACT_VERSION;
  normalized.jsxImportSource = config.jsxImportSource ?? "react";
  normalized.moduleServerUrl = config.moduleServerUrl ?? null;
  normalized.vendorBundleHash = config.vendorBundleHash ?? null;
  normalized.apiBaseUrl = config.apiBaseUrl ?? null;
  normalized.studioEmbed = config.studioEmbed ?? false;
  normalized.dev = config.dev ?? false;
  if (dependencyPinningCacheVariant) {
    normalized.dependencyPinningCacheVariant = dependencyPinningCacheVariant;
  }
  normalized.csstype = CSSTYPE_VERSION;
  normalized.tailwind = TAILWIND_VERSION;

  return computeHash(JSONStringify(normalized));
}

/**
 * Compute a quick config hash synchronously (less fields, faster).
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export function computeConfigHashSync(config: TransformConfig): string {
  const parts: string[] = [];
  arrayPush(parts, `v${VERSION}`);
  arrayPush(parts, config.reactVersion ?? DEFAULT_REACT_VERSION);
  arrayPush(parts, config.jsxImportSource ?? "react");
  const moduleServerUrlPart = encodeConfigPart("modules", config.moduleServerUrl);
  if (moduleServerUrlPart) arrayPush(parts, moduleServerUrlPart);
  const vendorBundleHashPart = encodeConfigPart("vendor", config.vendorBundleHash);
  if (vendorBundleHashPart) arrayPush(parts, vendorBundleHashPart);
  const apiBaseUrlPart = encodeConfigPart("api", config.apiBaseUrl);
  if (apiBaseUrlPart) arrayPush(parts, apiBaseUrlPart);
  if (config.studioEmbed) arrayPush(parts, "studio");
  if (config.dev) arrayPush(parts, "dev");
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );
  if (dependencyPinningCacheVariant) {
    arrayPush(parts, `pins:${dependencyPinningCacheVariant}`);
  }

  return arrayJoin(parts, ":");
}

function encodeConfigPart(label: string, value: string | undefined): string {
  if (!value) return "";
  return `${label}:${value.length}:${value}`;
}
