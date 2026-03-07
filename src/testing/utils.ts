/***********************
 * Shared utility functions for cross-runtime testing.
 ***********************/

export function deepEquals(a: unknown, b: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEquals(val, b[i], seen));
  }

  const aObj = a as object;
  const bObj = b as object;

  if (seen.has(aObj)) return true;
  seen.add(aObj);

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;

  return aKeys.every((key) => deepEquals(aRec[key], bRec[key], seen));
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (_) {
    /* expected: value may contain circular references or non-serializable types */
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "[Function]";
    if (typeof value === "object") return `[${(value as object).constructor?.name ?? "Object"}]`;
    return String(value);
  }
}
