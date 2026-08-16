import type { DataResponseMetadata, ResponseCookie } from "./schemas/data.schema.ts";
import { HTTP_TOKEN_PATTERN } from "#veryfront/utils/cors-policy-limits.ts";

const MAX_RESPONSE_HEADER_COUNT = 64;
const MAX_RESPONSE_HEADER_NAME_LENGTH = 256;
const MAX_RESPONSE_HEADER_VALUE_LENGTH = 8_192;
const MAX_RESPONSE_COOKIE_COUNT = 64;
const MAX_RESPONSE_COOKIE_VALUE_LENGTH = 4_096;
const MAX_SERIALIZED_RESPONSE_COOKIE_LENGTH = 8_192;

const objectEntries = Object.entries;
const objectKeys = Object.keys;
const getPrototypeOf = Object.getPrototypeOf;
const numberIsSafeInteger = Number.isSafeInteger;
const encodeCookieValue = encodeURIComponent;
const regexpTest = RegExp.prototype.test;
const reflectApply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
const attachedResponseMetadata = new WeakMap<object, DataResponseMetadata>();

const FRAMEWORK_OWNED_RESPONSE_HEADERS = new Set([
  "accept-ch",
  "cache-control",
  "connection",
  "content-encoding",
  "content-length",
  "content-range",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-type",
  "critical-ch",
  "date",
  "etag",
  "expires",
  "keep-alive",
  "location",
  "permissions-policy",
  "pragma",
  "proxy-authenticate",
  "proxy-authorization",
  "referrer-policy",
  "reporting-endpoints",
  "server",
  "server-timing",
  "set-cookie",
  "strict-transport-security",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "vary",
  "x-content-type-options",
  "x-dns-prefetch-control",
  "x-frame-options",
  "x-powered-by",
  "x-xss-protection",
]);

const RESPONSE_COOKIE_KEYS = new Set([
  "name",
  "value",
  "domain",
  "path",
  "expires",
  "maxAge",
  "httpOnly",
  "secure",
  "sameSite",
]);
function matches(pattern: RegExp, value: string): boolean {
  return reflectApply(regexpTest, pattern, [value]) as boolean;
}

function isValidResponseHeaderValue(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = reflectApply(stringCharCodeAt, value, [index]) as number;
    if (code > 0xff || code === 0x7f || (code < 0x20 && code !== 0x09)) return false;
  }
  return true;
}

function isValidCookieAttribute(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = reflectApply(stringCharCodeAt, value, [index]) as number;
    if (code > 0xff || code < 0x20 || code === 0x3b || code === 0x7f) return false;
  }
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidMetadata(hookName: "getServerData" | "getStaticData", detail: string): never {
  throw new TypeError(`${hookName} ${detail}`);
}

function isFrameworkOwnedHeader(name: string): boolean {
  return FRAMEWORK_OWNED_RESPONSE_HEADERS.has(name) ||
    name.startsWith("access-control-") ||
    name.startsWith("cross-origin-") ||
    name.startsWith("x-veryfront-");
}

function normalizeHeaders(
  value: unknown,
  hookName: "getServerData" | "getStaticData",
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    return invalidMetadata(hookName, "response headers must be a string record");
  }

  const entries = objectEntries(value);
  if (entries.length > MAX_RESPONSE_HEADER_COUNT) {
    return invalidMetadata(
      hookName,
      `cannot return more than ${MAX_RESPONSE_HEADER_COUNT} response headers`,
    );
  }

  const normalizedEntries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (
      rawName.length === 0 || rawName.length > MAX_RESPONSE_HEADER_NAME_LENGTH ||
      !matches(HTTP_TOKEN_PATTERN, rawName)
    ) {
      return invalidMetadata(hookName, `returned invalid response header name "${rawName}"`);
    }
    if (isFrameworkOwnedHeader(name)) {
      return invalidMetadata(
        hookName,
        `cannot set framework-owned response header "${name}"`,
      );
    }
    if (seen.has(name)) {
      return invalidMetadata(hookName, `returned duplicate response header "${name}"`);
    }
    if (
      typeof rawValue !== "string" || rawValue.length > MAX_RESPONSE_HEADER_VALUE_LENGTH ||
      !isValidResponseHeaderValue(rawValue)
    ) {
      return invalidMetadata(hookName, `returned invalid value for response header "${name}"`);
    }
    seen.add(name);
    normalizedEntries.push([name, rawValue]);
  }

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

