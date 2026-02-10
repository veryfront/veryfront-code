import type { LRUEntry } from "./types.ts";

export class LRUNode<T> {
  key: string;
  entry: LRUEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;

  constructor(
    key: string,
    entry: LRUEntry<T>,
    prev: LRUNode<T> | null = null,
    next: LRUNode<T> | null = null,
  ) {
    this.key = key;
    this.entry = entry;
    this.prev = prev;
    this.next = next;
  }
}
