import type { LRUNode } from "./lru-node.ts";

export class LRUListManager<T> {
  private head: LRUNode<T> | null = null;
  private tail: LRUNode<T> | null = null;

  getHead(): LRUNode<T> | null {
    return this.head;
  }

  getTail(): LRUNode<T> | null {
    return this.tail;
  }

  moveToFront(node: LRUNode<T>): void {
    if (node === this.head) {
      node.entry.lastAccessed = Date.now();
      return;
    }

    this.removeNode(node);

    this.addToFront(node);
  }

  addToFront(node: LRUNode<T>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
    node.entry.lastAccessed = Date.now();
  }

  removeNode(node: LRUNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    if (node === this.head) {
      this.head = node.next;
    }
    if (node === this.tail) {
      this.tail = node.prev;
    }
  }

  clear(): void {
    this.head = null;
    this.tail = null;
  }
}
