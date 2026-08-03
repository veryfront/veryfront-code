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

const JSONStringify = JSON.stringify;

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

function encodeJsonStringProperty(key: string, value: string): string {
  return `${JSONStringify(key)}:${JSONStringify(value)}`;
}

function encodeJsonNullableStringProperty(key: string, value: string | null): string {
  return `${JSONStringify(key)}:${JSONStringify(value)}`;
}

function encodeJsonBooleanProperty(key: string, value: boolean): string {
  return `${JSONStringify(key)}:${value ? "true" : "false"}`;
}

function buildAsyncConfigIdentity(config: TransformConfig): string {
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );
  const fields = [
    encodeJsonStringProperty("transformVersion", VERSION),
    encodeJsonStringProperty("reactVersion", config.reactVersion ?? DEFAULT_REACT_VERSION),
    encodeJsonStringProperty("jsxImportSource", config.jsxImportSource ?? "react"),
    encodeJsonNullableStringProperty("moduleServerUrl", config.moduleServerUrl ?? null),
    encodeJsonNullableStringProperty("vendorBundleHash", config.vendorBundleHash ?? null),
    encodeJsonNullableStringProperty("apiBaseUrl", config.apiBaseUrl ?? null),
    encodeJsonBooleanProperty("studioEmbed", config.studioEmbed ?? false),
    encodeJsonBooleanProperty("dev", config.dev ?? false),
  ];
  if (dependencyPinningCacheVariant) {
    fields.push(
      encodeJsonStringProperty("dependencyPinningCacheVariant", dependencyPinningCacheVariant),
    );
  }
  fields.push(
    encodeJsonStringProperty("csstype", CSSTYPE_VERSION),
    encodeJsonStringProperty("tailwind", TAILWIND_VERSION),
  );
  return `{${fields.join(",")}}`;
}

function encodeConfigPart(label: string, value: string | undefined): string {
  if (!value) return "";
  return `${label}:${value.length}:${value}`;
}

function buildSyncConfigIdentity(config: TransformConfig): string {
  const parts = [
    `v${VERSION}`,
    config.reactVersion ?? DEFAULT_REACT_VERSION,
    config.jsxImportSource ?? "react",
  ];
  const moduleServerUrlPart = encodeConfigPart("modules", config.moduleServerUrl);
  if (moduleServerUrlPart) parts.push(moduleServerUrlPart);
  const vendorBundleHashPart = encodeConfigPart("vendor", config.vendorBundleHash);
  if (vendorBundleHashPart) parts.push(vendorBundleHashPart);
  const apiBaseUrlPart = encodeConfigPart("api", config.apiBaseUrl);
  if (apiBaseUrlPart) parts.push(apiBaseUrlPart);
  if (config.studioEmbed) parts.push("studio");
  if (config.dev) parts.push("dev");
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );
  if (dependencyPinningCacheVariant) {
    parts.push(`pins:${dependencyPinningCacheVariant}`);
  }

  return parts.join(":");
}

/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export function computeConfigHash(config: TransformConfig): Promise<string> {
  return computeHash(buildAsyncConfigIdentity(config));
}

/**
 * Compute a quick config hash synchronously (less fields, faster).
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export function computeConfigHashSync(config: TransformConfig): string {
  return buildSyncConfigIdentity(config);
}
