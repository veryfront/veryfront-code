/**
 * Input Sanitizers
 * Functions for sanitizing and cleaning untrusted input
 */

/**
 * Sanitize data to prevent XSS and injection attacks
 *
 * @param data - Data to sanitize (can be string, array, object, or primitive)
 * @returns Sanitized data with HTML entities encoded and dangerous keys removed
 *
 * @example
 * ```ts
 * sanitizeData('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
 *
 * sanitizeData({ __proto__: 'malicious', safe: 'value' })
 * // Returns: { safe: 'value' } (prototype pollution prevented)
 * ```
 */
export function sanitizeData(data: unknown): unknown {
  if (typeof data === "string") {
    return sanitizeString(data);
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  if (data && typeof data === "object") {
    return sanitizeObject(data as Record<string, unknown>);
  }

  return data;
}

/**
 * Sanitize a string by encoding HTML entities
 *
 * @param str - String to sanitize
 * @returns String with HTML entities encoded
 */
function sanitizeString(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Sanitize an object by cleaning keys and recursively sanitizing values
 *
 * @param obj - Object to sanitize
 * @returns Sanitized object with dangerous keys removed
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Sanitize keys too (prevent prototype pollution)
    const safeKey = sanitizeKey(key);
    if (isAllowedKey(safeKey)) {
      sanitized[safeKey] = sanitizeData(value);
    }
  }

  return sanitized;
}

/**
 * Sanitize an object key by removing non-word characters
 *
 * @param key - Object key to sanitize
 * @returns Sanitized key
 */
function sanitizeKey(key: string): string {
  return key.replace(/[^\w.-]/g, "");
}

/**
 * Check if a key is allowed (not a dangerous prototype property)
 *
 * @param key - Object key to check
 * @returns True if key is safe to use
 */
function isAllowedKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}
