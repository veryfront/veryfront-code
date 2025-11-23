import type { Kv, KvEntry, KvListOptions } from "./types.ts";

export class MemoryKv implements Kv {
  private store: Map<string, { value: unknown; versionstamp: string }> = new Map();

  private keyToString(key: string[]): string {
    return JSON.stringify(key);
  }

  private stringToKey(keyStr: string): string[] {
    return JSON.parse(keyStr);
  }

  get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }> {
    const keyStr = this.keyToString(key);
    const entry = this.store.get(keyStr);
    return Promise.resolve(
      entry
        ? { value: entry.value as T, versionstamp: entry.versionstamp }
        : { value: undefined as T | undefined },
    );
  }

  set<T = unknown>(key: string[], value: T): Promise<void> {
    const keyStr = this.keyToString(key);
    const versionstamp = Date.now().toString();
    this.store.set(keyStr, { value, versionstamp });
    return Promise.resolve();
  }

  delete(key: string[]): Promise<void> {
    const keyStr = this.keyToString(key);
    this.store.delete(keyStr);
    return Promise.resolve();
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const entries = Array.from(this.store.entries());

    let filtered = entries;
    if (options?.prefix) {
      const prefixStr = this.keyToString(options.prefix);
      filtered = entries.filter(([key]) => key.startsWith(prefixStr.slice(0, -1)));
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

    if (options?.limit !== undefined) {
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
