import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileWatcher, createWatcherQueue, normalizeWatchPaths } from "./watcher-queue.ts";
import type { FileChangeEvent } from "../../base.ts";

function makeEvent(kind: FileChangeEvent["kind"], path: string): FileChangeEvent {
  return { kind, paths: [path] };
}

describe("watcher-queue", () => {
  describe("createWatcherQueue", () => {
    it("delivers queued events in order", async () => {
      const queue = createWatcherQueue();
      queue.enqueue(makeEvent("create", "/a.ts"));
      queue.enqueue(makeEvent("modify", "/b.ts"));

      assertEquals((await queue.iterator.next()).value, makeEvent("create", "/a.ts"));
      assertEquals((await queue.iterator.next()).value, makeEvent("modify", "/b.ts"));
    });

    it("supports concurrent next calls without losing a waiter", async () => {
      const queue = createWatcherQueue();
      const firstResult = queue.iterator.next();
      const secondResult = queue.iterator.next();

      queue.enqueue(makeEvent("create", "/first.ts"));
      queue.enqueue(makeEvent("modify", "/second.ts"));

      assertEquals((await firstResult).value, makeEvent("create", "/first.ts"));
      assertEquals((await secondResult).value, makeEvent("modify", "/second.ts"));
    });

    it("resolves every pending reader when closed", async () => {
      const queue = createWatcherQueue();
      const firstResult = queue.iterator.next();
      const secondResult = queue.iterator.next();

      queue.close();

      assertEquals((await firstResult).done, true);
      assertEquals((await secondResult).done, true);
      assertEquals((await queue.iterator.next()).done, true);
    });

    it("ignores events after closure", async () => {
      const queue = createWatcherQueue();
      queue.close();
      queue.enqueue(makeEvent("create", "/ignored.ts"));

      assertEquals((await queue.iterator.next()).done, true);
    });

    it("coalesces overflow into a bounded rescan event", async () => {
      const queue = createWatcherQueue({
        maxBufferedEvents: 2,
        overflowPaths: ["/watched"],
      });
      queue.enqueue(makeEvent("create", "/a.ts"));
      queue.enqueue(makeEvent("modify", "/b.ts"));
      queue.enqueue(makeEvent("delete", "/c.ts"));
      queue.enqueue(makeEvent("create", "/d.ts"));

      assertEquals(await queue.iterator.next(), {
        done: false,
        value: { kind: "any", paths: ["/watched"] },
      });

      queue.enqueue(makeEvent("create", "/after-overflow.ts"));
      assertEquals(
        (await queue.iterator.next()).value,
        makeEvent("create", "/after-overflow.ts"),
      );
      queue.close();
    });
  });

  describe("normalizeWatchPaths", () => {
    it("copies and deduplicates paths", () => {
      const input = ["first", "second", "first"];
      const paths = normalizeWatchPaths(input);
      input[0] = "mutated";

      assertEquals(paths, ["first", "second"]);
    });

    it("rejects an empty path set", () => {
      assertThrows(() => normalizeWatchPaths([]), TypeError, "at least one");
      assertThrows(() => normalizeWatchPaths(""), TypeError, "non-empty");
    });
  });

  describe("createFileWatcher", () => {
    it("closes exactly once when iteration returns", async () => {
      const queue = createWatcherQueue();
      let cleanupCalls = 0;
      const watcher = createFileWatcher(queue.iterator, () => {
        cleanupCalls += 1;
        queue.close();
      });

      const iterator = watcher[Symbol.asyncIterator]();
      assertExists(iterator.return);
      await iterator.return();
      watcher.close();

      assertEquals(cleanupCalls, 1);
    });
  });
});
