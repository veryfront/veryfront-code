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
import { isNativeFileSystemAdapter } from "../../native-file-system-provenance.ts";
import { DenoFileSystemAdapter } from "./filesystem-adapter.ts";

if (isDeno) {
  describe("Deno filesystem adapter", () => {
    it("constructs exact snapshot and exclusive-create capabilities independently", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-deno-snapshot-factory-" });
      try {
        const empty = join(root, "empty.bin");
        const exact = join(root, "exact.bin");
        const oversized = join(root, "oversized.bin");
        const directory = join(root, "directory");
        const link = join(root, "link.bin");
        const created = join(root, "created.bin");
        await Deno.writeFile(empty, new Uint8Array());
        await Deno.writeFile(exact, new Uint8Array([1, 2, 3]));
        await Deno.writeFile(oversized, new Uint8Array([1, 2, 3, 4]));
        await Deno.mkdir(directory);
        await Deno.symlink(exact, link);
        const adapter = new DenoFileSystemAdapter();

        assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
        assertExists(adapter.createFileBytesExclusive);
        if (Deno.build.os === "windows") {
          assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
          assertEquals(adapter.readFileSnapshotWithinLimit, undefined);
        } else {
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
        await adapter.createFileBytesExclusive(created, new Uint8Array([0, 255]));
        assertEquals([...await Deno.readFile(created)], [0, 255]);
        await assertRejects(
          () => adapter.createFileBytesExclusive!(exact, new Uint8Array([9])),
          Deno.errors.AlreadyExists,
        );
        assertEquals([...await Deno.readFile(exact)], [1, 2, 3]);
        await assertRejects(
          () => adapter.createFileBytesExclusive!(directory, new Uint8Array([9])),
          Deno.errors.AlreadyExists,
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("requires O_NOFOLLOW on POSIX and omits lossy Windows snapshot authority", () => {
      const TestableAdapter = DenoFileSystemAdapter as unknown as new (
        options: { noFollow?: number; platform?: "posix" | "windows" },
      ) => DenoFileSystemAdapter;
      for (const noFollow of [undefined, 0]) {
        const adapter = new TestableAdapter({ noFollow, platform: "posix" });
        assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
        assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
      }
      const windowsAdapter = new TestableAdapter({ noFollow: 1, platform: "windows" });
      assertEquals(Object.hasOwn(windowsAdapter, "readFileSnapshotWithinLimit"), false);
    });

    it("omits createNew independently when that primitive is unavailable", () => {
      const TestableAdapter = DenoFileSystemAdapter as unknown as new (
        options: Record<string, unknown>,
      ) => DenoFileSystemAdapter;
      const adapter = new TestableAdapter({ noFollow: 1, denoCreateRuntime: null });
      assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), false);
    });

    it("closes but does not delete a createNew reservation after a partial write failure", async () => {
      const failure = new Error("injected Deno write failure");
      let writes = 0;
      let closes = 0;
      const root = await Deno.makeTempDir({ prefix: "vf-deno-reserved-" });
      const reserved = join(root, "reserved.bin");
      const TestableAdapter = DenoFileSystemAdapter as unknown as new (
        options: Record<string, unknown>,
      ) => DenoFileSystemAdapter;
      const adapter = new TestableAdapter({
        denoCreateRuntime: {
          open: async (path: string, options: { write: true; createNew: true }) => {
            const file = await Deno.open(path, options);
            return {
              write: () => writes++ === 0 ? Promise.resolve(1) : Promise.reject(failure),
              close: () => {
                closes++;
                file.close();
              },
            };
          },
        },
      });

      try {
        const error = await assertRejects(
          () => adapter.createFileBytesExclusive!(reserved, new Uint8Array([1, 2])),
          Error,
        );
        assertEquals(error, failure);
        assertEquals(writes, 2);
        assertEquals(closes, 1);
        assertEquals(
          (await Deno.lstat(reserved)).isFile,
          true,
          "a partial write failure must leave the createNew reservation on disk",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("preserves createNew write and handle cleanup failures", async () => {
      const writeFailure = new Error("injected Deno write failure");
      const closeFailure = new Error("Deno createNew handle close failed");
      let closeCalls = 0;
      const TestableAdapter = DenoFileSystemAdapter as unknown as new (
        options: Record<string, unknown>,
      ) => DenoFileSystemAdapter;
      const adapter = new TestableAdapter({
        denoCreateRuntime: {
          open: () =>
            Promise.resolve({
              write: () => Promise.reject(writeFailure),
              close: () => {
                closeCalls++;
                throw closeFailure;
              },
            }),
        },
      });

      const error = await assertRejects(
        () => adapter.createFileBytesExclusive!("/reserved.bin", new Uint8Array([1])),
        AggregateError,
      ) as AggregateError;
      assertEquals(error.errors, [writeFailure, closeFailure]);
      assertEquals(closeCalls, 1);
    });

    it("marks only direct built-in instances as native", () => {
      class DerivedAdapter extends DenoFileSystemAdapter {}

      assertEquals(
        isNativeFileSystemAdapter(new DenoFileSystemAdapter()),
        true,
      );
      assertEquals(isNativeFileSystemAdapter(new DerivedAdapter()), false);
    });

    it("refuses a subclass that hides its own prototype.constructor", () => {
      class ConstructorDeletingAdapter extends DenoFileSystemAdapter {}
      Reflect.deleteProperty(ConstructorDeletingAdapter.prototype, "constructor");

      class ConstructorSpoofingAdapter extends DenoFileSystemAdapter {}
      Object.defineProperty(ConstructorSpoofingAdapter.prototype, "constructor", {
        configurable: true,
        value: DenoFileSystemAdapter,
      });

      assertEquals(
        isNativeFileSystemAdapter(new ConstructorDeletingAdapter()),
        false,
      );
      assertEquals(
        isNativeFileSystemAdapter(new ConstructorSpoofingAdapter()),
        false,
      );
    });

    it("reads a genuinely bounded byte prefix", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-deno-bounded-read-" });
      const path = join(root, "file.txt");
      try {
        await Deno.writeTextFile(path, "hello");
        const adapter = new DenoFileSystemAdapter();

        assertEquals(
          [...await adapter.readFileBytesBounded(path, 3)],
          [104, 101, 108],
        );
        assertEquals(
          [...await adapter.readFileBytesBounded(path, 8)],
          [104, 101, 108, 108, 111],
        );
        await assertRejects(
          () => adapter.readFileBytesBounded(path, 0),
          RangeError,
          "positive safe integer",
        );
        assertEquals(
          [...await adapter.readFileBytesWithinLimit(path, 5)],
          [104, 101, 108, 108, 111],
        );
        await assertRejects(
          () => adapter.readFileBytesWithinLimit(path, 4),
          RangeError,
          "exceeds byte limit of 4 bytes",
        );
        await assertRejects(
          () => adapter.readFileBytesWithinLimit(path, 0),
          RangeError,
          "positive safe integer",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("round-trips binary files without text decoding", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-deno-binary-write-" });
      const path = join(root, "file.bin");
      const bytes = new Uint8Array([0, 255, 1, 128]);
      try {
        const adapter = new DenoFileSystemAdapter();
        await adapter.writeFileBytes(path, bytes);
        assertEquals([...await adapter.readFileBytes(path)], [...bytes]);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

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
        // A native event can win the race with close on busy CI hosts. The
        // contract under test is the concurrent-read rejection; either an
        // already-observed event or the terminal result is valid for `first`.
        await first;
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
