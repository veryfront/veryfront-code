import { base64urlDecodeBytes, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import type { CacheEntry } from "./types.ts";

const UINT8_ARRAY_ENCODING = "uint8array-base64url-v1";

interface SerializedCacheEntry {
  value: unknown;
  timestamp: number;
  size: number;
  valueEncoding?: typeof UINT8_ARRAY_ENCODING;
}

export function encodeCacheEntry(entry: CacheEntry<unknown>): string {
  const serialized: SerializedCacheEntry = entry.value instanceof Uint8Array
    ? {
      value: base64urlEncodeBytes(entry.value),
      timestamp: entry.timestamp,
      size: entry.size,
      valueEncoding: UINT8_ARRAY_ENCODING,
    }
    : entry;

  return JSON.stringify(serialized);
}

export function decodeCacheEntry<T>(serialized: string): CacheEntry<T> {
  const parsed: unknown = JSON.parse(serialized);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new TypeError("Invalid file-cache entry envelope");
  }

  const record = parsed as Record<string, unknown>;
  if (
    !Object.hasOwn(record, "value") ||
    typeof record.timestamp !== "number" ||
    !Number.isFinite(record.timestamp) ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0
  ) {
    throw new TypeError("Invalid file-cache entry fields");
  }

  if (record.valueEncoding === undefined) {
    return {
      value: record.value as T,
      timestamp: record.timestamp,
      size: record.size,
    };
  }

  if (
    record.valueEncoding !== UINT8_ARRAY_ENCODING ||
    typeof record.value !== "string"
  ) {
    throw new TypeError("Unsupported file-cache value encoding");
  }

  const bytes = base64urlDecodeBytes(record.value);
  if (bytes === undefined) {
    throw new TypeError("Invalid encoded file-cache byte value");
  }

  return {
    value: bytes as T,
    timestamp: record.timestamp,
    size: record.size,
  };
}
