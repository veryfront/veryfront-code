/**
 * Portable @std/async shim for Node.js and Bun.
 *
 * In Deno: Uses @std/async
 * In Node.js/Bun: Provides compatible implementations
 *
 * @module
 */

import { isDeno } from "../runtime.ts";
import { getEnv } from "../process.ts";

const DEFAULT_SCALE = 1;

function readScale(): number {
  const raw = getEnv("VF_TEST_TIME_SCALE");
  if (!raw) return DEFAULT_SCALE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCALE;
  return parsed;
}

function scaleDelay(ms: number): number {
  const scale = readScale();
  if (scale === 1) return ms;
  return Math.max(1, Math.round(ms * scale));
}

// ============================================================================
// Node.js/Bun implementation
// ============================================================================

/**
 * Delays execution for a specified number of milliseconds.
 */
function nodeDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleDelay(ms)));
}

// ============================================================================
// Exports
// ============================================================================

export let delay: (ms: number) => Promise<void>;

if (isDeno) {
  // Deno: Use @std/async
  const stdAsync = await import("@std/async");
  delay = (ms: number) => stdAsync.delay(scaleDelay(ms));
} else {
  // Node.js/Bun: Use our implementation
  delay = nodeDelay;
}
