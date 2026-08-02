/**
 * Dependency-free contract for CSS optimization engines.
 *
 * Core owns request and result validation. Implementations own parser,
 * minifier, browser-query, and source-map details.
 *
 * @module extensions/css/css-optimization-engine
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

/** Registry name used for the CSS optimization extension contract. */
export const CSSOptimizationEngineName = "CSSOptimizationEngine" as const;

/** Maximum stable implementation identity accepted across the runtime boundary. */
export const MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS = 256;

/** Immutable optimization request supplied by core. */
export interface CSSOptimizationRequest {
  readonly css: string;
  readonly sourcePath: string;
  readonly minify: boolean;
  readonly sourceMap: boolean;
}

/** Portable output returned by a CSS optimization engine. */
export interface CSSOptimizationResult {
  readonly css: string;
  readonly sourceMap?: string;
}

/**
 * Parser-backed CSS optimization contract.
 *
 * The operation is intentionally synchronous so existing synchronous core
 * helpers cannot conceal an asynchronous fallback or dynamic import.
 */
export interface CSSOptimizationEngine {
  /**
   * Includes every implementation/version input capable of changing output.
   * Represented state must remain immutable for the captured engine lifetime.
   */
  readonly cacheIdentity: string;
  optimize(request: CSSOptimizationRequest): CSSOptimizationResult;
}

function readCSSOptimizationEngine(value: unknown): {
  implementation: object;
  cacheIdentity: string;
  optimize: CSSOptimizationEngine["optimize"];
} {
  if (typeof value !== "object" || value === null || isExtensionArray(value)) {
    throw new TypeError("CSSOptimizationEngine must be an object");
  }

  let cacheIdentityDescriptor: PropertyDescriptor | undefined;
  let optimizeDescriptor: PropertyDescriptor | undefined;
  try {
    cacheIdentityDescriptor = getExtensionOwnPropertyDescriptor(
      value,
      "cacheIdentity",
    );
    optimizeDescriptor = findExtensionPropertyDescriptor(value, "optimize");
  } catch (cause) {
    throw new TypeError("CSSOptimizationEngine properties could not be read", {
      cause,
    });
  }

  if (
    !isDataPropertyDescriptor(cacheIdentityDescriptor)
  ) {
    throw new TypeError(
      "CSSOptimizationEngine cacheIdentity must be an own data property",
    );
  }
  if (!isDataPropertyDescriptor(optimizeDescriptor)) {
    throw new TypeError("CSSOptimizationEngine optimize must be a data property");
  }

  const cacheIdentity = cacheIdentityDescriptor.value;
  const optimize = optimizeDescriptor.value;

  if (
    !isStableExtensionCacheIdentity(
      cacheIdentity,
      MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
    )
  ) {
    throw new TypeError(
      "CSSOptimizationEngine must declare a bounded stable cacheIdentity",
    );
  }
  if (typeof optimize !== "function") {
    throw new TypeError("CSSOptimizationEngine must implement optimize()");
  }
  return {
    implementation: value,
    cacheIdentity,
    optimize: optimize as CSSOptimizationEngine["optimize"],
  };
}

/** Validate an implementation received through the dynamic contract registry. */
export function assertCSSOptimizationEngine(
  value: unknown,
): asserts value is CSSOptimizationEngine {
  readCSSOptimizationEngine(value);
}

/**
 * Capture dynamic properties once so later mutation or accessors cannot change
 * the implementation that core invokes.
 */
export function captureCSSOptimizationEngine(
  value: unknown,
): CSSOptimizationEngine {
  const captured = readCSSOptimizationEngine(value);
  return freezeExtensionContract({
    cacheIdentity: captured.cacheIdentity,
    optimize(request: CSSOptimizationRequest): CSSOptimizationResult {
      return applyExtensionMethod(captured.optimize, captured.implementation, [request]);
    },
  });
}
