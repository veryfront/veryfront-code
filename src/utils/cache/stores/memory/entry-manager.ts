import type { LRUEntry } from "./types.ts";
import { LRUNode } from "./lru-node.ts";
import type { LRUListManager } from "./lru-list-manager.ts";

interface PreparedEntryTiming {
  readonly accessedAt: number;
  readonly expiry: number | undefined;
}

export class EntryManager {
  constructor(private readonly sizeEstimator: (value: unknown) => number) {}

  requireValidSize(size: number): number {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RangeError("estimateSizeOf must return a finite non-negative integer");
    }
    return size;
  }

  estimateSize(value: unknown): number {
    return this.requireValidSize(this.sizeEstimator(value));
  }

  updateExistingEntry<T>(
    node: LRUNode<unknown>,
    value: T,
    ttlMs: number | undefined,
    tags: string[] | undefined,
    defaultTtlMs: number | undefined,
    listManager: LRUListManager<unknown>,
    tagIndex: Map<string, Set<string>>,
    key: string,
    precomputedSize?: number,
    timing?: PreparedEntryTiming,
  ): number {
    const oldSize = node.entry.size;
    const newSize = precomputedSize === undefined
      ? this.estimateSize(value)
      : this.requireValidSize(precomputedSize);
    const accessedAt = timing?.accessedAt ?? Date.now();
    const expiry = timing ? timing.expiry : this.calculateExpiry(ttlMs, defaultTtlMs, accessedAt);

    if (node.entry.tags?.length) this.cleanupTags(node.entry.tags, key, tagIndex);

    node.entry = {
      value,
      size: newSize,
      expiry,
      tags,
      lastAccessed: accessedAt,
    };

    listManager.moveToFront(node, accessedAt);

    return newSize - oldSize;
  }

  createNewEntry<T>(
    key: string,
    value: T,
    ttlMs: number | undefined,
    tags: string[] | undefined,
    defaultTtlMs: number | undefined,
    listManager: LRUListManager<unknown>,
    store: Map<string, LRUNode<unknown>>,
    precomputedSize?: number,
    timing?: PreparedEntryTiming,
  ): [LRUNode<unknown>, number] {
    const size = precomputedSize === undefined
      ? this.estimateSize(value)
      : this.requireValidSize(precomputedSize);
    const accessedAt = timing?.accessedAt ?? Date.now();
    const expiry = timing ? timing.expiry : this.calculateExpiry(ttlMs, defaultTtlMs, accessedAt);

    const entry: LRUEntry<unknown> = {
      value,
      size,
      expiry,
      tags,
      lastAccessed: accessedAt,
    };

    const node = new LRUNode(key, entry);
    store.set(key, node);
    listManager.addToFront(node, accessedAt);

    return [node, size];
  }

  updateTagIndex(
    tags: string[],
    key: string,
    tagIndex: Map<string, Set<string>>,
  ): void {
    for (const tag of tags) {
      const set = tagIndex.get(tag) ?? new Set<string>();
      set.add(key);
      tagIndex.set(tag, set);
    }
  }

  cleanupTags(
    tags: string[],
    key: string,
    tagIndex: Map<string, Set<string>>,
  ): void {
    for (const tag of tags) {
      const set = tagIndex.get(tag);
      if (!set) continue;

      set.delete(key);
      if (set.size === 0) tagIndex.delete(tag);
    }
  }

  private calculateExpiry(
    ttlMs: number | undefined,
    defaultTtlMs: number | undefined,
    accessedAt: number,
  ): number | undefined {
    if (typeof ttlMs === "number") return accessedAt + ttlMs;
    if (typeof defaultTtlMs === "number") return accessedAt + defaultTtlMs;
    return undefined;
  }
}
