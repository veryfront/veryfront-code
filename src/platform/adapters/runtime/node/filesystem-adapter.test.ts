import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";

describe("NodeFileSystemAdapter", () => {
  it("returns false only for paths that are absent", async () => {
    const adapter = new NodeFileSystemAdapter();
    assertEquals(await adapter.exists("/definitely-missing/veryfront-file"), false);
    await assertRejects(() => adapter.exists("\0"), TypeError);
  });

  it("does not silently accept removal of an absent path", async () => {
    const adapter = new NodeFileSystemAdapter();
    await assertRejects(() => adapter.remove("/definitely-missing/veryfront-file"));
  });

  it("validates watcher paths synchronously", () => {
    const adapter = new NodeFileSystemAdapter();
    try {
      adapter.watch([]);
      throw new Error("Expected watch to reject an empty path set");
    } catch (error) {
      assertEquals(error instanceof TypeError, true);
    }
  });

  it("fully settles when closed during asynchronous setup", async () => {
    const adapter = new NodeFileSystemAdapter();
    const directory = await Deno.makeTempDir({ prefix: "vf-node-watch-" });

    try {
      const watcher = adapter.watch(directory, { recursive: false });
      assertExists(watcher.done);
      watcher.close();
      await watcher.done;
      assertEquals((await watcher[Symbol.asyncIterator]().next()).done, true);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("settles immediately when its signal is already aborted", async () => {
    const adapter = new NodeFileSystemAdapter();
    const controller = new AbortController();
    controller.abort();

    const watcher = adapter.watch(".", { recursive: false, signal: controller.signal });
    assertExists(watcher.done);
    await watcher.done;
    assertEquals((await watcher[Symbol.asyncIterator]().next()).done, true);
  });
});
