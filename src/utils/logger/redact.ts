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
 * Sensitive keys are masked and every string value is scrubbed for credentials
 * embedded in URL userinfo, query parameters, or fragment parameters. The
 * deny-list errs toward over-redaction — masking a benign `tokenCount` is
 * acceptable; leaking a real token is not. The traversal fails *closed*: on a
 * cycle, depth overflow, or a throwing getter it returns {@link REDACTED}
 * rather than risk emitting an unredacted object.
 */

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

const SENSITIVE_KEY_CACHE_MAX_SIZE = 512;
const sensitiveKeyCache = new Map<string, boolean>();

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
  const cached = sensitiveKeyCache.get(key);
  if (cached !== undefined) return cached;

  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));

  if (sensitiveKeyCache.size >= SENSITIVE_KEY_CACHE_MAX_SIZE) {
    const oldestKey = sensitiveKeyCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) sensitiveKeyCache.delete(oldestKey);
  }
  sensitiveKeyCache.set(key, sensitive);

  return sensitive;
}

export type RedactedValue =
  | string
  | number
  | boolean
  | null
  | RedactedValue[]
  | { [key: string]: RedactedValue };

type RedactionMode = "compatible" | "serialization";

/**
 * `Array.isArray` normally looks like a harmless classifier, but it throws for
 * revoked proxies. Returning `null` lets every public redaction entry point
 * fail closed without touching the unreadable value again.
 */
function classifyArray(value: object): boolean | null {
  try {
    return Array.isArray(value);
  } catch {
    return null;
  }
}

function redactValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  mode: RedactionMode,
): unknown {
  if (typeof value === "string") return sanitizeUrlCredentials(value);
  if (typeof value === "bigint") return mode === "serialization" ? value.toString() : value;
  if (typeof value === "number") {
    return mode === "serialization" && !Number.isFinite(value) ? null : value;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return mode === "serialization" ? REDACTED : value;
  }

  const arrayClassification = classifyArray(value);
  if (arrayClassification === null) return REDACTED;

  if (arrayClassification) {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    try {
      const arrayValue = value as unknown[];
      const length = arrayValue.length;
      const redacted: unknown[] = mode === "compatible" ? new Array(length) : [];
      for (let index = 0; index < length; index++) {
        if (mode === "compatible" && !(index in arrayValue)) continue;
        const item = redactValue(arrayValue[index], depth + 1, seen, mode);
        if (mode === "compatible") {
          redacted[index] = item;
        } else {
          redacted.push(item);
        }
      }
      return redacted;
    } catch {
      // Array indices can be accessors or proxy traps. A failed read makes the
      // serialized contents unknowable, so the complete array fails closed.
      return REDACTED;
    } finally {
      seen.delete(value);
    }
  }

  // Objects defining `toJSON` (Date, URL, custom serializers) are serialized
  // by `JSON.stringify` via the *return value* of `toJSON`, not their own
  // enumerable keys. A key-based pass over the object's own properties would
  // therefore miss credentials smuggled through `toJSON`, e.g.
  // `{ toJSON: () => ({ apiKey: "sk-..." }) }` (CODEX P2). When `toJSON`
  // returns an object, array, or scalar, the serialization API redacts *that*
  // snapshot. The compatibility API keeps scalar serializers such as Date and
  // URL intact, preserving the established generic return contract.
  if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
  let toJSON: unknown;
  try {
    toJSON = (value as Record<string, unknown>).toJSON;
  } catch {
    // Accessors can throw before a serializer is callable. Never inspect the
    // raw object after that because its eventual serialization is unknown.
    return REDACTED;
  }

  if (typeof toJSON === "function") {
    seen.add(value);
    try {
      const serialized = Reflect.apply(toJSON, value, []);
      if (mode === "serialization") {
        return redactValue(serialized, depth + 1, seen, mode);
      }

      if (serialized !== null && typeof serialized === "object") {
        if (classifyArray(serialized) === null) return REDACTED;
        return redactValue(serialized, depth + 1, seen, mode);
      }

      return value;
    } catch {
      // A throwing toJSON must never let the raw object (whose own keys we
      // skipped) through: fail closed.
      return REDACTED;
    } finally {
      seen.delete(value);
    }
  }

  seen.add(value);
  try {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      // Match JSON object semantics only for the explicit serialization API.
      // The generic compatibility API retains undefined own properties.
      if (mode === "serialization" && child === undefined) continue;
      Object.defineProperty(out, key, {
        configurable: true,
        enumerable: true,
        value: isSensitiveKey(key) ? REDACTED : redactValue(child, depth + 1, seen, mode),
        writable: true,
      });
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

/**
 * Returns a redacted copy of `context` while preserving the established source
 * and runtime value shapes. Any property whose key is {@link isSensitiveKey}
 * is replaced with {@link REDACTED}; nested records and arrays are traversed,
 * while primitives and scalar-serializing objects retain their original types.
 * The input is never mutated.
 *
 * Use {@link redactForSerialization} at JSON/logging boundaries where BigInt,
 * functions, symbols, and custom `toJSON` implementations must be normalized.
 */
export function redactSensitive<T>(context: T): T {
  return redactValue(context, 0, new Set<object>(), "compatible") as T;
}

/**
 * Returns a JSON-safe redacted snapshot of `context`. Sensitive keys are
 * masked, nested values are traversed, BigInts become decimal strings,
 * non-finite numbers become `null`, and unsupported or unreadable values fail
 * closed. Objects with `toJSON` are snapshotted exactly once before redaction.
 */
export function redactForSerialization(context: unknown): RedactedValue {
  return redactValue(context, 0, new Set<object>(), "serialization") as RedactedValue;
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
  // Match `?key=`, `#key=`, `&key=`, and `;key=` separators and stop at the
  // next delimiter. OAuth implicit-flow tokens commonly appear after `#`.
  out = out.replace(
    /([?#&;])([a-z0-9_.%\-]+)=([^&#;\s]*)/gi,
    (match, sep: string, key: string, _val: string) => {
      let decodedKey = key;
      try {
        decodedKey = decodeURIComponent(key);
      } catch {
        // A malformed encoded key cannot be normalized more precisely.
      }
      const normalized = decodedKey.toLowerCase().replace(/[^a-z0-9]/g, "");
      const sensitive = SENSITIVE_URL_PARAMS.some((p) =>
        normalized === p.replace(/[^a-z0-9]/g, "")
      );
      return sensitive ? `${sep}${key}=${REDACTED}` : match;
    },
  );

  return out;
}

function firstUrlDelimiterIndex(input: string): number {
  const queryIndex = input.indexOf("?");
  const hashIndex = input.indexOf("#");
  if (queryIndex === -1) return hashIndex;
  if (hashIndex === -1) return queryIndex;
  return Math.min(queryIndex, hashIndex);
}

function sanitizeProtocolRelativeUrlForSpan(input: string): string | null {
  if (!input.startsWith("//")) return null;

  try {
    const url = new URL(`https:${input}`);
    return `//${url.host}${url.pathname}`;
  } catch (_) {
    return null;
  }
}

/**
 * Return the URL form safe to attach to observability span attributes.
 *
 * Span attributes bypass the logger's structured redaction pass, so `http.url`
 * must not include query strings, fragments, or URL userinfo. This intentionally
 * strips every query parameter instead of selectively redacting credential-like
 * names because cache keys and callback state can be sensitive even when the
 * parameter name is not obviously a credential.
 */
export function sanitizeUrlForSpan(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  try {
    const url = new URL(input);
    if (url.origin !== "null") return `${url.origin}${url.pathname}`;
  } catch (_) {
    // Relative or malformed URL-shaped strings are handled by the fallback.
  }

  const delimiterIndex = firstUrlDelimiterIndex(input);
  const withoutQueryOrFragment = delimiterIndex === -1 ? input : input.slice(0, delimiterIndex);
  const protocolRelativeUrl = sanitizeProtocolRelativeUrlForSpan(withoutQueryOrFragment);
  if (protocolRelativeUrl) return protocolRelativeUrl;

  return sanitizeUrlCredentials(withoutQueryOrFragment);
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
