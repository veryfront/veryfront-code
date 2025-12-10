/**
 * ID generation utilities following AI SDK best practices
 *
 * @module veryfront/ai/utils/id
 */

/**
 * Generate a unique ID with optional prefix
 *
 * Follows AI SDK generateId pattern:
 * - 16 character alphanumeric string by default
 * - Optional prefix with underscore separator
 *
 * @example
 * ```ts
 * generateId()           // "a1b2c3d4e5f6g7h8"
 * generateId("msg")      // "msg_a1b2c3d4e5f6"
 * generateId("text")     // "text_a1b2c3d4e5f6"
 * ```
 */
export function generateId(prefix?: string): string {
  // Use crypto.randomUUID() and extract hex chars (no dashes)
  const hex = crypto.randomUUID().replace(/-/g, "");

  if (prefix) {
    // With prefix: prefix + 12 chars = ~16-20 chars total
    return `${prefix}_${hex.slice(0, 12)}`;
  }

  // Without prefix: 16 chars (matches AI SDK default)
  return hex.slice(0, 16);
}

/**
 * Create an ID generator with a fixed prefix
 *
 * @example
 * ```ts
 * const generateMessageId = createIdGenerator("msg");
 * generateMessageId() // "msg_a1b2c3d4e5f6"
 * ```
 */
export function createIdGenerator(prefix: string): () => string {
  return () => generateId(prefix);
}
