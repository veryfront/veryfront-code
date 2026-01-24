import type { LRUEntry } from "./types.ts";
import { LRUNode } from "./lru-node.ts";
import type { LRUListManager } from "./lru-list-manager.ts";

export class EntryManager {
  constructor(private readonly estimateSizeOf: (value: unknown) => number) {}

  updateExistingEntry<T>(
    node: LRUNode<unknown>,
    value: T,
    ttlMs: number | undefined,
    tags: string[] | undefined,
    defaultTtlMs: number | undefined,
    listManager: LRUListManager<unknown>,
    tagIndex: Map<string, Set<string>>,
    key: string,
  ): number {
    const oldSize = node.entry.size;
    const newSize = this.estimateSizeOf(value);
    const expiry = this.calculateExpiry(ttlMs, defaultTtlMs);

    if (node.entry.tags?.length) {
      this.cleanupTags(node.entry.tags, key, tagIndex);
    }

    node.entry = {
      value,
      size: newSize,
      expiry,
      tags,
      lastAccessed: Date.now(),
    };

    listManager.moveToFront(node);

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
  ): [LRUNode<unknown>, number] {
    const size = this.estimateSizeOf(value);
    const expiry = this.calculateExpiry(ttlMs, defaultTtlMs);

    const entry: LRUEntry<unknown> = {
      value,
      size,
      expiry,
      tags,
      lastAccessed: Date.now(),
    };

    const node = new LRUNode(key, entry);
    store.set(key, node);
    listManager.addToFront(node);

    return [node, size];
  }

  updateTagIndex(
    tags: string[],
    key: string,
    tagIndex: Map<string, Set<string>>,
  ): void {
    for (const tag of tags) {
      let set = tagIndex.get(tag);
      if (!set) {
        set = new Set<string>();
        tagIndex.set(tag, set);
      }
      set.add(key);
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
      if (set.size === 0) {
        tagIndex.delete(tag);
      }
    }
  }

  private calculateExpiry(
    ttlMs: number | undefined,
    defaultTtlMs: number | undefined,
  ): number | undefined {
    if (typeof ttlMs === "number") return Date.now() + ttlMs;
    if (defaultTtlMs) return Date.now() + defaultTtlMs;
    return undefined;
  }
}
