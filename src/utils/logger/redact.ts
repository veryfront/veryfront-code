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
  "clientsecret",
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
  "signature",
  "sessionid",
  "sid",
  "otp",
  "mfa",
  "pin",
  "salt",
  "xsrf",
  "csrf",
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
 * A non-null, non-array object. {@link isRecord} covers class instances too,
 * whose enumerable fields `JSON.stringify` *would* serialize, so we must
 * traverse them to catch secrets.
 */
function isTraversableRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === "function";
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

  // Objects defining `toJSON` (Date, URL, custom serializers) are serialized
  // by `JSON.stringify` via the *return value* of `toJSON`, not their own
  // enumerable keys. A key-based pass over the object's own properties would
  // therefore miss credentials smuggled through `toJSON`, e.g.
  // `{ toJSON: () => ({ apiKey: "sk-..." }) }` (CODEX P2). When `toJSON`
  // returns a non-scalar (an object/array that could carry credential keys),
  // redact *that* — the thing actually emitted. When it returns a scalar
  // (Date/URL → ISO string), the original object is left intact, preserving
  // prior behavior and identity.
  if (isRecord(value) && hasToJson(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    try {
      const serialized = value.toJSON();
      if (isRecord(serialized) || Array.isArray(serialized)) {
        return redactValue(serialized, depth + 1, seen);
      }
      // Scalar result (string/number/…): the object serializes safely as-is.
      return value;
    } catch {
      // A throwing toJSON must never let the raw object (whose own keys we
      // skipped) through: fail closed.
      return REDACTED;
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

/**
 * Query-string parameter names that commonly carry credentials in URLs.
 * Matched case-insensitively against the parameter name.
 */
const SENSITIVE_URL_PARAMS = [
  "access_token",
  "accesstoken",
  "refresh_token",
  "api_key",
  "apikey",
  "code",
  "token",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "state",
  "sig",
  "signature",
  "auth",
] as const;

const URL_USERINFO_RE = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/?#@\s]+)@/gi;

/**
 * Strip credentials from URL-shaped strings so they can be safely emitted in
 * free-form text (error messages, stacks, lifted `request_url` fields). Unlike
 * {@link redactSensitive}, which is key-based, this scrubs secrets embedded in
 * the *value* itself:
 *
 * - URL userinfo: `http://user:pass@host` → `http://user:[REDACTED]@host`
 * - sensitive query params: `?access_token=abc` → `?access_token=[REDACTED]`
 *
 * It is intentionally tolerant: it operates on any string (a DSN, a Mongo URI,
 * an axios error message containing a URL) via regex rather than requiring a
 * parseable URL, so malformed or partial URLs in error text are still scrubbed.
 * Non-URL strings pass through unchanged.
 */
export function sanitizeUrlCredentials(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  // 1) userinfo: scheme://user:pass@  → mask the password (and any bare creds).
  let out = input.replace(URL_USERINFO_RE, (_match, scheme: string, userinfo: string) => {
    const colon = userinfo.indexOf(":");
    if (colon === -1) {
      // `scheme://token@host` — the whole userinfo is credential-like.
      return `${scheme}${REDACTED}@`;
    }
    const user = userinfo.slice(0, colon);
    return `${scheme}${user}:${REDACTED}@`;
  });

  // 2) sensitive query/fragment params: `key=value` → `key=[REDACTED]`.
  // Match `?key=`, `&key=`, `;key=` separators and stop at the next delimiter.
  out = out.replace(
    /([?&;])([a-z0-9_.\-]+)=([^&#;\s]*)/gi,
    (match, sep: string, key: string, _val: string) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const sensitive = SENSITIVE_URL_PARAMS.some((p) =>
        normalized === p.replace(/[^a-z0-9]/g, "")
      );
      return sensitive ? `${sep}${key}=${REDACTED}` : match;
    },
  );

  return out;
}

/**
 * Apply {@link sanitizeUrlCredentials} to the `message` and `stack` of a
 * serialized-error-shaped object, returning a new object. Used by the logger's
 * JSON and text paths so errors carrying DSNs, Mongo URIs, or
 * `?access_token=`-bearing URLs do not leak credentials (the serialized error
 * bypasses the key-based redactor). Returns the input unchanged when falsy.
 */
export function sanitizeSerializedError<
  T extends { message?: unknown; stack?: unknown } | undefined,
>(error: T): T {
  if (!error) return error;
  const out: { message?: unknown; stack?: unknown } = { ...error };
  if (typeof out.message === "string") out.message = sanitizeUrlCredentials(out.message);
  if (typeof out.stack === "string") out.stack = sanitizeUrlCredentials(out.stack);
  return out as T;
}
