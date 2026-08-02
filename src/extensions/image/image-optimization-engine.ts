/**
 * Dependency-free contract for image optimization engines.
 *
 * Core owns filesystem access, publication, request/result validation, and
 * resource limits. Extensions own decoding, resizing, and encoding.
 *
 * @module extensions/image/image-optimization-engine
 */

import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import {
  applyExtensionMethod,
  findExtensionPropertyDescriptor,
  freezeExtensionContract,
  getExtensionOwnPropertyDescriptor,
  isDataPropertyDescriptor,
  isExtensionArray,
  isStableExtensionCacheIdentity,
} from "../property-inspection.ts";

/** Registry name used for the image optimization extension contract. */
export const ImageOptimizationEngineName = "ImageOptimizationEngine" as const;

/** Maximum stable implementation identity accepted across the boundary. */
export const MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS =
  IMAGE_OPTIMIZATION.MAX_ENGINE_IDENTITY_CHARACTERS;

/** Formats core can request from an image optimization engine. */
export type ImageOptimizationFormat = "webp" | "avif" | "jpeg" | "png";

/** Immutable byte-oriented request supplied by core. */
export interface ImageOptimizationRequest {
  readonly input: Uint8Array;
  /**
   * Configured target widths. The engine returns each distinct width that does
   * not exceed the decoded source width, plus the source width itself.
   */
  readonly targetWidths: readonly number[];
  /** Every format to produce for each resulting width. */
  readonly formats: readonly ImageOptimizationFormat[];
  /** Encoding quality applied consistently across requested formats. */
  readonly quality: number;
  /** Aborted when the caller cancels or the core operation deadline expires. */
  readonly signal: AbortSignal;
}

/** One encoded output returned by an image optimization engine. */
export interface ImageOptimizationVariantResult {
  readonly format: ImageOptimizationFormat;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Portable result returned by an image optimization engine. */
export interface ImageOptimizationResult {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly variants: readonly ImageOptimizationVariantResult[];
}

/** Image decoder, resizer, and encoder implemented by an explicit extension. */
export interface ImageOptimizationEngine {
  /**
   * Includes every implementation/version input capable of changing output.
   * Represented state must remain immutable for the captured engine lifetime.
   */
  readonly cacheIdentity: string;
  optimize(request: ImageOptimizationRequest): Promise<ImageOptimizationResult>;
}

function readImageOptimizationEngine(value: unknown): {
  implementation: object;
  cacheIdentity: string;
  optimize: ImageOptimizationEngine["optimize"];
} {
  if (typeof value !== "object" || value === null || isExtensionArray(value)) {
    throw new TypeError("ImageOptimizationEngine must be an object");
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
    throw new TypeError("ImageOptimizationEngine properties could not be read", {
      cause,
    });
  }

  if (
    !isDataPropertyDescriptor(cacheIdentityDescriptor)
  ) {
    throw new TypeError(
      "ImageOptimizationEngine cacheIdentity must be an own data property",
    );
  }
  if (!isDataPropertyDescriptor(optimizeDescriptor)) {
    throw new TypeError("ImageOptimizationEngine optimize must be a data property");
  }

  const cacheIdentity = cacheIdentityDescriptor.value;
  const optimize = optimizeDescriptor.value;
  if (
    !isStableExtensionCacheIdentity(
      cacheIdentity,
      MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
    )
  ) {
    throw new TypeError(
      "ImageOptimizationEngine must declare a bounded stable cacheIdentity",
    );
  }
  if (typeof optimize !== "function") {
    throw new TypeError("ImageOptimizationEngine must implement optimize()");
  }
  return {
    implementation: value,
    cacheIdentity,
    optimize: optimize as ImageOptimizationEngine["optimize"],
  };
}

/** Validate an implementation received through the dynamic contract registry. */
export function assertImageOptimizationEngine(
  value: unknown,
): asserts value is ImageOptimizationEngine {
  readImageOptimizationEngine(value);
}

/** Capture dynamic properties once so one run cannot split across mutations. */
export function captureImageOptimizationEngine(
  value: unknown,
): ImageOptimizationEngine {
  const captured = readImageOptimizationEngine(value);
  return freezeExtensionContract({
    cacheIdentity: captured.cacheIdentity,
    optimize(
      request: ImageOptimizationRequest,
    ): Promise<ImageOptimizationResult> {
      return applyExtensionMethod(captured.optimize, captured.implementation, [request]);
    },
  });
}
