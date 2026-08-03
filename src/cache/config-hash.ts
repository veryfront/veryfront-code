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

const IntrinsicTypeError = TypeError;
const JSONStringify = JSON.stringify;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;

function hasOwn(object: object, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, object, [key]) as boolean;
}

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

function readOwnConfigField(
  config: TransformConfig,
  key: keyof TransformConfig,
): unknown {
  if (config === null || typeof config !== "object") {
    throw new IntrinsicTypeError("Transform config must be an object");
  }
  const descriptor = ObjectGetOwnPropertyDescriptor(config, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new IntrinsicTypeError(`Transform config ${key} must be an own data property`);
  }
  return descriptor.value;
}

function readOptionalConfigString(
  config: TransformConfig,
  key: keyof TransformConfig,
): string | undefined {
  const value = readOwnConfigField(config, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new IntrinsicTypeError(`Transform config ${key} must be a string`);
  }
  return value;
}

function readOptionalConfigBoolean(
  config: TransformConfig,
  key: "studioEmbed" | "dev",
): boolean | undefined {
  const value = readOwnConfigField(config, key);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new IntrinsicTypeError(`Transform config ${key} must be a boolean`);
  }
  return value;
}

function encodeNullableConfigString(value: string | null): string {
  return JSONStringify(value) as string;
}

function buildConfigIdentity(config: TransformConfig): string {
  const dependencyPinningCacheKey = readOptionalConfigString(
    config,
    "dependencyPinningCacheKey",
  );
  const moduleServerOrigin = readOptionalConfigString(config, "moduleServerOrigin");
  const dependencyPinningCacheVariant = buildDependencyPinningCacheVariant(
    dependencyPinningCacheKey,
    moduleServerOrigin,
  );
  let identity = `v${VERSION}`;
  identity += `|react=${
    encodeNullableConfigString(
      readOptionalConfigString(config, "reactVersion") ?? DEFAULT_REACT_VERSION,
    )
  }`;
  identity += `|jsx=${
    encodeNullableConfigString(
      readOptionalConfigString(config, "jsxImportSource") ?? "react",
    )
  }`;
  identity += `|modules=${
    encodeNullableConfigString(
      readOptionalConfigString(config, "moduleServerUrl") ?? null,
    )
  }`;
  identity += `|vendor=${
    encodeNullableConfigString(
      readOptionalConfigString(config, "vendorBundleHash") ?? null,
    )
  }`;
  identity += `|api=${
    encodeNullableConfigString(
      readOptionalConfigString(config, "apiBaseUrl") ?? null,
    )
  }`;
  identity += `|studio=${readOptionalConfigBoolean(config, "studioEmbed") ?? false ? "1;" : "0;"}`;
  identity += `|dev=${readOptionalConfigBoolean(config, "dev") ?? false ? "1;" : "0;"}`;
  identity += `|pins=${
    encodeNullableConfigString(
      dependencyPinningCacheVariant ?? null,
    )
  }`;
  identity += `|csstype=${encodeNullableConfigString(CSSTYPE_VERSION)}`;
  identity += `|tailwind=${encodeNullableConfigString(TAILWIND_VERSION)}`;
  return identity;
}

/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export function computeConfigHash(config: TransformConfig): Promise<string> {
  return computeHash(buildConfigIdentity(config));
}

/**
 * Compute a quick config hash synchronously (less fields, faster).
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export function computeConfigHashSync(config: TransformConfig): string {
  return buildConfigIdentity(config);
}
