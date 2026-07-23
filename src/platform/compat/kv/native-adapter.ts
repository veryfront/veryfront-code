import { PLATFORM_ERROR } from "#veryfront/errors/error-registry/deploy.ts";
import {
  assertKvListScanWithinLimit,
  assertKvOpen,
  compareEncodedKvKeys,
  decodeStoredKvValue,
  encodeKvKey,
  encodeKvValue,
  matchesKvListOptions,
  normalizeKvKey,
  normalizeKvListOptions,
  selectKvEntries,
} from "./contract.ts";
import type { Kv, KvEntry, KvListOptions } from "./types.ts";

const NATIVE_VALUE_HEADER = Uint8Array.of(0x56, 0x46, 0x4b, 0x56, 0x01, 0x4a, 0x53, 0x4f);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface NativeKvBackendEntry {
  key: readonly unknown[];
  value: unknown;
  versionstamp: string;
}

export interface NativeKvCommitResult {
  ok: boolean;
  versionstamp?: string;
}

export interface NativeKvBackend {
  get(key: readonly unknown[]): Promise<{
    key: readonly unknown[];
    value: unknown;
    versionstamp: string | null;
  }>;
  set(key: readonly unknown[], value: unknown): Promise<NativeKvCommitResult>;
  delete(key: readonly unknown[]): Promise<void>;
  list(
    selector: { prefix: readonly unknown[] },
    options?: { reverse?: boolean; limit?: number },
  ): AsyncIterable<NativeKvBackendEntry>;
  close(): void;
}

type NativeMethod = (...args: unknown[]) => unknown;

function invalidBackend(): never {
  throw PLATFORM_ERROR.create({ message: "Native KV backend is invalid" });
}

function captureMethod(backend: NativeKvBackend, name: keyof NativeKvBackend): NativeMethod {
  let method: unknown;
  try {
    method = Reflect.get(backend, name);
  } catch {
    invalidBackend();
  }
  if (typeof method !== "function") invalidBackend();
  return (...args: unknown[]) => Reflect.apply(method, backend, args);
}

function providerFailure(): never {
  throw PLATFORM_ERROR.create({ message: "Native KV operation failed" });
}

function keysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function encodeNativeValue(value: unknown): Uint8Array {
  const payload = textEncoder.encode(encodeKvValue(value));
  const stored = new Uint8Array(NATIVE_VALUE_HEADER.byteLength + payload.byteLength);
  stored.set(NATIVE_VALUE_HEADER);
  stored.set(payload, NATIVE_VALUE_HEADER.byteLength);
  return stored;
}

function decodeNativeValue(value: unknown): string {
  if (value instanceof Uint8Array) {
    if (
      value.byteLength < NATIVE_VALUE_HEADER.byteLength ||
      NATIVE_VALUE_HEADER.some((byte, index) => value[index] !== byte)
    ) {
      throw new TypeError("Invalid native KV value envelope");
    }
    const encoded = textDecoder.decode(value.subarray(NATIVE_VALUE_HEADER.byteLength));
    decodeStoredKvValue(encoded);
    return encoded;
  }

  // Values written by earlier Veryfront versions used native structured clone.
  return encodeKvValue(value);
}

type BufferedNativeEntry = {
  encodedKey: string;
  key: string[];
  value: unknown;
  versionstamp: string;
  encounterOrder: number;
};

function compareBufferedEntries(
  left: BufferedNativeEntry,
  right: BufferedNativeEntry,
  reverse: boolean,
): number {
  const result = compareEncodedKvKeys(left.encodedKey, right.encodedKey) ||
    left.encounterOrder - right.encounterOrder;
  return reverse ? -result : result;
}

function restoreMaxHeap(
  entries: BufferedNativeEntry[],
  parentIndex: number,
  reverse: boolean,
): void {
  while (true) {
    const leftIndex = parentIndex * 2 + 1;
    if (leftIndex >= entries.length) return;

    const rightIndex = leftIndex + 1;
    let worstIndex = leftIndex;
    if (
      rightIndex < entries.length &&
      compareBufferedEntries(entries[rightIndex]!, entries[leftIndex]!, reverse) > 0
    ) {
      worstIndex = rightIndex;
    }
    if (
      compareBufferedEntries(entries[worstIndex]!, entries[parentIndex]!, reverse) <= 0
    ) {
      return;
    }

    [entries[parentIndex], entries[worstIndex]] = [
      entries[worstIndex]!,
      entries[parentIndex]!,
    ];
    parentIndex = worstIndex;
  }
}

function retainBoundedEntry(
  entries: BufferedNativeEntry[],
  entry: BufferedNativeEntry,
  limit: number | undefined,
  reverse: boolean,
): void {
  if (limit === undefined) {
    entries.push(entry);
    return;
  }

  if (entries.length < limit) {
    entries.push(entry);
    let childIndex = entries.length - 1;
    while (childIndex > 0) {
      const parentIndex = (childIndex - 1) >>> 1;
      if (compareBufferedEntries(entries[childIndex]!, entries[parentIndex]!, reverse) <= 0) {
        break;
      }
      [entries[parentIndex], entries[childIndex]] = [
        entries[childIndex]!,
        entries[parentIndex]!,
      ];
      childIndex = parentIndex;
    }
    return;
  }

  if (compareBufferedEntries(entry, entries[0]!, reverse) >= 0) return;
  entries[0] = entry;
  restoreMaxHeap(entries, 0, reverse);
}

