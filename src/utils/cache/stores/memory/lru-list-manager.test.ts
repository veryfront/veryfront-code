import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { LRUNode } from "./lru-node.ts";

function createNode(key: string): LRUNode<unknown> {
  return new LRUNode(key, { value: key, size: 1, lastAccessed: Date.now() });
}

function createListWithNodes(...keys: string[]): {
  list: LRUListManager<unknown>;
  nodes: Record<string, LRUNode<unknown>>;
} {
  const list = new LRUListManager<unknown>();
  const nodes: Record<string, LRUNode<unknown>> = {};

  for (const key of keys) {
    const node = createNode(key);
    nodes[key] = node;
    list.addToFront(node);
  }

  return { list, nodes };
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
      const { list, nodes } = createListWithNodes("a", "b");

      assertEquals(list.getHead(), nodes.b);
      assertEquals(list.getTail(), nodes.a);
    });

    it("should maintain correct order with multiple nodes", () => {
      const { list } = createListWithNodes("a", "b", "c");

      assertEquals(list.getHead()?.key, "c");
      assertEquals(list.getHead()?.next?.key, "b");
      assertEquals(list.getTail()?.key, "a");
    });
  });

  describe("moveToFront", () => {
    it("should be no-op for head node", () => {
      const { list, nodes } = createListWithNodes("a", "b");

      list.moveToFront(nodes.b);

      assertEquals(list.getHead()?.key, "b");
      assertEquals(list.getTail()?.key, "a");
    });

    it("should move tail to front", () => {
      const { list, nodes } = createListWithNodes("a", "b", "c");

      list.moveToFront(nodes.a);

      assertEquals(list.getHead()?.key, "a");
      assertEquals(list.getTail()?.key, "b");
    });

    it("should move middle node to front", () => {
      const { list, nodes } = createListWithNodes("a", "b", "c");

      list.moveToFront(nodes.b);

      assertEquals(list.getHead()?.key, "b");
      assertEquals(list.getHead()?.next?.key, "c");
      assertEquals(list.getTail()?.key, "a");
    });
  });

  describe("removeNode", () => {
    it("should remove head node", () => {
      const { list, nodes } = createListWithNodes("a", "b");

      list.removeNode(nodes.b);

      assertEquals(list.getHead()?.key, "a");
      assertEquals(list.getTail()?.key, "a");
    });

    it("should remove tail node", () => {
      const { list, nodes } = createListWithNodes("a", "b");

      list.removeNode(nodes.a);

      assertEquals(list.getHead()?.key, "b");
      assertEquals(list.getTail()?.key, "b");
    });

    it("should remove middle node", () => {
      const { list, nodes } = createListWithNodes("a", "b", "c");

      list.removeNode(nodes.b);

      assertEquals(list.getHead()?.key, "c");
      assertEquals(list.getHead()?.next?.key, "a");
      assertEquals(list.getTail()?.key, "a");
    });
  });

  describe("clear", () => {
    it("should reset head and tail to null", () => {
      const { list } = createListWithNodes("a", "b");

      list.clear();

      assertEquals(list.getHead(), null);
      assertEquals(list.getTail(), null);
    });
  });
});
