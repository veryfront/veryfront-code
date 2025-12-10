/**
 * ID generation utilities following AI SDK best practices
 *
 * AI SDK uses nanoid internally with these defaults:
 * - 16 character alphanumeric string (a-zA-Z0-9)
 * - Dash separator for prefixed IDs
 *
 * @module veryfront/ai/utils/id
 */

// URL-safe alphabet matching nanoid default (no special chars for simplicity)
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generate a random alphanumeric string
 */
function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return result;
}

/**
 * Generate a unique ID with optional prefix
 *
 * Follows AI SDK generateId pattern:
 * - 16 character alphanumeric string by default
 * - Optional prefix with dash separator (AI SDK default)
 *
 * @example
 * ```ts
 * generateId()           // "a1B2c3D4e5F6g7H8"
 * generateId("msg")      // "msg-a1B2c3D4e5F6g7H8"
 * generateId("text")     // "text-a1B2c3D4e5F6g7H8"
 * ```
 */
export function generateId(prefix?: string): string {
  const id = randomString(16);

  if (prefix) {
    return `${prefix}-${id}`;
  }

  return id;
}

/**
 * Create an ID generator with a fixed prefix and optional configuration
 *
 * @example
 * ```ts
 * const generateMessageId = createIdGenerator({ prefix: "msg" });
 * generateMessageId() // "msg-a1B2c3D4e5F6g7H8"
 *
 * const generateShortId = createIdGenerator({ prefix: "user", size: 8 });
 * generateShortId() // "user-a1B2c3D4"
 * ```
 */
export function createIdGenerator(options: {
  prefix?: string;
  separator?: string;
  size?: number;
}): () => string {
  const { prefix, separator = "-", size = 16 } = options;

  return () => {
    const id = randomString(size);
    if (prefix) {
      return `${prefix}${separator}${id}`;
    }
    return id;
  };
}
