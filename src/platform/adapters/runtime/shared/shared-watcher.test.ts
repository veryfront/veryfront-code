import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createFileWatcher,
  createWatcherQueue,
  normalizeWatchPaths,
  setupNodeFsWatcher,
} from "./shared-watcher.ts";

describe("shared-watcher", () => {
  describe("setupNodeFsWatcher", () => {
    it("should export setupNodeFsWatcher function", () => {
      assertExists(setupNodeFsWatcher);
      assertEquals(typeof setupNodeFsWatcher, "function");
    });

    it("keeps node:path out of the shared module top level", async () => {
      const source = await Deno.readTextFile(new URL("./shared-watcher.ts", import.meta.url));

      assertEquals(source.includes(`from "node:path"`), false);
      assertEquals(source.includes(`from 'node:path'`), false);
    });

    it("polls recursively when native recursive watching is unavailable", async () => {
      const directory = await Deno.makeTempDir({ prefix: "vf-watch-fallback-" });
      const queue = createWatcherQueue();
      let closed = false;
      const unavailable = Object.assign(new Error("recursive watch unavailable"), {
        code: "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM",
      });

      const setup = setupNodeFsWatcher(directory, {
        recursive: true,
        closed: () => closed,
        signal: undefined,
        queue,
        watchers: [],
        onError: (error) => {
          throw error;
        },
        watch: (() => {
          throw unavailable;
        }) as unknown as typeof import("node:fs").watch,
      });

      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const filePath = `${directory}/created.ts`;
        await Deno.writeTextFile(filePath, "content");
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Watcher fallback did not emit")),
            1_500,
          );
        });
        const result = await Promise.race([queue.iterator.next(), timeout]).finally(() => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        });

        assertEquals(result.done, false);
        assertEquals(result.value?.kind, "create");
        assertEquals(result.value?.paths, [filePath]);
      } finally {
        closed = true;
        queue.close();
        await setup;
        await Deno.remove(directory, { recursive: true });
      }
    });

    it("uses existing files as the polling baseline instead of reporting them as new", async () => {
      const directory = await Deno.makeTempDir({ prefix: "vf-watch-baseline-" });
      const existingPath = `${directory}/existing.ts`;
      await Deno.writeTextFile(existingPath, "existing");
      const queue = createWatcherQueue();
      let closed = false;
      const unavailable = Object.assign(new Error("recursive watch unavailable"), {
        code: "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM",
      });

      const setup = setupNodeFsWatcher(directory, {
        recursive: true,
        closed: () => closed,
        signal: undefined,
        queue,
        watchers: [],
        onError: (error) => {
          throw error;
        },
        watch: (() => {
          throw unavailable;
        }) as unknown as typeof import("node:fs").watch,
      });

      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const createdPath = `${directory}/created.ts`;
        await Deno.writeTextFile(createdPath, "created");

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Watcher fallback did not emit")),
            1_500,
          );
        });
        const result = await Promise.race([queue.iterator.next(), timeout]).finally(() => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        });

        assertEquals(result, {
          done: false,
          value: { kind: "create", paths: [createdPath] },
        });
      } finally {
        closed = true;
        queue.close();
        await setup;
        await Deno.remove(directory, { recursive: true });
      }
    });
  });

  describe("queue helpers", () => {
    it("exports the queue, path normalization, and watcher helpers", () => {
      assertEquals(typeof createWatcherQueue, "function");
      assertEquals(typeof normalizeWatchPaths, "function");
      assertEquals(typeof createFileWatcher, "function");
    });
  });

  describe("createFileWatcher", () => {
    it("should export createFileWatcher function", () => {
      assertExists(createFileWatcher);
      assertEquals(typeof createFileWatcher, "function");
    });

    it("should create a FileWatcher with async iterator", () => {
      const mockIterator: AsyncIterator<never> = {
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
