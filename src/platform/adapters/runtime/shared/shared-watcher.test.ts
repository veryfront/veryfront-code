import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createFileWatcher,
  createWatcherIterator,
  enqueueWatchEvent,
  setupNodeFsWatcher,
} from "./shared-watcher.ts";

describe("shared-watcher", () => {
  describe("setupNodeFsWatcher", () => {
    it("should export setupNodeFsWatcher function", () => {
      assertExists(setupNodeFsWatcher);
      assertEquals(typeof setupNodeFsWatcher, "function");
    });
  });

  describe("createWatcherIterator", () => {
    it("should export createWatcherIterator function", () => {
      assertExists(createWatcherIterator);
      assertEquals(typeof createWatcherIterator, "function");
    });

    it("should create an async iterator", () => {
      const eventQueue: any[] = [];
      const iterator = createWatcherIterator(
        eventQueue,
        () => {},
        () => false,
        () => false,
      );

      assertExists(iterator);
      assertExists(iterator.next);
      assertEquals(typeof iterator.next, "function");
    });

    it("should return done when closed", async () => {
      const iterator = createWatcherIterator(
        [],
        () => {},
        () => true,
        () => false,
      );

      const result = await iterator.next();
      assertEquals(result.done, true);
    });

    it("should return events from queue", async () => {
      const event = { kind: "modify" as const, paths: ["/test/file.ts"] };
      const iterator = createWatcherIterator(
        [event],
        () => {},
        () => false,
        () => false,
      );

      const result = await iterator.next();
      assertEquals(result.done, false);
      assertEquals(result.value, event);
    });
  });

  describe("enqueueWatchEvent", () => {
    it("should export enqueueWatchEvent function", () => {
      assertExists(enqueueWatchEvent);
      assertEquals(typeof enqueueWatchEvent, "function");
    });

    it("should add event to queue when no resolver", () => {
      const eventQueue: any[] = [];
      const event = { kind: "modify" as const, paths: ["/test/file.ts"] };

      enqueueWatchEvent(event, eventQueue, () => null, () => {});

      assertEquals(eventQueue.length, 1);
      assertEquals(eventQueue[0], event);
    });

    it("should resolve immediately when resolver exists", () => {
      const eventQueue: any[] = [];
      const event = { kind: "modify" as const, paths: ["/test/file.ts"] };
      let resolvedValue: any = null;
      let resolverCleared = false;

      enqueueWatchEvent(
        event,
        eventQueue,
        () => (result: any) => {
          resolvedValue = result;
        },
        () => {
          resolverCleared = true;
        },
      );

      assertEquals(eventQueue.length, 0);
      assertEquals(resolvedValue?.value, event);
      assertEquals(resolverCleared, true);
    });
  });

  describe("createFileWatcher", () => {
    it("should export createFileWatcher function", () => {
      assertExists(createFileWatcher);
      assertEquals(typeof createFileWatcher, "function");
    });

    it("should create a FileWatcher with async iterator", () => {
      const mockIterator: AsyncIterator<any> = {
        next: () => Promise.resolve({ done: true as const, value: undefined }),
        return: () => Promise.resolve({ done: true as const, value: undefined }),
      };
      let cleanupCalled = false;

      const watcher = createFileWatcher(mockIterator, () => {
        cleanupCalled = true;
      });

      assertExists(watcher);
      assertExists(watcher[Symbol.asyncIterator]);
      assertExists(watcher.close);

      watcher.close();
      assertEquals(cleanupCalled, true);
    });
  });
});
