/**
 * Secret / credential redaction for structured log context.
 *
 * Defense-in-depth (#1989): the logger, the error-logging path, and the
 * observability log buffer all accept arbitrary `context`/`data` objects from
 * callers and serialize them to log sinks. There is no guarantee a caller
 * never hands us a tokens object, an `Authorization` header bag, or a request
 * body with a password field. This pass masks values whose *key* looks like a
 * credential before serialization, so an accidental
 * `logger.info("...", { authorization: token })` cannot leak the secret.
 *
 * Scope is intentionally key-based: we do not attempt to find secrets embedded
 * in free-form message strings (too lossy). The deny-list errs toward
 * over-redaction — masking a benign `tokenCount` is acceptable; leaking a real
 * token is not. The traversal fails *closed*: on a cycle, depth overflow, or a
 * throwing getter it returns {@link REDACTED} rather than risk emitting an
 * unredacted object.
 */

import { isRecord } from "./core.ts";

/** Replacement value substituted for any sensitive field. */
export const REDACTED = "[REDACTED]";

/**
 * Normalized substrings that mark a key as sensitive. Matching is done against
 * a lowercased, non-alphanumeric-stripped form of the key, so `API-Key`,
 * `api_key`, and `apiKey` all collapse to `apikey` and match.
 *
 * Deliberately omitted to avoid false positives that swamp real logs:
 * - bare `"auth"` (would mask `author`); `authorization`/`authToken` are still
 *   covered via `authorization`/`token`.
 * - short tokens like `"dsn"`/`"sas"` (would mask `feedsNamespace`, etc.).
 */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
  "authorization",
  "cookie",
  "bearer",
  "jwt",
  "connectionstring",
] as const;

/** Stop traversing past this depth to keep the pass cheap and stack-safe. */
const MAX_DEPTH = 16;

/**
 * Whether a context key names a credential and should have its value masked.
 *
 * Uses substring matching on a normalized key, so `clientSecret`,
 * `x-api-key`, and `refresh_token` all match while benign words that merely
 * *contain* a pattern as a separate token (e.g. `author`) do not — `author`
 * normalizes to `author`, which contains none of the patterns.
 */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * A value whose own enumerable keys we can safely rewrite. {@link isRecord}
 * covers any non-null, non-array object — including class instances, whose
 * enumerable fields `JSON.stringify` *would* serialize, so we must traverse
 * them to catch secrets. Objects that define their own `toJSON` (Date, URL,
 * …) serialize to a scalar and are left intact.
 */
function isTraversableRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof (value as { toJSON?: unknown }).toJSON !== "function";
}

function redactValue(value: unknown, depth: number, seen: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    try {
      return value.map((item) => redactValue(item, depth + 1, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (isTraversableRecord(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    try {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = isSensitiveKey(key) ? REDACTED : redactValue(child, depth + 1, seen);
      }
      return out;
    } catch {
      // A throwing getter (or other access error) must never let an
      // unredacted object through: fail closed.
      return REDACTED;
    } finally {
      seen.delete(value);
    }
  }

  // Primitives and scalar-serializing objects (Date, URL, …) are returned
  // untouched: they are not key/value bags we can safely rewrite.
  return value;
}

/**
 * Returns a redacted deep copy of `context`. Any property whose key is
 * {@link isSensitiveKey} has its value replaced with {@link REDACTED}; nested
 * plain objects, class instances, and arrays are traversed. The input is never
 * mutated, and the pass fails closed (returns {@link REDACTED}) on cycles,
 * depth overflow, or a throwing getter.
 */
export function redactSensitive<T>(context: T): T {
  return redactValue(context, 0, new Set<object>()) as T;
}
