const MAX_REDIS_URL_CODE_UNITS = 4_096;

/** Validate a Redis URL without rewriting credentials or other URL components. */
export function requireRedisUrl(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_REDIS_URL_CODE_UNITS || value.trim() !== value ||
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
  return value;
}
