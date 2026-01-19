/**
 * Shared utility functions for cross-runtime testing.
 *
 * These utilities are used by both the assertion module and the expect module
 * to provide consistent behavior across runtimes.
 *
 * @module
 */

/**
 * Deep equality check that handles circular references.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @param seen - WeakSet to track circular references (internal)
 * @returns true if values are deeply equal
 */
export function deepEquals(a: unknown, b: unknown, seen = new WeakSet()): boolean {
  // Strict equality for primitives
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEquals(val, b[i], seen));
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  // Handle circular references
  if (seen.has(a as object)) return true; // Assume equal if we've seen it
  seen.add(a as object);

  // Handle objects
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEquals(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      seen,
    )
  );
}

/**
 * Safely stringify a value, handling circular references and special types.
 *
 * @param value - Value to stringify
 * @returns String representation of the value
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // Handle circular references or other JSON errors
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "[Function]";
    if (typeof value === "object") {
      const name = (value as object).constructor?.name || "Object";
      return `[${name}]`;
    }
    return String(value);
  }
}
