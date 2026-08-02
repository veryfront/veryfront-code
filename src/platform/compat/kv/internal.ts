import type { KvListOptions } from "./types.ts";

export function serializeKvKey(key: string[]): string {
  if (!isStringArray(key)) {
    throw new TypeError("KV keys must be arrays of strings");
  }
  return JSON.stringify(key);
}

export function deserializeKvKey(serialized: string): string[] {
  const key = JSON.parse(serialized) as unknown;
  if (!isStringArray(key)) {
    throw new TypeError("Stored KV key is not an array of strings");
  }
  return key;
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (const part of value) {
    if (typeof part !== "string") return false;
  }
  return true;
}

export function isKvKeyPrefix(prefix: string[], key: string[]): boolean {
  return prefix.length <= key.length && prefix.every((part, index) => key[index] === part);
}

export function validateKvListLimit(options?: KvListOptions): number | undefined {
  const limit = options?.limit;
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("KV list limit must be a non-negative safe integer");
  }
  return limit;
}

export function serializeKvValue(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError("KV values must be JSON-serializable", { cause: error });
  }
  if (serialized === undefined) {
    throw new TypeError("KV values must be JSON-serializable");
  }
  return serialized;
}

export function deserializeKvValue<T>(serialized: string): T {
  return JSON.parse(serialized) as T;
}

export function createKvVersionstamp(): string {
  return crypto.randomUUID();
}
