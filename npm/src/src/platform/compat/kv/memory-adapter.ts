import type { Kv, KvEntry, KvListOptions } from "./types.js";

export class MemoryKv implements Kv {
  private store = new Map<string, { value: unknown; versionstamp: string }>();

  private keyToString(key: string[]): string {
    return JSON.stringify(key);
  }

  private stringToKey(keyStr: string): string[] {
    return JSON.parse(keyStr);
  }

  get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }> {
    const entry = this.store.get(this.keyToString(key));
    if (!entry) return Promise.resolve({ value: undefined });

    return Promise.resolve({ value: entry.value as T, versionstamp: entry.versionstamp });
  }

  set<T = unknown>(key: string[], value: T): Promise<void> {
    this.store.set(this.keyToString(key), { value, versionstamp: Date.now().toString() });
    return Promise.resolve();
  }

  delete(key: string[]): Promise<void> {
    this.store.delete(this.keyToString(key));
    return Promise.resolve();
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const entries = Array.from(this.store.entries());
    let filtered = entries;

    if (options?.prefix) {
      const prefixStr = this.keyToString(options.prefix);
      filtered = filtered.filter(([key]) => key.startsWith(prefixStr.slice(0, -1)));
    }

    filtered.sort((a, b) => {
      const result = a[0].localeCompare(b[0]);
      return options?.reverse ? -result : result;
    });

    if (options?.start) {
      const startStr = this.keyToString(options.start);
      filtered = filtered.filter(([key]) => key >= startStr);
    }

    if (options?.end) {
      const endStr = this.keyToString(options.end);
      filtered = filtered.filter(([key]) => key < endStr);
    }

    if (options?.limit != null) {
      filtered = filtered.slice(0, options.limit);
    }

    for (const [keyStr, entry] of filtered) {
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
