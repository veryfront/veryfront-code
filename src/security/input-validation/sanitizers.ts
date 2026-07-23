/** Sanitize data to prevent XSS and prototype pollution attacks. */
export function sanitizeData(data: unknown): unknown {
  return sanitizeValue(data, new WeakSet<object>(), 0);
}

const MAX_SANITIZE_DEPTH = 100;

function sanitizeValue(data: unknown, active: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_SANITIZE_DEPTH) {
    throw new TypeError(`Cannot sanitize data deeper than ${MAX_SANITIZE_DEPTH} levels`);
  }
  if (typeof data === "string") return sanitizeString(data);
  if (data == null || typeof data !== "object") return data;

  if (active.has(data)) throw new TypeError("Cannot sanitize cyclic data");
  active.add(data);
  try {
    if (Array.isArray(data)) {
      return data.map((value) => sanitizeValue(value, active, depth + 1));
    }
    return sanitizeObject(data as Record<string, unknown>, active, depth + 1);
  } finally {
    active.delete(data);
  }
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
  active: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = Object.create(null);

  for (const [key, value] of Object.entries(obj)) {
    const safeKey = sanitizeKey(key);
    if (!isAllowedKey(safeKey)) continue;

    sanitized[safeKey] = sanitizeValue(value, active, depth);
  }

  return sanitized;
}

function sanitizeKey(key: string): string {
  // Normalize Unicode (NFKC) first so homoglyphs like U+017F (long s) or
  // U+FF50 (fullwidth p) become their ASCII equivalents before stripping.
  return key.normalize("NFKC").replace(/[^\w.-]/g, "");
}

function isAllowedKey(key: string): boolean {
  // Normalize Unicode (NFKC) before case-folding to prevent bypass via
  // homoglyphs like U+017F (long s) or U+0131 (dotless i).
  const lower = key.normalize("NFKC").toLowerCase();
  return (
    !lower.includes("__proto__") &&
    !lower.includes("constructor") &&
    !lower.includes("prototype")
  );
}
