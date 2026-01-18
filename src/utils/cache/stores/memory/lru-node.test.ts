import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { LRUNode } from "./lru-node.ts";
import type { LRUEntry } from "./types.ts";

describe("lru-node", () => {
  describe("LRUNode", () => {
    it("should create node with key and entry", () => {
      const entry: LRUEntry<string> = {
        value: "test-value",
        size: 10,
        lastAccessed: Date.now(),
      };
      const node = new LRUNode("test-key", entry);

      expect(node.key).toBe("test-key");
      expect(node.entry).toBe(entry);
      expect(node.prev).toBeNull();
      expect(node.next).toBeNull();
    });

    it("should create node with prev pointer", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2, node1);

      expect(node2.prev).toBe(node1);
      expect(node2.next).toBeNull();
    });

    it("should create node with next pointer", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2, null, node1);

      expect(node2.prev).toBeNull();
      expect(node2.next).toBe(node1);
    });

    it("should create node with both prev and next pointers", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };
      const entry3: LRUEntry<string> = { value: "value3", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node3 = new LRUNode("key3", entry3);
      const node2 = new LRUNode("key2", entry2, node1, node3);

      expect(node2.prev).toBe(node1);
      expect(node2.next).toBe(node3);
    });

    it("should allow updating prev pointer", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2);

      expect(node2.prev).toBeNull();
      node2.prev = node1;
      expect(node2.prev).toBe(node1);
    });

    it("should allow updating next pointer", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2);

      expect(node2.next).toBeNull();
      node2.next = node1;
      expect(node2.next).toBe(node1);
    });

    it("should allow updating entry", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 10, lastAccessed: Date.now() };

      const node = new LRUNode("key", entry1);
      expect(node.entry).toBe(entry1);

      node.entry = entry2;
      expect(node.entry).toBe(entry2);
      expect(node.entry.value).toBe("value2");
      expect(node.entry.size).toBe(10);
    });

    it("should support different value types", () => {
      const stringNode = new LRUNode("key1", {
        value: "string",
        size: 6,
        lastAccessed: Date.now(),
      });
      const numberNode = new LRUNode("key2", {
        value: 42,
        size: 8,
        lastAccessed: Date.now(),
      });
      const objectNode = new LRUNode("key3", {
        value: { foo: "bar" },
        size: 20,
        lastAccessed: Date.now(),
      });

      expect(stringNode.entry.value).toBe("string");
      expect(numberNode.entry.value).toBe(42);
      expect(objectNode.entry.value).toEqual({ foo: "bar" });
    });

    it("should support entry with expiry", () => {
      const expiry = Date.now() + 5000;
      const entry: LRUEntry<string> = {
        value: "test",
        size: 4,
        lastAccessed: Date.now(),
        expiry,
      };
      const node = new LRUNode("key", entry);

      expect(node.entry.expiry).toBe(expiry);
    });

    it("should support entry with tags", () => {
      const entry: LRUEntry<string> = {
        value: "test",
        size: 4,
        lastAccessed: Date.now(),
        tags: ["tag1", "tag2"],
      };
      const node = new LRUNode("key", entry);

      expect(node.entry.tags).toEqual(["tag1", "tag2"]);
    });

    it("should create doubly linked list structure", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };
      const entry3: LRUEntry<string> = { value: "value3", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2);
      const node3 = new LRUNode("key3", entry3);

      node1.next = node2;
      node2.prev = node1;
      node2.next = node3;
      node3.prev = node2;

      expect(node1.next).toBe(node2);
      expect(node2.prev).toBe(node1);
      expect(node2.next).toBe(node3);
      expect(node3.prev).toBe(node2);
    });

    it("should allow traversing list forward", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };
      const entry3: LRUEntry<string> = { value: "value3", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2);
      const node3 = new LRUNode("key3", entry3);

      node1.next = node2;
      node2.next = node3;

      const keys: string[] = [];
      let current: LRUNode<string> | null = node1;
      while (current) {
        keys.push(current.key);
        current = current.next;
      }

      expect(keys).toEqual(["key1", "key2", "key3"]);
    });

    it("should allow traversing list backward", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };
      const entry3: LRUEntry<string> = { value: "value3", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2);
      const node3 = new LRUNode("key3", entry3);

      node3.prev = node2;
      node2.prev = node1;

      const keys: string[] = [];
      let current: LRUNode<string> | null = node3;
      while (current) {
        keys.push(current.key);
        current = current.prev;
      }

      expect(keys).toEqual(["key3", "key2", "key1"]);
    });

    it("should handle removal from middle of list", () => {
      const entry1: LRUEntry<string> = { value: "value1", size: 5, lastAccessed: Date.now() };
      const entry2: LRUEntry<string> = { value: "value2", size: 5, lastAccessed: Date.now() };
      const entry3: LRUEntry<string> = { value: "value3", size: 5, lastAccessed: Date.now() };

      const node1 = new LRUNode("key1", entry1);
      const node2 = new LRUNode("key2", entry2);
      const node3 = new LRUNode("key3", entry3);

      node1.next = node2;
      node2.prev = node1;
      node2.next = node3;
      node3.prev = node2;

      if (node2.prev) node2.prev.next = node2.next;
      if (node2.next) node2.next.prev = node2.prev;

      expect(node1.next).toBe(node3);
      expect(node3.prev).toBe(node1);
    });
  });
});
