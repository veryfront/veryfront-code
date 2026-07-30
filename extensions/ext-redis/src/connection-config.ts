import { getEnv } from "veryfront/platform";
import { MAX_TIMER_DELAY_MS } from "veryfront/utils";

const MAX_REDIS_URL_CODE_UNITS = 4_096;
const OPTION_NAMES = new Set(["url", "connectTimeoutMs", "operationTimeoutMs"]);

/** Connection policy owned entirely by the Redis extension. */
export interface RedisExtensionOptions {
  /** Explicit Redis URL. Falls back to `REDIS_URL` only inside this extension. */
  readonly url?: string;
  /** Maximum time to establish a connection. */
  readonly connectTimeoutMs?: number;
  /** Maximum time for bounded operations that expose a timeout. */
  readonly operationTimeoutMs?: number;
}

export interface RedisConnectionPolicy {
  readonly url?: string;
  readonly connectTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

function readOwnDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Redis extension option ${key} must be a data property`);
  }
  return descriptor.value;
}

function requireTimeout(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) || (value as number) <= 0 ||
    (value as number) > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Redis extension ${label} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return value as number;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/** Validate a Redis URL without returning a normalized string that could rewrite credentials. */
export function requireRedisUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REDIS_URL_CODE_UNITS ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Redis URL must be a bounded non-empty canonical string");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new TypeError("Redis URL must be an absolute redis:// or rediss:// URL", { cause });
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new TypeError("Redis URL must use redis:// or rediss://");
  }
  if (!parsed.hostname) throw new TypeError("Redis URL must include a hostname");
  if (parsed.hash) throw new TypeError("Redis URL must not include a fragment");
  if (parsed.protocol === "redis:" && !isLoopbackHostname(parsed.hostname)) {
    throw new TypeError("Remote Redis connections must use rediss://");
  }
  return value;
}

/** Capture extension configuration without invoking accessors or retaining caller mutation. */
export function captureRedisConnectionPolicy(
  value: RedisExtensionOptions = {},
): RedisConnectionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Redis extension options must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Redis extension options must be a plain object");
  }
  if (keys.some((key) => typeof key !== "string" || !OPTION_NAMES.has(key))) {
    throw new TypeError("Redis extension options contain an unknown option");
  }

  const urlValue = readOwnDataProperty(value, "url");
  const url = urlValue === undefined ? undefined : requireRedisUrl(urlValue);
  const connectTimeoutMs = requireTimeout(
    readOwnDataProperty(value, "connectTimeoutMs"),
    "connectTimeoutMs",
  );
  const operationTimeoutMs = requireTimeout(
    readOwnDataProperty(value, "operationTimeoutMs"),
    "operationTimeoutMs",
  );
  return Object.freeze({ url, connectTimeoutMs, operationTimeoutMs });
}

export function resolveRedisUrl(
  policy: RedisConnectionPolicy,
  readEnv: (name: string) => string | undefined = getEnv,
): string {
  const configured = policy.url ?? readEnv("REDIS_URL");
  if (configured === undefined || configured.length === 0) {
    throw new TypeError("ext-redis requires a configured URL or REDIS_URL");
  }
  return requireRedisUrl(configured);
}

export function hasRedisUrl(
  policy: RedisConnectionPolicy,
  readEnv: (name: string) => string | undefined = getEnv,
): boolean {
  const configured = policy.url ?? readEnv("REDIS_URL");
  if (configured === undefined || configured.length === 0) return false;
  requireRedisUrl(configured);
  return true;
}