function normalizeCookie(
  value: unknown,
  hookName: "getServerData" | "getStaticData",
): ResponseCookie {
  if (!isPlainRecord(value)) {
    return invalidMetadata(hookName, "response cookies must be plain objects");
  }
  for (const key of objectKeys(value)) {
    if (!RESPONSE_COOKIE_KEYS.has(key)) {
      return invalidMetadata(hookName, `returned unknown response cookie field "${key}"`);
    }
  }

  const name = value.name;
  const cookieValue = value.value;
  if (
    typeof name !== "string" || name.length === 0 ||
    name.length > MAX_RESPONSE_HEADER_NAME_LENGTH || !matches(HTTP_TOKEN_PATTERN, name)
  ) {
    return invalidMetadata(hookName, "returned an invalid response cookie name");
  }
  if (typeof cookieValue !== "string" || cookieValue.length > MAX_RESPONSE_COOKIE_VALUE_LENGTH) {
    return invalidMetadata(hookName, `returned an invalid value for response cookie "${name}"`);
  }
  try {
    encodeCookieValue(cookieValue);
  } catch {
    return invalidMetadata(hookName, `returned an invalid value for response cookie "${name}"`);
  }

  const result: ResponseCookie = { name, value: cookieValue };
  for (const key of ["domain", "path", "expires"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (
      typeof field !== "string" || field.length === 0 ||
      field.length > MAX_RESPONSE_HEADER_VALUE_LENGTH ||
      !isValidCookieAttribute(field)
    ) {
      return invalidMetadata(hookName, `returned an invalid ${key} for response cookie "${name}"`);
    }
    result[key] = field;
  }
  if (result.expires !== undefined && !Number.isFinite(Date.parse(result.expires))) {
    return invalidMetadata(hookName, `returned an invalid expires for response cookie "${name}"`);
  }

  const maxAge = value.maxAge;
  if (maxAge !== undefined) {
    if (typeof maxAge !== "number" || !numberIsSafeInteger(maxAge)) {
      return invalidMetadata(hookName, `returned an invalid maxAge for response cookie "${name}"`);
    }
    result.maxAge = maxAge;
  }
  for (const key of ["httpOnly", "secure"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "boolean") {
      return invalidMetadata(hookName, `returned an invalid ${key} for response cookie "${name}"`);
    }
    result[key] = field;
  }

  const sameSite = value.sameSite;
  if (sameSite !== undefined) {
    if (sameSite !== "lax" && sameSite !== "strict" && sameSite !== "none") {
      return invalidMetadata(
        hookName,
        `returned an invalid sameSite for response cookie "${name}"`,
      );
    }
    result.sameSite = sameSite;
  }

  if (name.startsWith("__Secure-") && result.secure !== true) {
    return invalidMetadata(hookName, `response cookie "${name}" must set secure`);
  }
  if (
    name.startsWith("__Host-") &&
    (result.secure !== true || result.path !== "/" || result.domain !== undefined)
  ) {
    return invalidMetadata(
      hookName,
      `response cookie "${name}" must set secure, use path "/", and omit domain`,
    );
  }
  if (result.sameSite === "none" && result.secure !== true) {
    return invalidMetadata(
      hookName,
      `response cookie "${name}" with sameSite "none" must set secure`,
    );
  }
  if (serializeNormalizedResponseCookie(result).length > MAX_SERIALIZED_RESPONSE_COOKIE_LENGTH) {
    return invalidMetadata(
      hookName,
      `response cookie "${name}" exceeds the serialized size limit`,
    );
  }

  return result;
}

function normalizeCookies(
  value: unknown,
  hookName: "getServerData" | "getStaticData",
): ResponseCookie[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    return invalidMetadata(hookName, "response cookies must be an array");
  }
  if (value.length > MAX_RESPONSE_COOKIE_COUNT) {
    return invalidMetadata(
      hookName,
      `cannot return more than ${MAX_RESPONSE_COOKIE_COUNT} response cookies`,
    );
  }
  const cookies = value.map((cookie) => normalizeCookie(cookie, hookName));
  return cookies.length > 0 ? cookies : undefined;
}

