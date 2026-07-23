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
 * The traversal combines key-based masking with conservative scrubbing of
 * credential-shaped URLs, bearer tokens, and assignments in string values.
 * The deny-list errs toward over-redaction: masking a benign `tokenCount` is
 * acceptable; leaking a real token is not. The traversal fails *closed*: on a
 * cycle, depth overflow, or a throwing getter it returns {@link REDACTED}
 * rather than risk emitting an unredacted object.
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

const SENSITIVE_KEY_CACHE_MAX_SIZE = 512;
const sensitiveKeyCache = new Map<string, boolean>();

/** Stop traversing past this depth to keep the pass cheap and stack-safe. */
const MAX_DEPTH = 16;
const MAX_COLLECTION_ITEMS = 100;
const MAX_REDACTION_NODES = 2_048;
const MAX_STRING_LENGTH = 16_384;

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

/**
 * A non-null, non-array object. {@link isRecord} covers class instances too,
 * whose enumerable fields `JSON.stringify` *would* serialize, so we must
 * traverse them to catch secrets.
 */
function isTraversableRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

const TO_JSON_ACCESS_FAILED = Symbol("to-json-access-failed");

function getToJson(
  value: object,
): ((this: object) => unknown) | null | typeof TO_JSON_ACCESS_FAILED {
  try {
    const candidate = Reflect.get(value, "toJSON") as unknown;
    return typeof candidate === "function" ? candidate as (this: object) => unknown : null;
  } catch {
    return TO_JSON_ACCESS_FAILED;
  }
}

function redactValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  budget: { remaining: number },
): unknown {
  if (budget.remaining-- <= 0) return REDACTED;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    const sanitized = sanitizeUrlCredentials(value);
    return sanitized.length > MAX_STRING_LENGTH
      ? `${sanitized.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`
      : sanitized;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    try {
      const output = value.slice(0, MAX_COLLECTION_ITEMS).map((item) =>
        redactValue(item, depth + 1, seen, budget)
      );
      if (value.length > MAX_COLLECTION_ITEMS) output.push(REDACTED);
      return output;
    } catch {
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
  // returns a value, redact a snapshot of that value. This both covers objects
  // and prevents JSON.stringify from invoking a mutable scalar serializer a
  // second time after the redaction pass.
  if (isRecord(value)) {
    const toJSON = getToJson(value);
    if (toJSON === TO_JSON_ACCESS_FAILED) return REDACTED;
    if (toJSON) {
      if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
      seen.add(value);
      try {
        const serialized = toJSON.call(value);
        if (isRecord(serialized) || Array.isArray(serialized)) {
          return redactValue(serialized, depth + 1, seen, budget);
        }
        return redactValue(serialized, depth + 1, seen, budget);
      } catch {
        // A throwing toJSON must never let the raw object (whose own keys we
        // skipped) through: fail closed.
        return REDACTED;
      } finally {
        seen.delete(value);
      }
    }
  }

  if (isTraversableRecord(value)) {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    try {
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (count++ >= MAX_COLLECTION_ITEMS) {
          out.__truncated__ = REDACTED;
          break;
        }
        const child = value[key];
        Object.defineProperty(out, key, {
          configurable: true,
          enumerable: true,
          value: isSensitiveKey(key) ? REDACTED : redactValue(child, depth + 1, seen, budget),
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

  // Remaining primitives are safe to return unchanged.
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
  return redactValue(context, 0, new Set<object>(), { remaining: MAX_REDACTION_NODES }) as T;
}

/**
 * Query-string parameter names that commonly carry credentials in URLs.
 * Matched case-insensitively against the parameter name.
 */
const SENSITIVE_URL_PARAMS = [
  "access_token",
  "accesstoken",
  "refresh_token",
  "id_token",
  "session_id",
  "jwt",
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

const NORMALIZED_SENSITIVE_URL_PARAMS = new Set(
  SENSITIVE_URL_PARAMS.map((parameter) => parameter.replace(/[^a-z0-9]/g, "")),
);

const EMBEDDED_URL_USERINFO_RE =
  /((?:\b(?:https?|ftp|ws|wss):[\\/]*|\b[a-z][a-z0-9+.-]*:[\\/]{2,}|[\\/]{2}))([^/\\?#\s]+)@/gi;
const WHOLE_URL_USERINFO_RE =
  /((?:\b(?:https?|ftp|ws|wss):[\t\r\n\f]*[\\/]*|\b[a-z][a-z0-9+.-]*:[\t\r\n\f]*[\\/]{2,}|[\\/]{2}))([^/\\?#]*)@/i;
const AMBIGUOUS_BARE_USERINFO_PUNCTUATION = /[,;()[\]{}]/;

// Header values can appear in log messages and error stacks without being
// represented as structured `headers` objects. Keep these expressions line
// bounded so a header on one stack/message line cannot consume useful text on
// subsequent lines. The negated character classes are linear-time scans and
// avoid backtracking over attacker-controlled credential values.
const AUTHORIZATION_HEADER_RE = /\b((?:proxy-)?authorization)([ \t]*[:=][ \t]*)([^\r\n]*)/gi;
const COOKIE_HEADER_RE = /\b(set-cookie|cookie)([ \t]*[:=][ \t]*)([^\r\n]*)/gi;
const AUTH_SCHEME_RE = /^([!#$%&'*+.^_`|~0-9a-z-]+)[ \t]+/i;
const SINGLE_TOKEN_AUTH_SCHEMES = new Set(["basic", "bearer", "dpop", "negotiate", "ntlm"]);
const AUTH_TOKEN_DELIMITER_RE = /[ \t,;]/;
const MAX_URL_PARAMETER_NAME_LENGTH = 256;
const MAX_URL_PARAMETER_NAME_DECODE_ROUNDS = 8;

function normalizeUrlParameterNames(encodedName: string): readonly string[] | null {
  if (encodedName.length === 0 || encodedName.length > MAX_URL_PARAMETER_NAME_LENGTH) return null;

  let decoded = encodedName;
  for (let round = 0; round < MAX_URL_PARAMETER_NAME_DECODE_ROUNDS; round++) {
    let next: string;
    try {
      // URLSearchParams decodes percent escapes and treats `+` as a space. Apply
      // those semantics on every layer so nested spellings cannot bypass
      // credential-name detection. The caller preserves the original spelling.
      next = decodeURIComponent(decoded.replace(/\+/g, " "));
    } catch {
      return null;
    }
    if (next === decoded) {
      const normalized = decoded.normalize("NFKC").toLowerCase();
      const compact = normalized.replace(/[^a-z0-9]/g, "");
      const bracketStart = normalized.indexOf("[");
      const bracketComponents = Array.from(
        normalized.matchAll(/\[([^\]]*)\]/g),
        (match) => (match[1] ?? "").replace(/[^a-z0-9]/g, ""),
      ).filter(Boolean);
      const base = bracketStart === -1
        ? ""
        : normalized.slice(0, bracketStart).replace(/[^a-z0-9]/g, "");
      return [compact, base, ...bracketComponents].filter(Boolean);
    }
    decoded = next;
  }

  // Names that do not stabilize inside the explicit work budget fail closed.
  return null;
}

function redactUrlUserinfo(
  _match: string,
  prefix: string,
  userinfo: string,
): string {
  const colon = userinfo.indexOf(":");
  if (colon === -1) return `${prefix}${REDACTED}@`;
  return `${prefix}${userinfo.slice(0, colon)}:${REDACTED}@`;
}

function redactEmbeddedUrlUserinfo(
  match: string,
  prefix: string,
  userinfo: string,
): string {
  if (
    !userinfo.includes(":") && AMBIGUOUS_BARE_USERINFO_PUNCTUATION.test(userinfo)
  ) return match;
  return redactUrlUserinfo(match, prefix, userinfo);
}

function sanitizeWholeUrlUserinfo(input: string): string {
  const leadingWhitespace = input.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = input.match(/\s*$/)?.[0] ?? "";
  const start = leadingWhitespace.length;
  const end = input.length - trailingWhitespace.length;
  if (start >= end) return input;
  const candidate = input.slice(start, end);

  let parsed: URL | null = null;
  try {
    parsed = new URL(candidate);
  } catch {
    if (/^[\\/]{2}/.test(candidate)) {
      try {
        parsed = new URL(candidate, "https://veryfront.invalid");
      } catch {
        return input;
      }
    }
  }
  if (!parsed) return input;
  if (!parsed.username && !parsed.password) return input;

  const match = WHOLE_URL_USERINFO_RE.exec(candidate);
  if (!match || match.index !== 0) return input;

  const sanitized = candidate.replace(WHOLE_URL_USERINFO_RE, redactUrlUserinfo);
  return `${leadingWhitespace}${sanitized}${trailingWhitespace}`;
}

function redactAuthorizationHeader(
  _match: string,
  header: string,
  separator: string,
  value: string,
): string {
  const trimmedValue = value.trimStart();
  const schemeMatch = AUTH_SCHEME_RE.exec(trimmedValue);
  if (!schemeMatch) return `${header}${separator}${REDACTED}`;

  const scheme = schemeMatch[1];
  if (!scheme) return `${header}${separator}${REDACTED}`;
  if (!SINGLE_TOKEN_AUTH_SCHEMES.has(scheme.toLowerCase())) {
    // Digest, Signature, OAuth 1.0, AWS4-HMAC-SHA256, and unknown schemes may
    // carry multiple comma- or whitespace-delimited credential fields. Mask
    // the full remainder instead of guessing which field is safe.
    return `${header}${separator}${scheme} ${REDACTED}`;
  }

  const credentialAndTail = trimmedValue.slice(schemeMatch[0].length);
  const credentialEnd = credentialAndTail.search(AUTH_TOKEN_DELIMITER_RE);
  const tail = credentialEnd === -1 ? "" : credentialAndTail.slice(credentialEnd);
  return `${header}${separator}${scheme} ${REDACTED}${tail}`;
}

function redactCookieHeader(
  _match: string,
  header: string,
  separator: string,
): string {
  return `${header}${separator}${REDACTED}`;
}

/**
 * Strip credentials from URL-shaped strings so they can be safely emitted in
 * free-form text (error messages, stacks, lifted `request_url` fields). Unlike
 * {@link redactSensitive}, which is key-based, this scrubs secrets embedded in
 * the *value* itself:
 *
 * - URL userinfo: `http://user:pass@host` → `http://user:[REDACTED]@host`
 * - sensitive query params: `?access_token=abc` → `?access_token=[REDACTED]`
 * - authentication headers: `Authorization: Basic abc` →
 *   `Authorization: Basic [REDACTED]`
 * - cookie headers: `Cookie: session=abc` → `Cookie: [REDACTED]`
 *
 * It is intentionally tolerant: it operates on any string (a DSN, a Mongo URI,
 * an axios error message containing a URL) via regex rather than requiring a
 * parseable URL, so malformed or partial URLs in error text are still scrubbed.
 * Non-URL strings pass through unchanged.
 */
export function sanitizeUrlCredentials(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  // 1) userinfo: scheme://user:pass@  → mask the password (and any bare creds).
  let out = sanitizeWholeUrlUserinfo(input);
  out = out.replace(EMBEDDED_URL_USERINFO_RE, redactEmbeddedUrlUserinfo);

  // 2) sensitive query/fragment params: `key=value` → `key=[REDACTED]`.
  // Match query and fragment parameter separators and stop at the next delimiter.
  out = out.replace(
    /([?&#;])([^=?&#;]+)=([^&#;\s]*)/gi,
    (match, sep: string, key: string, _val: string) => {
      const normalizedNames = normalizeUrlParameterNames(key);
      const sensitive = normalizedNames === null ||
        normalizedNames.some((name) => NORMALIZED_SENSITIVE_URL_PARAMS.has(name));
      return sensitive ? `${sep}${key}=${REDACTED}` : match;
    },
  );

  // 3) Free-form HTTP credential headers. Preserve an authentication scheme
  // when one is present, but replace the entire credential payload. Digest
  // credentials and cookie values may contain spaces, quotes, commas, and
  // semicolons, so masking only the next token would still leak fields.
  out = out.replace(AUTHORIZATION_HEADER_RE, redactAuthorizationHeader);
  out = out.replace(COOKIE_HEADER_RE, redactCookieHeader);

  out = out.replace(/\b(Bearer)(\s+)([^\s,;]+)/gi, `$1$2${REDACTED}`);
  out = out.replace(
    /\b(password|passwd|pwd|secret|client_secret|access_token|refresh_token|id_token|session_id|jwt|api_key|apikey|token)(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
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
