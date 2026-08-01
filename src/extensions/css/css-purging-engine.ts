/**
 * Dependency-free contract for unused-rule and critical-CSS engines.
 *
 * Core owns validation and resource limits. Extensions own parser/vendor
 * imports and their implementation-specific configuration.
 *
 * @module extensions/css/css-purging-engine
 */

import {
  applyExtensionMethod,
  findExtensionPropertyDescriptor,
  freezeExtensionContract,
  getExtensionOwnPropertyDescriptor,
  isDataPropertyDescriptor,
  isExtensionArray,
  isStableExtensionCacheIdentity,
} from "../property-inspection.ts";

export const CSSPurgingEngineName = "CSSPurgingEngine" as const;
export const MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS = 256;

export interface CSSPurgeContentSource {
  readonly raw: string;
  readonly extension: string;
}

export interface CSSPurgingRequest {
  readonly css: string;
  readonly content: readonly CSSPurgeContentSource[];
  readonly safelist: readonly string[];
  readonly includeRejectedCSS: boolean;
}

export interface CSSPurgingResult {
  readonly css: string;
  readonly rejectedCSS?: string;
}

export interface CSSPurgingEngine {
  /**
   * Includes every implementation/version input capable of changing output.
   * Represented state must remain immutable for the captured engine lifetime.
   */
  readonly cacheIdentity: string;
  purge(request: CSSPurgingRequest): Promise<CSSPurgingResult>;
}

function readCSSPurgingEngine(value: unknown): {
  implementation: object;
  cacheIdentity: string;
  purge: CSSPurgingEngine["purge"];
} {
  if (typeof value !== "object" || value === null || isExtensionArray(value)) {
    throw new TypeError("CSSPurgingEngine must be an object");
  }

  let cacheIdentityDescriptor: PropertyDescriptor | undefined;
  let purgeDescriptor: PropertyDescriptor | undefined;
  try {
    cacheIdentityDescriptor = getExtensionOwnPropertyDescriptor(value, "cacheIdentity");
    purgeDescriptor = findExtensionPropertyDescriptor(value, "purge");
  } catch (cause) {
    throw new TypeError("CSSPurgingEngine properties could not be read", { cause });
  }

  if (!isDataPropertyDescriptor(cacheIdentityDescriptor)) {
    throw new TypeError("CSSPurgingEngine cacheIdentity must be an own data property");
  }
  if (!isDataPropertyDescriptor(purgeDescriptor)) {
    throw new TypeError("CSSPurgingEngine purge must be a data property");
  }

  const cacheIdentity = cacheIdentityDescriptor.value;
  const purge = purgeDescriptor.value;
  if (
    !isStableExtensionCacheIdentity(
      cacheIdentity,
      MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS,
    )
  ) {
    throw new TypeError("CSSPurgingEngine must declare a bounded stable cacheIdentity");
  }
  if (typeof purge !== "function") {
    throw new TypeError("CSSPurgingEngine must implement purge()");
  }
  return {
    implementation: value,
    cacheIdentity,
    purge: purge as CSSPurgingEngine["purge"],
  };
}

export function assertCSSPurgingEngine(value: unknown): asserts value is CSSPurgingEngine {
  readCSSPurgingEngine(value);
}

/** Capture identity and method once so registry mutation cannot split a run. */
export function captureCSSPurgingEngine(value: unknown): CSSPurgingEngine {
  const captured = readCSSPurgingEngine(value);
  return freezeExtensionContract({
    cacheIdentity: captured.cacheIdentity,
    purge(request: CSSPurgingRequest): Promise<CSSPurgingResult> {
      return applyExtensionMethod(captured.purge, captured.implementation, [request]);
    },
  });
}
