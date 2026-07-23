/**
 * Configuration hash for transform cache keys.
 *
 * Computes a hash of transform-affecting configuration to ensure
 * cache entries are invalidated when configuration changes.
 */

import { VERSION } from "#veryfront/utils/version.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "./validation.ts";
import {
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  TAILWIND_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { hashString, sha256Hex } from "./hash.ts";

/**
 * Configuration that affects transform output.
 */
interface TransformConfig {
  /** React version for esm.sh URLs */
  reactVersion?: string;
  /** JSX import source */
  jsxImportSource?: string;
  /** Enable Studio Navigator embed */
  studioEmbed?: boolean;
  /** Development mode */
  dev?: boolean;
  /** Module server used when rewriting browser imports. */
  moduleServerUrl?: string;
  /** Vendor bundle identity used for cache-busting import URLs. */
  vendorBundleHash?: string;
  /** API origin used when rewriting cross-project imports. */
  apiBaseUrl?: string;
}

const MAX_TRANSFORM_CONFIG_STRING_LENGTH = 4096;

function invalidTransformConfig(): never {
  throw INVALID_ARGUMENT.create({ message: "Transform cache configuration is invalid" });
}

function normalizeTransformConfig(config: TransformConfig): {
  transformVersion: string;
  reactVersion: string;
  jsxImportSource: string;
  studioEmbed: boolean;
  dev: boolean;
  moduleServerUrl: string | null;
  vendorBundleHash: string | null;
  apiBaseUrl: string | null;
  csstype: string;
  tailwind: string;
} {
  if (typeof config !== "object" || config === null) invalidTransformConfig();

  let reactVersion: unknown;
  let jsxImportSource: unknown;
  let studioEmbed: unknown;
  let dev: unknown;
  let moduleServerUrl: unknown;
  let vendorBundleHash: unknown;
  let apiBaseUrl: unknown;
  try {
    reactVersion = Reflect.get(config, "reactVersion");
    jsxImportSource = Reflect.get(config, "jsxImportSource");
    studioEmbed = Reflect.get(config, "studioEmbed");
    dev = Reflect.get(config, "dev");
    moduleServerUrl = Reflect.get(config, "moduleServerUrl");
    vendorBundleHash = Reflect.get(config, "vendorBundleHash");
    apiBaseUrl = Reflect.get(config, "apiBaseUrl");
  } catch {
    invalidTransformConfig();
  }

  for (
    const value of [
      reactVersion,
      jsxImportSource,
      moduleServerUrl,
      vendorBundleHash,
      apiBaseUrl,
    ]
  ) {
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length === 0 ||
        value.length > MAX_TRANSFORM_CONFIG_STRING_LENGTH ||
        containsUnsafeCacheStringCharacter(value))
    ) {
      invalidTransformConfig();
    }
  }
  for (const value of [studioEmbed, dev]) {
    if (value !== undefined && typeof value !== "boolean") invalidTransformConfig();
  }

  return {
    transformVersion: VERSION,
    reactVersion: (reactVersion as string | undefined) ?? DEFAULT_REACT_VERSION,
    jsxImportSource: (jsxImportSource as string | undefined) ?? "react",
    studioEmbed: (studioEmbed as boolean | undefined) ?? false,
    dev: (dev as boolean | undefined) ?? false,
    moduleServerUrl: (moduleServerUrl as string | undefined) ?? null,
    vendorBundleHash: (vendorBundleHash as string | undefined) ?? null,
    apiBaseUrl: (apiBaseUrl as string | undefined) ?? null,
    csstype: CSSTYPE_VERSION,
    tailwind: TAILWIND_VERSION,
  };
}

/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export function computeConfigHash(config: TransformConfig): Promise<string> {
  return sha256Hex(JSON.stringify(normalizeTransformConfig(config)));
}

/**
 * Compute a non-cryptographic config hash synchronously over the canonical fields.
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export function computeConfigHashSync(config: TransformConfig): string {
  const canonical = JSON.stringify(normalizeTransformConfig(config));
  return `v3.${hashString(canonical)}`;
}
