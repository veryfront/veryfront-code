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

    // Sort on code units so ordering matches SqliteKv's binary `ORDER BY key`
    // and the code-unit `start`/`end` bounds applied below.
    entries.sort((a, b) => {
      const result = a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      return options?.reverse ? -result : result;
    });

    if (options?.start) {
      const startStr = serializeKvKey(options.start);
      entries = entries.filter(([key]) => key >= startStr);
    }

    if (options?.end) {
      const endStr = serializeKvKey(options.end);
      entries = entries.filter(([key]) => key < endStr);
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
