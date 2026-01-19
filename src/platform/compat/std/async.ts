/**
 * Portable @std/async shim for Node.js and Bun.
 *
 * In Deno: Uses @std/async
 * In Node.js/Bun: Provides compatible implementations
 *
 * @module
 */

import { isDeno } from "../runtime.ts";
import { scaleMs } from "../../../testing/timing.ts";

// ============================================================================
// Node.js/Bun implementation
// ============================================================================

/**
 * Delays execution for a specified number of milliseconds.
 * Uses scaleMs from testing/timing.ts for consistent time scaling.
 */
function nodeDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

// ============================================================================
// Exports
// ============================================================================

export let delay: (ms: number) => Promise<void>;

if (isDeno) {
  // Deno: Use @std/async with time scaling
  const stdAsync = await import("#std/async.ts");
  delay = (ms: number) => stdAsync.delay(scaleMs(ms));
} else {
  // Node.js/Bun: Use our implementation
  delay = nodeDelay;
}
