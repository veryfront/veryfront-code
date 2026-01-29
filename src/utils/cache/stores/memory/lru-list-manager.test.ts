import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { LRUNode } from "./lru-node.ts";

function createNode(key: string): LRUNode<unknown> {
  return new LRUNode(key, { value: key, size: 1, lastAccessed: Date.now() });
}

describe("LRUListManager", () => {
  describe("addToFront", () => {
    it("should set single node as both head and tail", () => {
      const list = new LRUListManager<unknown>();
      const node = createNode("a");
      list.addToFront(node);

      assertEquals(list.getHead(), node);
      assertEquals(list.getTail(), node);
    });

    it("should add new nodes to front", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");

      list.addToFront(a);
      list.addToFront(b);

      assertEquals(list.getHead(), b);
      assertEquals(list.getTail(), a);
    });

    it("should maintain correct order with multiple nodes", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      const c = createNode("c");

      list.addToFront(a);
      list.addToFront(b);
      list.addToFront(c);

      assertEquals(list.getHead()?.key, "c");
      assertEquals(list.getHead()?.next?.key, "b");
      assertEquals(list.getTail()?.key, "a");
    });
  });

  describe("moveToFront", () => {
    it("should be no-op for head node", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      list.addToFront(a);
      list.addToFront(b);

      list.moveToFront(b);
      assertEquals(list.getHead()?.key, "b");
      assertEquals(list.getTail()?.key, "a");
    });

    it("should move tail to front", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      const c = createNode("c");

      list.addToFront(a);
      list.addToFront(b);
      list.addToFront(c);
      // Order: c -> b -> a

      list.moveToFront(a);
      // Order: a -> c -> b

      assertEquals(list.getHead()?.key, "a");
      assertEquals(list.getTail()?.key, "b");
    });

    it("should move middle node to front", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      const c = createNode("c");

      list.addToFront(a);
      list.addToFront(b);
      list.addToFront(c);
      // Order: c -> b -> a

      list.moveToFront(b);
      // Order: b -> c -> a

      assertEquals(list.getHead()?.key, "b");
      assertEquals(list.getHead()?.next?.key, "c");
      assertEquals(list.getTail()?.key, "a");
    });
  });

  describe("removeNode", () => {
    it("should remove head node", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      list.addToFront(a);
      list.addToFront(b);

      list.removeNode(b);
      assertEquals(list.getHead()?.key, "a");
      assertEquals(list.getTail()?.key, "a");
    });

    it("should remove tail node", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      list.addToFront(a);
      list.addToFront(b);

      list.removeNode(a);
      assertEquals(list.getHead()?.key, "b");
      assertEquals(list.getTail()?.key, "b");
    });

    it("should remove middle node", () => {
      const list = new LRUListManager<unknown>();
      const a = createNode("a");
      const b = createNode("b");
      const c = createNode("c");

      list.addToFront(a);
      list.addToFront(b);
      list.addToFront(c);

      list.removeNode(b);
      assertEquals(list.getHead()?.key, "c");
      assertEquals(list.getHead()?.next?.key, "a");
      assertEquals(list.getTail()?.key, "a");
    });
  });

  describe("clear", () => {
    it("should reset head and tail to null", () => {
      const list = new LRUListManager<unknown>();
      list.addToFront(createNode("a"));
      list.addToFront(createNode("b"));

      list.clear();
      assertEquals(list.getHead(), null);
      assertEquals(list.getTail(), null);
    });
  });
});
