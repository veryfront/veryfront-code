import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EntryManager } from "./entry-manager.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { LRUNode } from "./lru-node.ts";

function createEntryManager(): EntryManager {
  return new EntryManager(() => 100); // Fixed size estimate
}

function createFixedClockEntryManager(): EntryManager {
  return new EntryManager(() => 100, () => 1_000); // Fixed size estimate and clock
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
      const em = createFixedClockEntryManager();
      const { list, store } = createListAndStore();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        5000,
        undefined,
        undefined,
        list,
        store,
      );

      assertEquals(
        node.entry.expiry,
        6_000,
        "explicit ttlMs is added to the injected clock",
      );
    });

    it("should set expiry from default TTL when no explicit TTL", () => {
      const em = createFixedClockEntryManager();
      const { list, store } = createListAndStore();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        undefined,
        undefined,
        3000,
        list,
        store,
      );

      assertEquals(
        node.entry.expiry,
        4_000,
        "defaultTtlMs is used when no explicit ttlMs",
      );
    });

    it("should prefer an explicit TTL over the store default", () => {
      const em = createFixedClockEntryManager();
      const { list, store } = createListAndStore();

      const [node] = em.createNewEntry(
        "key1",
        "value1",
        5000,
        undefined,
        3000,
        list,
        store,
      );

      assertEquals(
        node.entry.expiry,
        6_000,
        "an explicit per-entry TTL wins over the store default",
      );
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
      tagIndex.set("tag1", new Set(["key1", "key2"]));

      em.cleanupTags(["nonexistent", "tag1"], "key1", tagIndex);

      assertEquals(
        tagIndex.get("tag1")?.has("key1"),
        false,
        "a missing earlier tag must not stop later tags from being cleaned",
      );
      assertEquals(
        tagIndex.get("tag1")?.has("key2"),
        true,
        "other keys under the tag must survive",
      );
      assertEquals(
        tagIndex.has("nonexistent"),
        false,
        "a missing tag must not be created by cleanup",
      );
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

    it("should report the signed byte delta when the value size changes", () => {
      const em = new EntryManager((value) => String(value).length);
      const { list, store } = createListAndStore();
      const tagIndex = new Map<string, Set<string>>();

      const [node, size] = em.createNewEntry(
        "key1",
        "abcde",
        undefined,
        undefined,
        undefined,
        list,
        store,
      );

      assertEquals(size, 5, "the initial entry size is the estimated size");

      const grow = em.updateExistingEntry(
        node,
        "abcdefghijkl",
        undefined,
        undefined,
        undefined,
        list,
        tagIndex,
        "key1",
      );

      assertEquals(grow, 7, "growing an entry returns newSize - oldSize");
      assertEquals(
        node.entry.size,
        12,
        "the stored entry size is the new estimate",
      );

      const shrink = em.updateExistingEntry(
        node,
        "abcde",
        undefined,
        undefined,
        undefined,
        list,
        tagIndex,
        "key1",
      );

      assertEquals(shrink, -7, "shrinking an entry returns a negative delta");
      assertEquals(
        node.entry.size,
        5,
        "the stored entry size follows the shrunken estimate",
      );
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