/** Normalize native Deno KV behavior to Veryfront's string-key, JSON-value contract. */
export class NativeKv implements Kv {
  private readonly nativeGet: NativeMethod;
  private readonly nativeSet: NativeMethod;
  private readonly nativeDelete: NativeMethod;
  private readonly nativeList: NativeMethod;
  private readonly nativeClose: NativeMethod;
  private closed = false;

  constructor(backend: NativeKvBackend) {
    if ((typeof backend !== "object" && typeof backend !== "function") || backend === null) {
      invalidBackend();
    }
    this.nativeGet = captureMethod(backend, "get");
    this.nativeSet = captureMethod(backend, "set");
    this.nativeDelete = captureMethod(backend, "delete");
    this.nativeList = captureMethod(backend, "list");
    this.nativeClose = captureMethod(backend, "close");
  }

  async get<T = unknown>(
    key: string[],
  ): Promise<{ value: T | undefined; versionstamp?: string }> {
    assertKvOpen(this.closed);
    const normalizedKey = normalizeKvKey(key);

    let result: unknown;
    try {
      result = await this.nativeGet(normalizedKey);
    } catch {
      providerFailure();
    }

    if ((typeof result !== "object" && typeof result !== "function") || result === null) {
      providerFailure();
    }

    try {
      const responseKey = normalizeKvKey(Reflect.get(result, "key"), "Native KV response key");
      const value = Reflect.get(result, "value");
      const versionstamp = Reflect.get(result, "versionstamp");
      if (!keysEqual(responseKey, normalizedKey)) throw new TypeError("Mismatched KV response key");
      if (versionstamp === null) {
        if (value !== null) throw new TypeError("Invalid missing KV response");
        return { value: undefined };
      }
      if (typeof versionstamp !== "string" || versionstamp.length === 0) {
        throw new TypeError("Invalid KV versionstamp");
      }
      return {
        value: decodeStoredKvValue<T>(decodeNativeValue(value)),
        versionstamp,
      };
    } catch {
      providerFailure();
    }
  }

  async set<T = unknown>(key: string[], value: T): Promise<void> {
    assertKvOpen(this.closed);
    const normalizedKey = normalizeKvKey(key);
    const normalizedValue = encodeNativeValue(value);
    try {
      const result = await this.nativeSet(normalizedKey, normalizedValue);
      if ((typeof result !== "object" && typeof result !== "function") || result === null) {
        throw new TypeError("Invalid KV commit result");
      }
      const ok = Reflect.get(result, "ok");
      const versionstamp = Reflect.get(result, "versionstamp");
      if (ok !== true || typeof versionstamp !== "string" || versionstamp.length === 0) {
        throw new TypeError("Invalid KV commit result");
      }
    } catch {
      providerFailure();
    }
  }

  async delete(key: string[]): Promise<void> {
    assertKvOpen(this.closed);
    const normalizedKey = normalizeKvKey(key);
    try {
      await this.nativeDelete(normalizedKey);
    } catch {
      providerFailure();
    }
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    assertKvOpen(this.closed);
    const normalizedOptions = normalizeKvListOptions(options);
    if (normalizedOptions.limit === 0) return;
    const rawEntries: BufferedNativeEntry[] = [];
    let encounterOrder = 0;
    let scannedEntries = 0;
    let scanLimitExceeded = false;

    try {
      const iterable = this.nativeList({
        prefix: normalizedOptions.prefix ? [...normalizedOptions.prefix] : [],
      });
      for await (const rawEntry of iterable as AsyncIterable<unknown>) {
        assertKvOpen(this.closed);
        if (++scannedEntries > normalizedOptions.maxScanEntries) {
          scanLimitExceeded = true;
          break;
        }
        if (
          (typeof rawEntry !== "object" && typeof rawEntry !== "function") ||
          rawEntry === null
        ) {
          providerFailure();
        }

        let rawKey: unknown;
        let rawValue: unknown;
        let versionstamp: unknown;
        try {
          rawKey = Reflect.get(rawEntry, "key");
          rawValue = Reflect.get(rawEntry, "value");
          versionstamp = Reflect.get(rawEntry, "versionstamp");
        } catch {
          providerFailure();
        }

        let key: string[];
        try {
          key = normalizeKvKey(rawKey, "Stored KV key");
        } catch {
          // Native stores can contain valid keys outside Veryfront's string-key subset.
          continue;
        }
        if (typeof versionstamp !== "string" || versionstamp.length === 0) providerFailure();

        const entry = {
          encodedKey: encodeKvKey(key),
          key,
          value: rawValue,
          versionstamp,
          encounterOrder: encounterOrder++,
        };
        if (!matchesKvListOptions(entry, normalizedOptions)) continue;
        retainBoundedEntry(
          rawEntries,
          entry,
          normalizedOptions.limit,
          normalizedOptions.reverse,
        );
      }
    } catch {
      providerFailure();
    }

    if (scanLimitExceeded) {
      assertKvListScanWithinLimit(scannedEntries, normalizedOptions.maxScanEntries);
    }

    if (normalizedOptions.limit !== undefined) {
      rawEntries.sort((left, right) => left.encounterOrder - right.encounterOrder);
    }
    const entries = selectKvEntries(rawEntries, normalizedOptions);
    for (const entry of entries) {
      assertKvOpen(this.closed);
      let value: T;
      try {
        value = decodeStoredKvValue<T>(decodeNativeValue(entry.value));
      } catch {
        providerFailure();
      }
      yield {
        key: [...entry.key],
        value,
        versionstamp: entry.versionstamp,
      };
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.nativeClose();
    } catch {
      providerFailure();
    }
  }
}
