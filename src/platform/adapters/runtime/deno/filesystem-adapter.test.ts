import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { join } from "#veryfront/compat/path";
import { DenoFileSystemAdapter } from "./filesystem-adapter.ts";

if (isDeno) {
  describe("Deno filesystem adapter", () => {
    it("uses the native watcher and surfaces observed paths", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-deno-watch-" });
      const path = join(root, "created.txt");
      const watcher = new DenoFileSystemAdapter().watch(root, {
        recursive: false,
      });
      const iterator = watcher[Symbol.asyncIterator]();
      let timeoutId: number | undefined;

      try {
        assertExists(watcher.ready);
        await watcher.ready;
        const observed = (async () => {
          while (true) {
            const result = await iterator.next();
            if (result.done) throw new Error("Deno watcher closed before observing the file");
            if (result.value.paths.includes(path)) return result.value;
          }
        })();
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Deno filesystem watcher integration timed out")),
            5_000,
          );
        });

        await Deno.writeTextFile(path, "created");
        const event = await Promise.race([observed, timeout]);
        assert(
          event.kind === "create" ||
            event.kind === "modify" ||
            event.kind === "any",
        );
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        watcher.close();
        await watcher.done;
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects a second concurrent iterator read", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-deno-watch-next-" });
      const watcher = new DenoFileSystemAdapter().watch(root);
      const iterator = watcher[Symbol.asyncIterator]();

      try {
        const first = iterator.next();
        await assertRejects(
          () => iterator.next(),
          TypeError,
          "concurrent next()",
        );
        watcher.close();
        assertEquals((await first).done, true);
      } finally {
        watcher.close();
        await watcher.done;
        await Deno.remove(root, { recursive: true });
      }
    });

    it("fails watcher setup when the requested path does not exist", () => {
      assertThrows(
        () =>
          new DenoFileSystemAdapter().watch(
            `/definitely/not-present/veryfront-${crypto.randomUUID()}`,
          ),
        Deno.errors.NotFound,
      );
    });

    it("returns an inert watcher without touching the filesystem when pre-aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const watcher = new DenoFileSystemAdapter().watch(
        `/definitely/not-present/veryfront-${crypto.randomUUID()}`,
        { signal: controller.signal },
      );

      assertEquals((await watcher[Symbol.asyncIterator]().next()).done, true);
      await watcher.ready;
      await watcher.done;
    });
  });
}
