import type { LRUEntry } from "./types.js";

export class LRUNode<T> {
  constructor(
    public key: string,
    public entry: LRUEntry<T>,
    public prev: LRUNode<T> | null = null,
    public next: LRUNode<T> | null = null,
  ) {}
}
