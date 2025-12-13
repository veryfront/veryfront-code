/**
 * Keys that should never be allowed in sanitized objects to prevent prototype pollution
 */
const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

/**
 * Sanitizes data by escaping HTML entities in strings and sanitizing object keys.
 * Handles circular references by tracking visited objects.
 */
export function sanitizeData(data: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof data === "string") {
    return sanitizeString(data);
  }

  if (data === null || typeof data !== "object") {
    return data;
  }

  // Handle circular references
  if (seen.has(data)) {
    return "[Circular Reference]";
  }
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item, seen));
  }

  return sanitizeObject(data as Record<string, unknown>, seen);
}

function sanitizeString(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function sanitizeObject(
  obj: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = Object.create(null); // Use null prototype to prevent prototype pollution

  for (const [key, value] of Object.entries(obj)) {
    const safeKey = sanitizeKey(key);
    if (isAllowedKey(safeKey)) {
      sanitized[safeKey] = sanitizeData(value, seen);
    }
  }

  return sanitized;
}

function sanitizeKey(key: string): string {
  return key.replace(/[^\w.-]/g, "");
}

function isAllowedKey(key: string): boolean {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}
