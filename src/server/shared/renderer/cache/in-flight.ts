/**
 * In-Flight Request Tracking
 *
 * Prevents duplicate renderer creation for concurrent requests.
 *
 * @module server/shared/renderer/cache/in-flight
 */

import type { RendererPromise } from "../types.ts";
import { inFlightCreations } from "../state.ts";

/**
 * Get an in-flight creation promise if one exists for the given key.
 */
export function getInFlightCreation(key: string): RendererPromise | undefined {
  return inFlightCreations.get(key);
}

/**
 * Register an in-flight creation promise.
 * Must be called synchronously before any await to prevent race conditions.
 */
export function setInFlightCreation(key: string, promise: RendererPromise): void {
  inFlightCreations.set(key, promise);
}

/**
 * Remove an in-flight creation promise after it completes.
 */
export function clearInFlightCreation(key: string): void {
  inFlightCreations.delete(key);
}
