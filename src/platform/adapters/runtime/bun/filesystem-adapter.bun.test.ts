import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";
import { getBunRuntime } from "./types.ts";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("BunFileSystemAdapter native integration", () => {
  it("reads, writes, and watches through the real Bun runtime", async () => {
    if (!getBunRuntime()) return;
    const root = await mkdtemp(join(tmpdir(), "veryfront-bun-fs-"));
    const adapter = new BunFileSystemAdapter();
    let watcher: ReturnType<BunFileSystemAdapter["watch"]> | undefined;

    try {
      const file = join(root, "file.txt");
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

      if (typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0) {
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
      const eventPromise = watcher[Symbol.asyncIterator]().next();
      assertExists(watcher.ready);
      await watcher.ready;
      await adapter.writeFile(file, "updated");
      const event = await Promise.race([
        eventPromise,
        delay(3_000).then(() => {
          throw new Error("Bun filesystem watcher integration timed out");
        }),
      ]);
      assertEquals(event.done, false);
      assertEquals(
        event.value?.paths.some((path: string) => path.endsWith("file.txt")),
        true,
      );

      watcher.close();
      assertExists(watcher.done);
      await watcher.done;
    } finally {
      watcher?.close();
      await watcher?.done;
      await rm(root, { recursive: true, force: true });
    }
  });
});
