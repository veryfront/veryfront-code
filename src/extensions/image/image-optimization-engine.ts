/**
 * Dependency-free contract for image optimization engines.
 *
 * Core owns filesystem access, publication, request/result validation, and
 * resource limits. Extensions own decoding, resizing, and encoding.
 *
 * @module extensions/image/image-optimization-engine
 */

import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import { findExtensionPropertyDescriptor } from "../property-inspection.ts";

/** Registry name used for the image optimization extension contract. */
export const ImageOptimizationEngineName = "ImageOptimizationEngine" as const;

/** Maximum stable implementation identity accepted across the boundary. */
export const MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS =
  IMAGE_OPTIMIZATION.MAX_ENGINE_IDENTITY_CHARACTERS;

/** Formats core can request from an image optimization engine. */
export type ImageOptimizationFormat = "webp" | "avif" | "jpeg" | "png";

/** One immutable output requested from an image optimization engine. */
export interface ImageOptimizationVariantRequest {
  readonly format: ImageOptimizationFormat;
  readonly width: number;
  readonly quality: number;
}

/** Immutable byte-oriented request supplied by core. */
export interface ImageOptimizationRequest {
  readonly input: Uint8Array;
  readonly variants: readonly ImageOptimizationVariantRequest[];
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
  /** Includes every implementation/version input capable of changing output. */
  readonly cacheIdentity: string;
  optimize(request: ImageOptimizationRequest): Promise<ImageOptimizationResult>;
}

function readImageOptimizationEngine(value: unknown): {
  cacheIdentity: string;
  optimize: ImageOptimizationEngine["optimize"];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("ImageOptimizationEngine must be an object");
  }

  let cacheIdentityDescriptor: PropertyDescriptor | undefined;
  let optimizeDescriptor: PropertyDescriptor | undefined;
  try {
    cacheIdentityDescriptor = Object.getOwnPropertyDescriptor(
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
    cacheIdentityDescriptor === undefined ||
    !("value" in cacheIdentityDescriptor)
  ) {
    throw new TypeError(
      "ImageOptimizationEngine cacheIdentity must be an own data property",
    );
  }
  if (optimizeDescriptor === undefined || !("value" in optimizeDescriptor)) {
    throw new TypeError(
      "ImageOptimizationEngine optimize must be a data property",
    );
  }

  const cacheIdentity = cacheIdentityDescriptor.value;
  const optimize = optimizeDescriptor.value;
  if (
    typeof cacheIdentity !== "string" ||
    cacheIdentity.length === 0 ||
    cacheIdentity.length > MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS ||
    cacheIdentity.trim() !== cacheIdentity ||
    cacheIdentity.normalize("NFC") !== cacheIdentity ||
    /\p{Cc}/u.test(cacheIdentity)
  ) {
    throw new TypeError(
      "ImageOptimizationEngine must declare a bounded stable cacheIdentity",
    );
  }
  if (typeof optimize !== "function") {
    throw new TypeError("ImageOptimizationEngine must implement optimize()");
  }
  return {
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
  return Object.freeze({
    cacheIdentity: captured.cacheIdentity,
    optimize(
      request: ImageOptimizationRequest,
    ): Promise<ImageOptimizationResult> {
      return Reflect.apply(captured.optimize, value, [request]);
    },
  });
}
