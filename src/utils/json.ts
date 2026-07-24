/**
 * Safe JSON parse utilities, dependency-free.
 *
 * @module utils/json
 */

/** Tagged-union result of {@link safeJsonParse}; narrow via the `ok` discriminant. */
export type SafeJsonParseResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

/**
 * Parse `value` as JSON without throwing; failures return `{ ok: false, error }`
 * so callers handle them without a surrounding try/catch.
 */
export function safeJsonParse<T = unknown>(value: string): SafeJsonParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(value) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
