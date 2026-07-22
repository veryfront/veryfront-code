/***********************
 * Shared utility functions for cross-runtime testing.
 ***********************/

import { isDeepStrictEqual } from "node:util";

export function deepEquals(a: unknown, b: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  // Preserve the historical third parameter for source compatibility. The
  // runtime helper owns pair-aware cycle tracking; a one-sided WeakSet can
  // incorrectly accept unrelated cyclic graphs.
  void seen;
  return isDeepStrictEqual(a, b);
}

/** Serialize unknown values safely for test output. */
export function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch (_) {
    /* expected: value may contain circular references or non-serializable types */
  }

  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "[Function]";
  if (typeof value === "object") {
    try {
      return `[${(value as object).constructor?.name ?? "Object"}]`;
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}
