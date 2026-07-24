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

/** Strip all non-alphanumeric characters and lowercase, used for key normalization. */
function normalizeToAlphanumeric(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
/** Avoid retaining attacker-controlled, oversized property names in the cache. */
const SENSITIVE_KEY_CACHE_MAX_KEY_LENGTH = 128;
const sensitiveKeyCache = new Map<string, boolean>();

/** Stop traversing past this depth to keep the pass cheap and stack-safe. */
const MAX_DEPTH = 16;
/** Bound every individual array/object before allocating a redacted copy. */
const MAX_CONTAINER_ENTRIES = 1_024;
/** Bound aggregate work across an entire redaction call, not per branch. */
const MAX_TRAVERSAL_NODES = 4_096;

/**
 * Whether a context key names a credential and should have its value masked.
 *
 * Uses substring matching on a normalized key, so `clientSecret`,
 * `x-api-key`, and `refresh_token` all match while benign words that merely
 * *contain* a pattern as a separate token (e.g. `author`) do not — `author`
 * normalizes to `author`, which contains none of the patterns.
 */
export function isSensitiveKey(key: string): boolean {
  const cacheable = key.length <= SENSITIVE_KEY_CACHE_MAX_KEY_LENGTH;
  if (cacheable) {
    const cached = sensitiveKeyCache.get(key);
    if (cached !== undefined) return cached;
  }

  const normalized = normalizeToAlphanumeric(key);
  const sensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));

  if (cacheable) {
    if (sensitiveKeyCache.size >= SENSITIVE_KEY_CACHE_MAX_SIZE) {
      const oldestKey = sensitiveKeyCache.keys().next().value as string | undefined;
      if (oldestKey !== undefined) sensitiveKeyCache.delete(oldestKey);
    }
    sensitiveKeyCache.set(key, sensitive);
  }

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

