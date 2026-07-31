import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNativeFileSystemAdapter } from "../../native-file-system-provenance.ts";
import { NodeCompatibleFileSystemAdapter } from "./node-filesystem-adapter.ts";
import { setupNodeFsWatcher } from "./shared-watcher.ts";

describe("NodeCompatibleFileSystemAdapter", () => {
  it("marks only direct built-in instances as native", () => {
    class DerivedAdapter extends NodeCompatibleFileSystemAdapter {}

    assertEquals(
      isNativeFileSystemAdapter(new NodeCompatibleFileSystemAdapter()),
      true,
    );
    assertEquals(isNativeFileSystemAdapter(new DerivedAdapter()), false);
  });

  it("does not disguise invalid paths as missing", async () => {
    const adapter = new NodeCompatibleFileSystemAdapter();
    await assertRejects(() => adapter.exists("\0"), TypeError);
  });

  it("provides consistent text, byte, metadata, and symlink operations", async () => {
    const root = await Deno.makeTempDir({ prefix: "veryfront-node-fs-" });
    try {
      const adapter = new NodeCompatibleFileSystemAdapter();
      assertEquals(isNativeFileSystemAdapter(adapter), true);
      const file = `${root}/file.txt`;
      const largeFile = `${root}/large.bin`;
      const writtenBinaryFile = `${root}/written.bin`;
      const link = `${root}/file-link.txt`;

      await adapter.writeFile(file, "hello");
      const largeBytes = new Uint8Array(70_000);
      for (let index = 0; index < largeBytes.byteLength; index++) {
        largeBytes[index] = index % 251;
      }
      await Deno.writeFile(largeFile, largeBytes);
      const writtenBytes = new Uint8Array([0, 255, 1, 128]);
      await adapter.writeFileBytes(writtenBinaryFile, writtenBytes);
      await Deno.symlink(file, link);

      assertEquals(await adapter.readFile(file), "hello");
      assertEquals([...await adapter.readFileBytes(file)], [104, 101, 108, 108, 111]);
      assertEquals([...await adapter.readFileBytes(writtenBinaryFile)], [...writtenBytes]);
      assertEquals(
        [...await adapter.readFileBytesBounded(file, 3)],
        [104, 101, 108],
      );
      assertEquals(
        [...await adapter.readFileBytesBounded(file, 8)],
        [104, 101, 108, 108, 111],
      );
      await assertRejects(
        () => adapter.readFileBytesBounded(file, 0),
        RangeError,
        "positive safe integer",
      );
      const largePrefix = await adapter.readFileBytesBounded(largeFile, 65_537);
      assertEquals(largePrefix.byteLength, 65_537);
      assertEquals(largePrefix[65_536], largeBytes[65_536]);
      assertEquals(
        [...await adapter.readFileBytesWithinLimit(file, 5)],
        [104, 101, 108, 108, 111],
      );
      await assertRejects(
        () => adapter.readFileBytesWithinLimit(file, 4),
        RangeError,
        "exceeds byte limit of 4 bytes",
      );
      await assertRejects(
        () => adapter.readFileBytesWithinLimit(file, 0),
        RangeError,
        "positive safe integer",
      );
      assertEquals((await adapter.stat(link)).isSymlink, false);
      assertEquals((await adapter.lstat(link)).isSymlink, true);
      assertEquals(await adapter.realPath(link), await Deno.realPath(file));
      assertEquals(await adapter.exists(file), true);
      assertEquals(await adapter.exists(`${root}/missing.txt`), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("closes watcher resources when iteration returns", async () => {
    const root = await Deno.makeTempDir({ prefix: "veryfront-node-watch-" });
    try {
      const watcher = new NodeCompatibleFileSystemAdapter().watch(root, {
        recursive: false,
      });
      assertExists(watcher.ready);
      await watcher.ready;
      assertExists(watcher.done);
      let done = false;
      void watcher.done.then(() => {
        done = true;
      });
      await Promise.resolve();
      assertEquals(done, false);

      const result = await watcher[Symbol.asyncIterator]().return?.();
      assertEquals(result?.done, true);
      await watcher.done;
      assertEquals(done, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("settles watcher shutdown when the caller aborts", async () => {
    const root = await Deno.makeTempDir({ prefix: "veryfront-node-watch-abort-" });
    try {
      const controller = new AbortController();
      const watcher = new NodeCompatibleFileSystemAdapter().watch(root, {
        recursive: true,
        signal: controller.signal,
      });
      controller.abort();

      assertExists(watcher.ready);
      await watcher.ready;
      assertExists(watcher.done);
      await watcher.done;
      assertEquals((await watcher[Symbol.asyncIterator]().next()).done, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects watcher readiness when the requested root cannot be acquired", async () => {
    const root = await Deno.makeTempDir({ prefix: "veryfront-node-watch-missing-" });
    const missingRoot = `${root}/missing`;
    const watcher = new NodeCompatibleFileSystemAdapter().watch(missingRoot, {
      recursive: true,
    });

    try {
      assertExists(watcher.ready);
      await assertRejects(() => watcher.ready!, Error);
    } finally {
      watcher.close();
      await watcher.done?.catch(() => undefined);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rejects completion with every native watcher teardown failure", async () => {
    const firstFailure = new Error("first close failed");
    const secondFailure = new Error("second close failed");
    let firstCloseCalls = 0;
    let secondCloseCalls = 0;

    class CloseFailingAdapter extends NodeCompatibleFileSystemAdapter {
      protected override setupWatcher(
        _path: string,
        options: Parameters<typeof setupNodeFsWatcher>[1],
      ): Promise<void> {
        options.watchers.push(
          {
            close() {
              firstCloseCalls++;
              throw firstFailure;
            },
          } as unknown as import("node:fs").FSWatcher,
          {
            close() {
              secondCloseCalls++;
              throw secondFailure;
            },
          } as unknown as import("node:fs").FSWatcher,
        );
        return Promise.resolve();
      }
    }

    const watcher = new CloseFailingAdapter().watch("/virtual-watch-root", {
      recursive: false,
    });
    await watcher.ready;
    watcher.close();

    const error = await assertRejects(
      () => watcher.done!,
      AggregateError,
      "did not complete cleanly",
    ) as AggregateError;
    assertEquals(error.errors, [firstFailure, secondFailure]);
    // cleanup attempts teardown immediately and done retries resources that
    // did not close, while retaining the original failures for the caller.
    assertEquals([firstCloseCalls, secondCloseCalls], [2, 2]);
  });

  it("does not finish while a sibling watch root is still being acquired", async () => {
    const acquisitionFailure = new Error("first root failed");
    const siblingSetup = Promise.withResolvers<void>();

    class PartiallyFailingAdapter extends NodeCompatibleFileSystemAdapter {
      protected override setupWatcher(path: string): Promise<void> {
        return path === "/failed-root" ? Promise.reject(acquisitionFailure) : siblingSetup.promise;
      }
    }

    const watcher = new PartiallyFailingAdapter().watch(
      ["/failed-root", "/gated-root"],
      { recursive: false },
    );
    let doneSettled = false;
    const done = watcher.done!.finally(() => {
      doneSettled = true;
    });
    void done.catch(() => undefined);

    await assertRejects(() => watcher.ready!, Error, acquisitionFailure.message);
    await Promise.resolve();
    assertEquals(doneSettled, false);

    siblingSetup.resolve();
    await assertRejects(() => done, Error, acquisitionFailure.message);
    assertEquals(doneSettled, true);
  });
});