export function normalizeDataResponseMetadata(
  value: { headers?: unknown; cookies?: unknown },
  hookName: "getServerData" | "getStaticData" = "getServerData",
): DataResponseMetadata {
  if (
    hookName === "getStaticData" &&
    (value.headers !== undefined || value.cookies !== undefined)
  ) {
    return invalidMetadata(hookName, "cannot return response headers or cookies");
  }

  const headers = normalizeHeaders(value.headers, hookName);
  const cookies = normalizeCookies(value.cookies, hookName);
  return {
    ...(headers ? { headers } : {}),
    ...(cookies ? { cookies } : {}),
  };
}

export function mergeDataResponseMetadata(
  metadata: readonly DataResponseMetadata[],
): DataResponseMetadata {
  const headers = new Map<string, string>();
  const cookies: ResponseCookie[] = [];
  for (const value of metadata) {
    const normalized = normalizeDataResponseMetadata(value);
    for (const [name, headerValue] of objectEntries(normalized.headers ?? {})) {
      headers.set(name, headerValue);
    }
    cookies.push(...(normalized.cookies ?? []));
  }
  return {
    ...(headers.size > 0 ? { headers: Object.fromEntries(headers) } : {}),
    ...(cookies.length > 0 ? { cookies } : {}),
  };
}

/**
 * Carry validated response metadata through an internal error path without
 * placing cookie values in enumerable error context, logs, or telemetry.
 */
export function attachDataResponseMetadata<T extends Error>(
  carrier: T,
  metadata: DataResponseMetadata,
): T {
  attachedResponseMetadata.set(carrier, normalizeDataResponseMetadata(metadata));
  return carrier;
}

/** Read response metadata attached by {@link attachDataResponseMetadata}. */
export function getAttachedDataResponseMetadata(carrier: Error): DataResponseMetadata {
  return attachedResponseMetadata.get(carrier) ?? {};
}

function serializeNormalizedResponseCookie(cookie: ResponseCookie): string {
  const parts = [`${cookie.name}=${encodeCookieValue(cookie.value)}`];
  if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
  if (cookie.path) parts.push(`Path=${cookie.path}`);
  if (cookie.expires) parts.push(`Expires=${new Date(cookie.expires).toUTCString()}`);
  if (cookie.maxAge !== undefined) parts.push(`Max-Age=${cookie.maxAge}`);
  if (cookie.httpOnly) parts.push("HttpOnly");
  if (cookie.secure) parts.push("Secure");
  if (cookie.sameSite) {
    parts.push(`SameSite=${cookie.sameSite[0]!.toUpperCase()}${cookie.sameSite.slice(1)}`);
  }
  return parts.join("; ");
}

export function serializeResponseCookie(cookie: ResponseCookie): string {
  return serializeNormalizedResponseCookie(normalizeCookie(cookie, "getServerData"));
}

export function appendDataResponseMetadata(
  target: Headers,
  metadata: DataResponseMetadata,
): void {
  const normalized = normalizeDataResponseMetadata(metadata);
  for (const [name, value] of objectEntries(normalized.headers ?? {})) {
    target.append(name, value);
  }
  for (const cookie of normalized.cookies ?? []) {
    target.append("Set-Cookie", serializeResponseCookie(cookie));
  }
}
