import { serverLogger as logger } from "#veryfront/utils";

/**
 * Filters props for client components, removing children and non-serializable values.
 */
export function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const serializable: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === "children") continue;

    if (isSerializable(value)) {
      serializable[key] = value;
    } else {
      logger.warn(`[RSC] Skipping non-serializable prop: ${key}`);
    }
  }

  return serializable;
}

/**
 * Stringify props with safe handling of circular references.
 */
export function stringifyProps(props: Record<string, unknown>): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(props, (_key, value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    return value;
  });
}

/**
 * Check if a value is JSON-serializable.
 */
function isSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || value === undefined) return true;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return true;
  if (type === "function" || type === "symbol" || type === "bigint") return false;

  if (type === "object") {
    if (seen.has(value as object)) return false;
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.every((item) => isSerializable(item, seen));
    }

    try {
      for (const v of Object.values(value as Record<string, unknown>)) {
        if (!isSerializable(v, seen)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
