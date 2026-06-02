/**
 * Secret / credential redaction for structured log context.
 *
 * Defense-in-depth (#1989): the logger and the error-logging path both accept
 * arbitrary `context` objects from callers and serialize them to log sinks.
 * There is no guarantee a caller never hands us a tokens object, an
 * `Authorization` header bag, or a request body with a password field. This
 * pass masks values whose *key* looks like a credential before serialization,
 * so an accidental `logger.info("...", { authorization: token })` cannot leak
 * the secret.
 *
 * Scope is intentionally key-based: we do not attempt to find secrets embedded
 * in free-form message strings (too lossy). The deny-list errs toward
 * over-redaction — masking a benign `tokenCount` is acceptable; leaking a real
 * token is not.
 */

/** Replacement value substituted for any sensitive field. */
export const REDACTED = "[REDACTED]";

/**
 * Normalized substrings that mark a key as sensitive. Matching is done against
 * a lowercased, non-alphanumeric-stripped form of the key, so `API-Key`,
 * `api_key`, and `apiKey` all collapse to `apikey` and match.
 */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwd",
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
] as const;

/** Stop traversing past this depth to keep the pass cheap and loop-safe. */
const MAX_DEPTH = 8;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(child, depth + 1, seen);
    }
    return out;
  }

  // Primitives and non-plain objects (Error, Date, Map, class instances) are
  // returned untouched: they are not key/value bags we can safely rewrite, and
  // structured serialization handles them elsewhere.
  return value;
}

/**
 * Returns a redacted deep copy of `context`. Any property whose key is
 * {@link isSensitiveKey} has its value replaced with {@link REDACTED}; nested
 * plain objects and arrays are traversed. The input is never mutated.
 */
export function redactSensitive<T>(context: T): T {
  return redactValue(context, 0, new WeakSet()) as T;
}
