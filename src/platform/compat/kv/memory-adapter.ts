import type { Kv, KvEntry, KvListOptions } from "./types.ts";
import {
  createKvVersionstamp,
  deserializeKvKey,
  deserializeKvValue,
  isKvKeyPrefix,
  serializeKvKey,
  serializeKvValue,
  validateKvListLimit,
} from "./internal.ts";

const textEncoder = new TextEncoder();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const difference = left[i]! - right[i]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareSerializedKeys(left: string, right: string): number {
  return compareBytes(textEncoder.encode(left), textEncoder.encode(right));
}

export class MemoryKv implements Kv {
  private store = new Map<string, { value: string; versionstamp: string }>();

  async get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }> {
    const entry = this.store.get(serializeKvKey(key));
    if (!entry) return { value: undefined };

    return {
      value: deserializeKvValue<T>(entry.value),
      versionstamp: entry.versionstamp,
    };
  }

  async set<T = unknown>(key: string[], value: T): Promise<void> {
    this.store.set(serializeKvKey(key), {
      value: serializeKvValue(value),
      versionstamp: createKvVersionstamp(),
    });
  }

  async delete(key: string[]): Promise<void> {
    this.store.delete(serializeKvKey(key));
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const limit = validateKvListLimit(options);
    let entries = Array.from(this.store.entries());

    const prefix = options?.prefix;
    if (prefix) {
      serializeKvKey(prefix);
      entries = entries.filter(([key]) => isKvKeyPrefix(prefix, deserializeKvKey(key)));
    }

    // SQLite orders TEXT values by their encoded bytes under the binary
    // collation. Compare the serialized keys the same way so MemoryKv and
    // SqliteKv agree for non-ASCII keys and for start/end bounds.
    entries.sort((a, b) => {
      const result = compareSerializedKeys(a[0], b[0]);
      return options?.reverse ? -result : result;
    });

    if (options?.start) {
      const startStr = serializeKvKey(options.start);
      entries = entries.filter(([key]) => compareSerializedKeys(key, startStr) >= 0);
    }

    if (options?.end) {
      const endStr = serializeKvKey(options.end);
      entries = entries.filter(([key]) => compareSerializedKeys(key, endStr) < 0);
    }

    if (limit !== undefined) {
      entries = entries.slice(0, limit);
    }

    for (const [keyStr, entry] of entries) {
      yield {
        key: deserializeKvKey(keyStr),
        value: deserializeKvValue<T>(entry.value),
        versionstamp: entry.versionstamp,
      };
    }
  }

  close(): void {
    this.store.clear();
  }
}