interface RedactionBudget {
  remainingNodes: number;
  exhausted: boolean;
}

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
  budget: RedactionBudget,
): unknown {
  if (budget.remainingNodes <= 0) {
    budget.exhausted = true;
    return REDACTED;
  }
  budget.remainingNodes--;

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
      if (!Number.isInteger(length) || length < 0 || length > MAX_CONTAINER_ENTRIES) {
        return REDACTED;
      }
      const redacted: unknown[] = mode === "compatible" ? new Array(length) : [];
      for (let index = 0; index < length; index++) {
        if (mode === "compatible" && !(index in arrayValue)) continue;
        const item = redactValue(arrayValue[index], depth + 1, seen, mode, budget);
        if (budget.exhausted) return REDACTED;
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
        return redactValue(serialized, depth + 1, seen, mode, budget);
      }

      if (serialized !== null && typeof serialized === "object") {
        if (classifyArray(serialized) === null) return REDACTED;
        return redactValue(serialized, depth + 1, seen, mode, budget);
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
    const record = value as Record<string, unknown>;
    let propertyCount = 0;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      propertyCount++;
      if (propertyCount > MAX_CONTAINER_ENTRIES) return REDACTED;

      if (isSensitiveKey(key)) {
        Object.defineProperty(out, key, {
          configurable: true,
          enumerable: true,
          value: REDACTED,
          writable: true,
        });
        continue;
      }

      const child = record[key];
      // Match JSON object semantics only for the explicit serialization API.
      // The generic compatibility API retains undefined own properties.
      if (mode === "serialization" && child === undefined) continue;
      const redactedChild = redactValue(child, depth + 1, seen, mode, budget);
      if (budget.exhausted) return REDACTED;
      Object.defineProperty(out, key, {
        configurable: true,
        enumerable: true,
        value: redactedChild,
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
  return redactValue(context, 0, new Set<object>(), "compatible", {
    remainingNodes: MAX_TRAVERSAL_NODES,
    exhausted: false,
  }) as T;
}

/**
 * Returns a JSON-safe redacted snapshot of `context`. Sensitive keys are
 * masked, nested values are traversed, BigInts become decimal strings,
 * non-finite numbers become `null`, and unsupported or unreadable values fail
 * closed. Objects with `toJSON` are snapshotted exactly once before redaction.
 */
export function redactForSerialization(context: unknown): RedactedValue {
  return redactValue(context, 0, new Set<object>(), "serialization", {
    remainingNodes: MAX_TRAVERSAL_NODES,
    exhausted: false,
  }) as RedactedValue;
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
  "x-amz-credential",
  "x-amz-signature",
  "x-amz-security-token",
  "x-goog-credential",
  "x-goog-signature",
] as const;

const NORMALIZED_SENSITIVE_URL_PARAMS = new Set(SENSITIVE_URL_PARAMS.map(normalizeToAlphanumeric));

const URL_USERINFO_RE = /(\b[a-z][a-z0-9+.-]*:\/\/|\/\/)([^/?#\s]+)@/gi;
const HORIZONTAL_WHITESPACE_URL_USERINFO_RE =
  /(\b[a-z][a-z0-9+.-]*:\/\/|\/\/)([a-z0-9._~!$&'()*+,;=%-]+):([^/?#@\r\n \t]+[ \t][^/?#@\r\n]*)@/gi;

interface RedactedAssignmentValue {
  end: number;
  replacement: string;
}

function isHorizontalAssignmentBoundary(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "," ||
    character === ";" ||
    character === "&" ||
    character === "?" ||
    character === "#"
  );
}

function isAsciiLetter(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAssignmentKeyStartCharacter(character: string | undefined): boolean {
  return isAsciiLetter(character) || character === "_" || character === "$";
}

function isAssignmentKeyCharacter(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (
    isAssignmentKeyStartCharacter(character) ||
    (code >= 48 && code <= 57) ||
    character === "." ||
    character === "-"
  );
}

/**
 * Check for a syntactically recognizable next `key=value` / `"key": value`
 * field without allocating substrings. Assignment values may themselves
 * contain whitespace and punctuation, so only a complete next-field prefix is
 * trusted as a boundary.
 */
function assignmentStartsAt(input: string, start: number): boolean {
  let index = start;
  const keyQuote = input[index] === `"` || input[index] === "'" ? input[index++] : "";
  if (!isAssignmentKeyStartCharacter(input[index])) return false;

  index++;
  while (isAssignmentKeyCharacter(input[index])) index++;
  if (keyQuote) {
    if (input[index] !== keyQuote) return false;
    index++;
  }
  while (input[index] === " " || input[index] === "\t") index++;
  return input[index] === ":" || input[index] === "=";
}

function isAssignmentBoundaryCharacter(character: string): boolean {
  return (
    character === "\r" ||
    character === "\n" ||
    character === "}" ||
    character === "]" ||
    isHorizontalAssignmentBoundary(character)
  );
}

function skipAssignmentBoundaryCharacters(input: string, start: number): number {
  let index = start;
  while (
    index < input.length &&
    isAssignmentBoundaryCharacter(input[index]!)
  ) {
    index++;
  }
  return index;
}

function assignmentValueEndsAt(input: string, start: number): boolean {
  const boundaryEnd = skipAssignmentBoundaryCharacters(input, start);
  return boundaryEnd >= input.length || assignmentStartsAt(input, boundaryEnd);
}

function redactAssignmentValue(input: string, start: number): RedactedAssignmentValue {
  let scanStart = start;
  let preserveValueQuote = true;
  if (input.startsWith(REDACTED, start)) {
    const markerEnd = start + REDACTED.length;
    if (assignmentValueEndsAt(input, markerEnd)) {
      return {
        end: markerEnd,
        replacement: REDACTED,
      };
    }
    scanStart = markerEnd;
    preserveValueQuote = false;
  }

  const wrapperQuote = preserveValueQuote &&
      (input[scanStart] === `"` || input[scanStart] === "'" || input[scanStart] === "`")
    ? input[scanStart]
    : "";
  let wrapperQuoteClosed = false;
  const replacement = (): string =>
    wrapperQuote ? `${wrapperQuote}${REDACTED}${wrapperQuoteClosed ? wrapperQuote : ""}` : REDACTED;

  const expectedClosings: string[] = [];
  let quote = "";
  let quoteStart = -1;
  for (let index = scanStart; index < input.length;) {
    const character = input[index]!;
    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) {
        if (quoteStart === scanStart && expectedClosings.length === 0) {
          wrapperQuoteClosed = true;
        }
        quote = "";
        quoteStart = -1;
      }
      index++;
      continue;
    }

    if (character === `"` || character === "'" || character === "`") {
      quote = character;
      quoteStart = index;
      index++;
      continue;
    }
    if (character === "{" || character === "[") {
      expectedClosings.push(character === "{" ? "}" : "]");
      index++;
      continue;
    }
    if (
      expectedClosings.length > 0 &&
      (character === "}" || character === "]")
    ) {
      if (expectedClosings.at(-1) !== character) {
        return { end: input.length, replacement: replacement() };
      }
      expectedClosings.pop();
      index++;
      if (
        expectedClosings.length === 0 &&
        assignmentValueEndsAt(input, index)
      ) {
        return { end: index, replacement: replacement() };
      }
      continue;
    }

    if (
      expectedClosings.length > 0 ||
      !isAssignmentBoundaryCharacter(character)
    ) {
      index++;
      continue;
    }

    const boundaryStart = index;
    index = skipAssignmentBoundaryCharacters(input, index);
    if (index >= input.length || assignmentStartsAt(input, index)) {
      return { end: boundaryStart, replacement: replacement() };
    }
  }

  return { end: input.length, replacement: replacement() };
}

function redactCredentialAssignments(
  input: string,
  prefixPattern: RegExp,
  keyGroup: number,
): string {
  let cursor = 0;
  let result = "";

  for (let match = prefixPattern.exec(input); match; match = prefixPattern.exec(input)) {
    const key = match[keyGroup]!;
    if (!isSensitiveKey(key)) continue;

    const valueStart = prefixPattern.lastIndex;
    const redactedValue = redactAssignmentValue(input, valueStart);
    result += input.slice(cursor, match.index);
    result += match[0];
    result += redactedValue.replacement;
    cursor = redactedValue.end;
    prefixPattern.lastIndex = redactedValue.end;
  }

  return cursor === 0 ? input : result + input.slice(cursor);
}

function isStandaloneUrlAuthorityBeforeWhitespace(
  scheme: string,
  user: string,
  password: string,
): boolean {
  const whitespaceIndex = password.search(/[ \t]/);
  if (whitespaceIndex < 0) return false;

  const authority = `${user}:${password.slice(0, whitespaceIndex)}`;
  const candidate = scheme === "//" ? `https://${authority}` : `${scheme}${authority}`;
  try {
    const url = new URL(candidate);
    return url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}

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
 * Strings without credential-shaped content pass through unchanged.
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
  out = out.replace(
    HORIZONTAL_WHITESPACE_URL_USERINFO_RE,
    (
      match: string,
      scheme: string,
      user: string,
      password: string,
    ) => {
      // Do not reinterpret a complete URL followed later by an email address
      // on the same line as malformed userinfo. Raw-horizontal-whitespace
      // recovery is limited to explicit `user:password` shapes whose prefix
      // cannot already be parsed as a standalone authority.
      if (isStandaloneUrlAuthorityBeforeWhitespace(scheme, user, password)) {
        return match;
      }
      return `${scheme}${user}:${REDACTED}@`;
    },
  );

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
      const sensitive = NORMALIZED_SENSITIVE_URL_PARAMS.has(
        normalizeToAlphanumeric(decodedKey),
      );
      return sensitive ? `${sep}${key}=${REDACTED}` : match;
    },
  );

  // 3) Cookie header values.
  // Cookie headers can carry multiple independent credentials separated by
  // semicolons (and Set-Cookie attributes can contain commas). Mask the entire
  // header line before the generic assignment scanner can stop at the first
  // delimiter and expose later values.
  out = out.replace(
    /(^|[^a-z0-9_-])((?:set-cookie|cookie)\s*:\s*)[^\r\n]*/gi,
    (_match, boundary: string, prefix: string) => `${boundary}${prefix}${REDACTED}`,
  );

  // 4) Header-shaped authorization values and standalone auth schemes.
  // Authorization schemes are extensible (AWS SigV4, Digest, custom proxy
  // schemes, and others), so mask the complete line instead of trying to
  // enumerate schemes or parse their credential-bearing parameters.
  out = out.replace(
    /\b(authorization\s*[:=]\s*)[^\r\n]*/gi,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );
  out = out.replace(
    /\b(bearer|basic)(\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[a-z0-9._~+/=-]+)/gi,
    (_match, scheme: string, whitespace: string) => `${scheme}${whitespace}${REDACTED}`,
  );

  // 5) Credential assignments embedded in free-form messages/errors. Match
  // generic identifier-shaped keys and delegate classification to the same
  // deny-list used for structured context. This keeps JSON snippets, header
  // dumps, and ordinary `key=value` text from drifting to a weaker policy.
  // Handle quoted JSON/object keys first and preserve their quoting so the
  // sanitized text remains intelligible and structurally valid.
  out = redactCredentialAssignments(
    out,
    /(["'])([_$a-z][a-z0-9_.$-]*)\1(\s*[:=]\s*)/gi,
    2,
  );
  out = redactCredentialAssignments(
    out,
    /(^|[^a-z0-9_.$-])([_$a-z][a-z0-9_.$-]*)(\s*[:=]\s*)/gi,
    2,
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
    if (url.protocol === "blob:") {
      try {
        const embeddedUrl = new URL(url.pathname);
        return embeddedUrl.origin === "null" ? "blob:" : `blob:${embeddedUrl.origin}`;
      } catch (_) {
        return "blob:";
      }
    }
    if (url.origin !== "null") return `${url.origin}${url.pathname}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return url.protocol;
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
 * Apply {@link sanitizeUrlCredentials} to the `name`, `message`, and `stack` of a
 * serialized-error-shaped object, returning a new object. Used by the logger's
 * JSON and text paths so errors carrying DSNs, Mongo URIs, or
 * `?access_token=`-bearing URLs do not leak credentials (the serialized error
 * bypasses the key-based redactor). Returns the input unchanged when falsy.
 */
export function sanitizeSerializedError<
  T extends { name?: unknown; message?: unknown; stack?: unknown } | undefined,
>(error: T): T {
  if (!error) return error;
  const out: { name?: unknown; message?: unknown; stack?: unknown } = { ...error };
  if (typeof out.name === "string") out.name = sanitizeUrlCredentials(out.name);
  if (typeof out.message === "string") out.message = sanitizeUrlCredentials(out.message);
  if (typeof out.stack === "string") out.stack = sanitizeUrlCredentials(out.stack);
  return out as T;
}
