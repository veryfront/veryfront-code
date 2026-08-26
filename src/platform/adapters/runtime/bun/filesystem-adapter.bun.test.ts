import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { getBunRuntime } from "./types.ts";

describe("BunFileSystemAdapter native integration", () => {
  it("reads, writes, and watches through the real Bun runtime", async () => {
    // Only the real Bun runtime sets process.versions.bun, and it is independent
    // of the global getBunRuntime() reads, so a detection regression fails here
    // instead of silently turning this file into a no-op.
    const bunVersion = (globalThis as { process?: { versions?: { bun?: string } } })
      .process?.versions?.bun;
    if (bunVersion !== undefined) {
      assertExists(
        getBunRuntime(),
        "getBunRuntime() must detect the Bun namespace when the process reports a Bun version",
      );
    }
    if (!getBunRuntime()) return;
    const root = await mkdtemp(join(tmpdir(), "veryfront-bun-fs-"));
    const adapter = new BunFileSystemAdapter();
    let watcher: ReturnType<BunFileSystemAdapter["watch"]> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const file = join(root, "file.txt");
      const watchedFile = join(root, "watched.txt");
      await adapter.writeFile(file, "hello");
      assertEquals(await adapter.readFile(file), "hello");
      assertEquals((await adapter.readFileBytes(file)).length, 5);
      assertEquals(
        [...await adapter.readFileBytesBounded(file, 3)],
        [104, 101, 108],
      );
      assertEquals(
        [...await adapter.readFileBytesWithinLimit(file, 5)],
        [104, 101, 108, 108, 111],
      );
      await assertRejects(
        () => adapter.readFileBytesWithinLimit(file, 4),
        RangeError,
        "exceeds byte limit of 4 bytes",
      );

      const created = join(root, "created.bin");
      const directory = join(root, "directory");
      await mkdir(directory);
      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
      assertExists(adapter.createFileBytesExclusive);
      await adapter.createFileBytesExclusive(created, new Uint8Array([0, 255, 1]));
      assertEquals([...await readFile(created)], [0, 255, 1]);
      await assertRejects(
        () => adapter.createFileBytesExclusive!(file, new Uint8Array([9])),
        Error,
      );
      assertEquals(await adapter.readFile(file), "hello");
      await assertRejects(
        () => adapter.createFileBytesExclusive!(directory, new Uint8Array([9])),
        Error,
      );

      if (platform() === "win32") {
        // The adapter asserts verified Windows snapshot identity, so the
        // capability must be constructed on Windows instead of omitted.
        assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
      } else if (
        typeof constants.O_NOFOLLOW !== "number" ||
        constants.O_NOFOLLOW === 0
      ) {
        assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
      } else {
        const empty = join(root, "empty.bin");
        const exact = join(root, "exact.bin");
        const oversized = join(root, "oversized.bin");
        const link = join(root, "link.bin");
        await writeFile(empty, new Uint8Array());
        await writeFile(exact, new Uint8Array([1, 2, 3]));
        await writeFile(oversized, new Uint8Array([1, 2, 3, 4]));
        await symlink(exact, link);
        assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
        assertExists(adapter.readFileSnapshotWithinLimit);
        assertEquals([...await adapter.readFileSnapshotWithinLimit(empty, root, 1)], []);
        assertEquals([...await adapter.readFileSnapshotWithinLimit(exact, root, 3)], [1, 2, 3]);
        await assertRejects(
          () => adapter.readFileSnapshotWithinLimit!(oversized, root, 3),
          RangeError,
        );
        for (const limit of [0, Number.MAX_SAFE_INTEGER + 1]) {
          await assertRejects(
            () => adapter.readFileSnapshotWithinLimit!(exact, root, limit),
            RangeError,
          );
        }
        await assertRejects(
          () => adapter.readFileSnapshotWithinLimit!(directory, root, 3),
          TypeError,
        );
        await assertRejects(
          () => adapter.readFileSnapshotWithinLimit!(link, root, 3),
          TypeError,
        );
      }

      watcher = adapter.watch(root, { recursive: false });
      const iterator = watcher[Symbol.asyncIterator]();
      assertExists(watcher.ready);
      await watcher.ready;
      const observed = (async () => {
        while (true) {
          const result = await iterator.next();
          if (result.done) throw new Error("Bun watcher closed before observing the file");
          if (result.value.paths.includes(watchedFile)) {
            return result.value;
          }
        }
      })();
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Bun filesystem watcher integration timed out")),
          5_000,
        );
      });

      await writeFile(watchedFile, "created");
      const event = await Promise.race([observed, timeout]);
      assertEquals(
        event.paths.includes(watchedFile),
        true,
      );

      watcher.close();
      assertExists(watcher.done);
      await watcher.done;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      watcher?.close();
      await watcher?.done;
      await rm(root, { recursive: true, force: true });
    }
  });
});
