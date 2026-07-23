import type { Kv, KvEntry, KvListOptions } from "./types.ts";
import {
  assertKvListScanWithinLimit,
  assertKvOpen,
  decodeStoredKvKey,
  decodeStoredKvValue,
  encodeKvKey,
  encodeKvValue,
  normalizeKvListOptions,
  selectKvEntries,
  VersionstampGenerator,
} from "./contract.ts";

/** Bounded in-memory implementation of the portable Veryfront KV contract. */
export class MemoryKv implements Kv {
  private readonly store = new Map<string, { value: string; versionstamp: string }>();
  private readonly versionstamps = new VersionstampGenerator();
  private closed = false;

  async get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }> {
    assertKvOpen(this.closed);
    const entry = this.store.get(encodeKvKey(key));
    if (!entry) return { value: undefined };

    return {
      value: decodeStoredKvValue<T>(entry.value),
      versionstamp: entry.versionstamp,
    };
  }

  async set<T = unknown>(key: string[], value: T): Promise<void> {
    assertKvOpen(this.closed);
    this.store.set(encodeKvKey(key), {
      value: encodeKvValue(value),
      versionstamp: this.versionstamps.next(),
    });
  }

  async delete(key: string[]): Promise<void> {
    assertKvOpen(this.closed);
    this.store.delete(encodeKvKey(key));
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    assertKvOpen(this.closed);
    const normalizedOptions = normalizeKvListOptions(options);
    if (normalizedOptions.limit === 0) return;
    const bufferedEntries = [];
    let scannedEntries = 0;
    for (const [encodedKey, entry] of this.store) {
      assertKvListScanWithinLimit(++scannedEntries, normalizedOptions.maxScanEntries);
      bufferedEntries.push({
        encodedKey,
        key: decodeStoredKvKey(encodedKey),
        value: entry.value,
        versionstamp: entry.versionstamp,
      });
    }
    const entries = selectKvEntries(
      bufferedEntries,
      normalizedOptions,
    );

    for (const entry of entries) {
      assertKvOpen(this.closed);
      yield {
        key: [...entry.key],
        value: decodeStoredKvValue<T>(entry.value),
        versionstamp: entry.versionstamp,
      };
    }
  }

  close(): void {
    if (this.closed) return;
    this.store.clear();
    this.closed = true;
  }
}
