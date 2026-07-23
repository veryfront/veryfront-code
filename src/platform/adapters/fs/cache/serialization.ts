import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors/error-registry/server.ts";
import type { CacheEntry } from "./types.ts";

const BYTE_ENCODING = "bytes-v1";
const UNDEFINED_ENCODING = "undefined-v1";
const BASE64_CHUNK_SIZE = 32_768;

interface EncodedCacheEntry {
  value?: unknown;
  timestamp: number;
  size: number;
  valueEncoding?: typeof BYTE_ENCODING | typeof UNDEFINED_ENCODING;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

function decodeBytes(encoded: string): Uint8Array {
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Distributed file cache contains invalid byte encoding",
    });
  }

  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseEncodedEntry(serialized: string): EncodedCacheEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Distributed file cache entry is not valid JSON",
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Distributed file cache entry is not an object",
    });
  }

  const entry = parsed as Partial<EncodedCacheEntry>;
  if (
    typeof entry.timestamp !== "number" ||
    !Number.isFinite(entry.timestamp) ||
    entry.timestamp < 0 ||
    typeof entry.size !== "number" ||
    !Number.isFinite(entry.size) ||
    entry.size < 0
  ) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Distributed file cache entry metadata is invalid",
    });
  }

  return entry as EncodedCacheEntry;
}

export function serializeFileCacheEntry<T>(entry: CacheEntry<T>): string {
  if (entry.value instanceof Uint8Array) {
    return JSON.stringify(
      {
        value: encodeBytes(entry.value),
        timestamp: entry.timestamp,
        size: entry.size,
        valueEncoding: BYTE_ENCODING,
      } satisfies EncodedCacheEntry,
    );
  }

  if (entry.value === undefined) {
    return JSON.stringify(
      {
        timestamp: entry.timestamp,
        size: entry.size,
        valueEncoding: UNDEFINED_ENCODING,
      } satisfies EncodedCacheEntry,
    );
  }

  try {
    return JSON.stringify(entry);
  } catch {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "File cache value is not JSON serializable",
    });
  }
}

export function deserializeFileCacheEntry<T>(serialized: string): CacheEntry<T> {
  const entry = parseEncodedEntry(serialized);

  if (entry.valueEncoding === BYTE_ENCODING) {
    if (typeof entry.value !== "string") {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Distributed file cache byte value is invalid",
      });
    }
    return {
      value: decodeBytes(entry.value) as T,
      timestamp: entry.timestamp,
      size: entry.size,
    };
  }

  if (entry.valueEncoding === UNDEFINED_ENCODING) {
    return {
      value: undefined as T,
      timestamp: entry.timestamp,
      size: entry.size,
    };
  }

  if (entry.valueEncoding !== undefined) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Distributed file cache value encoding is unsupported",
    });
  }

  return entry as CacheEntry<T>;
}
