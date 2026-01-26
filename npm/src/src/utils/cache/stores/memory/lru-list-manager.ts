import type { LRUNode } from "./lru-node.js";

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
    node.entry.lastAccessed = Date.now();

    if (node === this.head) {
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
    } else {
      this.tail = node;
    }

    this.head = node;
    node.entry.lastAccessed = Date.now();
  }

  removeNode(node: LRUNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else if (node === this.head) {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else if (node === this.tail) {
      this.tail = node.prev;
    }
  }

  clear(): void {
    this.head = null;
    this.tail = null;
  }
}
