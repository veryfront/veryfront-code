/**
 * Sanitize JSON-like data by HTML-encoding string values and removing keys
 * that can mutate an object's prototype chain.
 *
 * @deprecated Prefer contextual output encoding and schema validation. This
 * compatibility API is retained because removing it requires a major release.
 */
export function sanitizeData(data: unknown): unknown {
  if (typeof data === "string") return sanitizeString(data);
  if (Array.isArray(data)) return data.map(sanitizeData);
  if (data == null || typeof data !== "object") return data;
  return sanitizeObject(data as Record<string, unknown>);
}

function sanitizeString(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    const safeKey = sanitizeKey(key);
    if (!isAllowedKey(safeKey)) continue;
    sanitized[safeKey] = sanitizeData(entry);
  }
  return sanitized;
}

function sanitizeKey(key: string): string {
  return key.normalize("NFKC").replace(/[^\w.-]/g, "");
}

function isAllowedKey(key: string): boolean {
  const lower = key.normalize("NFKC").toLowerCase();
  return !lower.includes("__proto__") &&
    !lower.includes("constructor") &&
    !lower.includes("prototype");
}
