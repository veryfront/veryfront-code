/**
 * Reading the server-written hydration data.
 *
 * The payload shape is {@link HydrationDataStructure}, written by
 * `hydration-data-generator.ts` into `#veryfront-hydration-data`. Importing the
 * type here is what makes client reads of it compile-checked; the import is
 * type-only so it leaves no trace in the shipped bundle.
 */

import type { PageDataPayload, RuntimeDocument } from "./env.ts";
import {
  findServerHydrationDataElement,
  HYDRATION_DATA_ELEMENT_ID,
} from "../../hydration-data-element.ts";

export { findServerHydrationDataElement, HYDRATION_DATA_ELEMENT_ID };

/**
 * Never throws: a missing or malformed payload degrades to an empty object so
 * the runtime can still boot and fall back to Pages Router resolution.
 */
export function readInitialHydrationData(document: RuntimeDocument): PageDataPayload {
  try {
    const element = findServerHydrationDataElement(document);
    return JSON.parse(element && element.textContent ? element.textContent : "{}") || {};
  } catch (_) {
    return {};
  }
}

/**
 * The dependency snapshot this document was rendered against, or null when
 * pinning is off. Page data fetched later must agree with it.
 */
export function readDocumentDependencyPinningCacheKey(
  initialHydrationData: PageDataPayload,
): string | null {
  return typeof initialHydrationData.dependencyPinningCacheKey === "string" &&
      initialHydrationData.dependencyPinningCacheKey.startsWith("on:")
    ? initialHydrationData.dependencyPinningCacheKey
    : null;
}
