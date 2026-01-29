import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent } from "./watcher-queue.ts";
import type { FileChangeEvent } from "../../base.ts";

function makeEvent(kind: FileChangeEvent["kind"], paths: string[]): FileChangeEvent {
  return { kind, paths };
}

describe("watcher-queue", () => {
  describe("createWatcherIterator", () => {
    it("should return an AsyncIterator with next and return methods", () => {
      const iterator = createWatcherIterator([], () => {}, () => false, () => false);
      assertExists(iterator.next);
      assertExists(iterator.return);
    });

    it("should resolve queued events immediately", async () => {
      const queue: FileChangeEvent[] = [makeEvent("create", ["/a.ts"])];
      const iterator = createWatcherIterator(queue, () => {}, () => false, () => false);

      const result = await iterator.next();
      assertEquals(result.done, false);
      assertEquals(result.value, makeEvent("create", ["/a.ts"]));
    });

    it("should drain multiple queued events in order", async () => {
      const queue: FileChangeEvent[] = [
        makeEvent("create", ["/a.ts"]),
        makeEvent("modify", ["/b.ts"]),
      ];
      const iterator = createWatcherIterator(queue, () => {}, () => false, () => false);

      const first = await iterator.next();
      assertEquals(first.value?.paths, ["/a.ts"]);

      const second = await iterator.next();
      assertEquals(second.value?.paths, ["/b.ts"]);
    });

    it("should return done when closed", async () => {
      const iterator = createWatcherIterator([], () => {}, () => true, () => false);

      const result = await iterator.next();
      assertEquals(result.done, true);
    });

    it("should return done when aborted", async () => {
      const iterator = createWatcherIterator([], () => {}, () => false, () => true);

      const result = await iterator.next();
      assertEquals(result.done, true);
    });

    it("should wait for events when queue is empty and not closed", async () => {
      let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;
      const setResolver = (r: ((value: IteratorResult<FileChangeEvent>) => void) | null) => {
        resolver = r;
      };

      const iterator = createWatcherIterator([], setResolver, () => false, () => false);

      const promise = iterator.next();

      // The resolver should have been set
      const resolve = resolver ??
        ((_value: IteratorResult<FileChangeEvent>) => {
          throw new Error("Expected resolver to be set");
        });

      // Resolve it manually
      resolve({ done: false, value: makeEvent("modify", ["/c.ts"]) });

      const result = await promise;
      assertEquals(result.done, false);
      assertEquals(result.value?.paths, ["/c.ts"]);
    });

    it("should return done result from return()", async () => {
      const iterator = createWatcherIterator([], () => {}, () => false, () => false);

      const result = await iterator.return!();
      assertEquals(result.done, true);
      assertEquals(result.value, undefined);
    });
  });

  describe("enqueueWatchEvent", () => {
    it("should push to queue when no resolver is set", () => {
      const queue: FileChangeEvent[] = [];
      const event = makeEvent("create", ["/a.ts"]);

      enqueueWatchEvent(event, queue, () => null, () => {});

      assertEquals(queue.length, 1);
      assertEquals(queue[0], event);
    });

    it("should resolve immediately when resolver exists", () => {
      const queue: FileChangeEvent[] = [];
      let resolvedValue: IteratorResult<FileChangeEvent> | null = null;
      const fakeResolver = (value: IteratorResult<FileChangeEvent>) => {
        resolvedValue = value;
      };
      let currentResolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = fakeResolver;

      const event = makeEvent("modify", ["/b.ts"]);

      enqueueWatchEvent(
        event,
        queue,
        () => currentResolver,
        (r) => {
          currentResolver = r;
        },
      );

      // Should NOT push to queue when resolver exists
      assertEquals(queue.length, 0);
      // Should have resolved
      assertExists(resolvedValue);
      assertEquals((resolvedValue as IteratorResult<FileChangeEvent>).done, false);
      assertEquals((resolvedValue as IteratorResult<FileChangeEvent>).value, event);
      // Should clear the resolver
      assertEquals(currentResolver, null);
    });
  });

  describe("createFileWatcher", () => {
    it("should return an object with asyncIterator and close", () => {
      const iterator = createWatcherIterator([], () => {}, () => false, () => false);
      const watcher = createFileWatcher(iterator, () => {});

      assertExists(watcher[Symbol.asyncIterator]);
      assertExists(watcher.close);
    });

    it("should call cleanup on close", () => {
      let closed = false;
      const iterator = createWatcherIterator([], () => {}, () => false, () => false);
      const watcher = createFileWatcher(iterator, () => {
        closed = true;
      });

      watcher.close();
      assertEquals(closed, true);
    });

    it("should return the iterator from asyncIterator", () => {
      const iterator = createWatcherIterator([], () => {}, () => false, () => false);
      const watcher = createFileWatcher(iterator, () => {});

      const returned = watcher[Symbol.asyncIterator]();
      assertEquals(returned, iterator);
    });
  });
});
