import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EntryManager } from "./entry-manager.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { LRUNode } from "./lru-node.ts";

function createEntryManager(): EntryManager {
  return new EntryManager(() => 100); // Fixed size estimate
}

function createListAndStore(): {
  list: LRUListManager<unknown>;
  store: Map<string, LRUNode<unknown>>;
} {
  return {
    list: new LRUListManager<unknown>(),
    store: new Map<string, LRUNode<unknown>>(),
  };
}

describe("EntryManager", () => {
  describe("createNewEntry", () => {
    it("should create a node and add to store and list", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();

      const [node, size] = em.createNewEntry(
        "key1",
        "value1",
        undefined,
        undefined,
        undefined,
        list,
        store,
      );

      assertEquals(node.key, "key1");
      assertEquals(node.entry.value, "value1");
      assertEquals(size, 100);
      assertEquals(store.has("key1"), true);
      assertEquals(list.getHead(), node);
    });

    it("should set expiry from explicit TTL", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();
      const before = Date.now();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        5000,
        undefined,
        undefined,
        list,
        store,
      );

      assertEquals(typeof node.entry.expiry, "number");
      assertEquals(node.entry.expiry! >= before + 5000, true);
    });

    it("should set expiry from default TTL when no explicit TTL", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();
      const before = Date.now();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        undefined,
        undefined,
        3000,
        list,
        store,
      );

      assertEquals(typeof node.entry.expiry, "number");
      assertEquals(node.entry.expiry! >= before + 3000, true);
    });

    it("should not set expiry when neither TTL is provided", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        undefined,
        undefined,
        undefined,
        list,
        store,
      );

      assertEquals(node.entry.expiry, undefined);
    });

    it("should store tags on entry", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        undefined,
        ["tag-a", "tag-b"],
        undefined,
        list,
        store,
      );

      assertEquals(node.entry.tags, ["tag-a", "tag-b"]);
    });
  });

  describe("updateTagIndex", () => {
    it("should add key to tag index", () => {
      const em = createEntryManager();
      const tagIndex = new Map<string, Set<string>>();

      em.updateTagIndex(["tag1", "tag2"], "key1", tagIndex);

      assertEquals(tagIndex.get("tag1")?.has("key1"), true);
      assertEquals(tagIndex.get("tag2")?.has("key1"), true);
    });

    it("should add multiple keys to same tag", () => {
      const em = createEntryManager();
      const tagIndex = new Map<string, Set<string>>();

      em.updateTagIndex(["tag1"], "key1", tagIndex);
      em.updateTagIndex(["tag1"], "key2", tagIndex);

      assertEquals(tagIndex.get("tag1")?.size, 2);
    });
  });

  describe("cleanupTags", () => {
    it("should remove key from tag sets", () => {
      const em = createEntryManager();
      const tagIndex = new Map<string, Set<string>>();
      tagIndex.set("tag1", new Set(["key1", "key2"]));

      em.cleanupTags(["tag1"], "key1", tagIndex);

      assertEquals(tagIndex.get("tag1")?.has("key1"), false);
      assertEquals(tagIndex.get("tag1")?.has("key2"), true);
    });

    it("should delete tag from index when last key removed", () => {
      const em = createEntryManager();
      const tagIndex = new Map<string, Set<string>>();
      tagIndex.set("tag1", new Set(["key1"]));

      em.cleanupTags(["tag1"], "key1", tagIndex);

      assertEquals(tagIndex.has("tag1"), false);
    });

    it("should handle missing tags gracefully", () => {
      const em = createEntryManager();
      const tagIndex = new Map<string, Set<string>>();

      em.cleanupTags(["nonexistent"], "key1", tagIndex);
    });
  });

  describe("updateExistingEntry", () => {
    it("should update value and return size delta", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();
      const tagIndex = new Map<string, Set<string>>();

      const [node] = em.createNewEntry(
        "key1",
        "old-value",
        undefined,
        undefined,
        undefined,
        list,
        store,
      );

      const delta = em.updateExistingEntry(
        node,
        "new-value",
        undefined,
        undefined,
        undefined,
        list,
        tagIndex,
        "key1",
      );

      assertEquals(node.entry.value, "new-value");
      assertEquals(delta, 0);
    });

    it("should cleanup old tags on update", () => {
      const em = createEntryManager();
      const { list, store } = createListAndStore();
      const tagIndex = new Map<string, Set<string>>();

      const [node] = em.createNewEntry(
        "key1",
        "val",
        undefined,
        ["old-tag"],
        undefined,
        list,
        store,
      );
      em.updateTagIndex(["old-tag"], "key1", tagIndex);

      em.updateExistingEntry(
        node,
        "new-val",
        undefined,
        ["new-tag"],
        undefined,
        list,
        tagIndex,
        "key1",
      );

      assertEquals(tagIndex.has("old-tag"), false);
      assertEquals(node.entry.tags, ["new-tag"]);
    });
  });
});
