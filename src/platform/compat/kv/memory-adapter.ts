import type { Kv, KvEntry, KvListOptions } from "./types.ts";

export class MemoryKv implements Kv {
  private store = new Map<string, { value: unknown; versionstamp: string }>();

  private keyToString(key: string[]): string {
    return JSON.stringify(key);
  }

  private stringToKey(keyStr: string): string[] {
    return JSON.parse(keyStr);
  }

  async get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }> {
    const entry = this.store.get(this.keyToString(key));
    if (!entry) return { value: undefined };

    return { value: entry.value as T, versionstamp: entry.versionstamp };
  }

  async set<T = unknown>(key: string[], value: T): Promise<void> {
    this.store.set(this.keyToString(key), { value, versionstamp: Date.now().toString() });
  }

  async delete(key: string[]): Promise<void> {
    this.store.delete(this.keyToString(key));
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    let entries = Array.from(this.store.entries());

    if (options?.prefix) {
      const prefixStr = this.keyToString(options.prefix);
      entries = entries.filter(([key]) => key.startsWith(prefixStr.slice(0, -1)));
    }

    entries.sort((a, b) => {
      const result = a[0].localeCompare(b[0]);
      return options?.reverse ? -result : result;
    });

    if (options?.start) {
      const startStr = this.keyToString(options.start);
      entries = entries.filter(([key]) => key >= startStr);
    }

    if (options?.end) {
      const endStr = this.keyToString(options.end);
      entries = entries.filter(([key]) => key < endStr);
    }

    if (options?.limit != null) {
      entries = entries.slice(0, options.limit);
    }

    for (const [keyStr, entry] of entries) {
      yield {
        key: this.stringToKey(keyStr),
        value: entry.value as T,
        versionstamp: entry.versionstamp,
      };
    }
  }

  close(): void {
    this.store.clear();
  }
}
