import {
  type CacheRevisionSnapshot,
  requireCacheExchangeResult,
  snapshotCacheRevisionResult,
} from "veryfront/extensions/distributed/cache-support";

const RECORD_PREFIX = "\0VFCAS1\0";
const MAX_SIGNED_REDIS_INTEGER = "9223372036854775807";

export type RedisRevisionedCacheRecord =
  | Readonly<{ kind: "present"; revision: string; value: string }>
  | Readonly<{ kind: "absent"; revision: string }>;

function requireCanonicalRevision(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > MAX_SIGNED_REDIS_INTEGER.length ||
    (value.length === MAX_SIGNED_REDIS_INTEGER.length &&
      value > MAX_SIGNED_REDIS_INTEGER)
  ) {
    throw new TypeError("Redis cache revision must be a canonical positive signed 64-bit integer");
  }
  return value;
}

/** Test whether a raw Redis string starts with the versioned CAS frame. */
export function hasRevisionedCacheRecordPrefix(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(RECORD_PREFIX);
}

/** Decode one strict revisioned Redis STRING without altering its payload. */
export function parseRevisionedCacheRecord(value: unknown): RedisRevisionedCacheRecord {
  if (!hasRevisionedCacheRecordPrefix(value)) {
    throw new TypeError("Redis revisioned cache record has invalid framing");
  }

  const stateIndex = RECORD_PREFIX.length;
  const state = value[stateIndex];
  if ((state !== "p" && state !== "a") || value[stateIndex + 1] !== "\0") {
    throw new TypeError("Redis revisioned cache record has invalid state framing");
  }
  const revisionStart = stateIndex + 2;
  const revisionEnd = value.indexOf("\0", revisionStart);
  if (revisionEnd < 0) {
    throw new TypeError("Redis revisioned cache record is missing its revision delimiter");
  }
  const revision = requireCanonicalRevision(value.slice(revisionStart, revisionEnd));
  const payload = value.slice(revisionEnd + 1);

  if (state === "a") {
    if (payload.length !== 0) {
      throw new TypeError("Redis absent revisioned cache record must not contain a payload");
    }
    return Object.freeze({ kind: "absent", revision });
  }
  return Object.freeze({ kind: "present", revision, value: payload });
}

/** Parse the exact two Redis Lua read result variants. */
export function parseRedisRevisionReadResult(value: unknown): CacheRevisionSnapshot {
  if (!Array.isArray(value)) {
    throw new TypeError("Redis revision read result must be an array");
  }
  if (value.length === 2 && value[0] === 0) {
    return snapshotCacheRevisionResult({
      value: null,
      revision: requireCanonicalRevision(value[1]),
    });
  }
  if (value.length === 3 && value[0] === 1 && typeof value[2] === "string") {
    return snapshotCacheRevisionResult({
      value: value[2],
      revision: requireCanonicalRevision(value[1]),
    });
  }
  throw new TypeError("Redis revision read result has an invalid shape");
}

/** Parse the exact Redis integer result used by compare-exchange. */
export function parseRedisRevisionExchangeResult(value: unknown): boolean {
  if (value !== 0 && value !== 1) {
    throw new TypeError("Redis revision exchange result must be integer zero or one");
  }
  return requireCacheExchangeResult(value === 1);
}
