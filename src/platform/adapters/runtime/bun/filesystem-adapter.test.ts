import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { isNativeFileSystemAdapter } from "../../native-file-system-provenance.ts";
import type { BunFile } from "./types.ts";
import { BunFileSystemAdapter, type BunFileSystemRuntime } from "./filesystem-adapter.ts";

function runtimeFor(file: BunFile): {
  runtime: BunFileSystemRuntime;
  writes: Array<[string, string | Uint8Array]>;
} {
  const writes: Array<[string, string | Uint8Array]> = [];
  return {
    runtime: {
      file: () => file,
      write: (path, content) => {
        writes.push([path, content]);
        return Promise.resolve(content.length);
      },
    },
    writes,
  };
}

describe("BunFileSystemAdapter", () => {
  it("constructs exact snapshot and exclusive-create capabilities independently", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-bun-snapshot-factory-" });
    const fake = runtimeFor({
      size: 0,
      exists: () => Promise.resolve(true),
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    try {
      const empty = join(root, "empty.bin");
      const exact = join(root, "exact.bin");
      const oversized = join(root, "oversized.bin");
      const directory = join(root, "directory");
      const link = join(root, "link.bin");
      await Deno.writeFile(empty, new Uint8Array());
      await Deno.writeFile(exact, new Uint8Array([1, 2, 3]));
      await Deno.writeFile(oversized, new Uint8Array([1, 2, 3, 4]));
      await Deno.mkdir(directory);
      await Deno.symlink(exact, link);
      const adapter = new BunFileSystemAdapter(fake.runtime);

      assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), true);
      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
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
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("requires O_NOFOLLOW on POSIX and omits unproven Windows snapshot authority", () => {
    const fake = runtimeFor({
      size: 0,
      exists: () => Promise.resolve(true),
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    const TestableAdapter = BunFileSystemAdapter as unknown as new (
      runtime: BunFileSystemRuntime,
      options: { noFollow?: number; platform?: "posix" | "windows" },
    ) => BunFileSystemAdapter;
    for (const noFollow of [undefined, 0]) {
      const adapter = new TestableAdapter(fake.runtime, { noFollow, platform: "posix" });
      assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
    }
    const windowsAdapter = new TestableAdapter(fake.runtime, {
      noFollow: 1,
      platform: "windows",
    });
    assertEquals(Object.hasOwn(windowsAdapter, "readFileSnapshotWithinLimit"), false);
  });

  it("marks only direct built-in instances as native", () => {
    class DerivedAdapter extends BunFileSystemAdapter {}
    const fake = runtimeFor({
      size: 0,
      exists: () => Promise.resolve(true),
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    assertEquals(
      isNativeFileSystemAdapter(new BunFileSystemAdapter(fake.runtime)),
      true,
    );
    assertEquals(
      isNativeFileSystemAdapter(new DerivedAdapter(fake.runtime)),
      false,
    );
  });

  it("refuses a subclass that hides its own prototype.constructor", () => {
    class ConstructorDeletingAdapter extends BunFileSystemAdapter {}
    Reflect.deleteProperty(ConstructorDeletingAdapter.prototype, "constructor");

    class ConstructorSpoofingAdapter extends BunFileSystemAdapter {}
    Object.defineProperty(ConstructorSpoofingAdapter.prototype, "constructor", {
      configurable: true,
      value: BunFileSystemAdapter,
    });

    const fake = runtimeFor({
      size: 0,
      exists: () => Promise.resolve(true),
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    assertEquals(
      isNativeFileSystemAdapter(new ConstructorDeletingAdapter(fake.runtime)),
      false,
    );
    assertEquals(
      isNativeFileSystemAdapter(new ConstructorSpoofingAdapter(fake.runtime)),
      false,
    );
  });

  it("uses Bun-native text and byte reads plus writes", async () => {
    let bytesCalls = 0;
    const fake = runtimeFor({
      size: 3,
      exists: () => Promise.resolve(true),
      text: () => Promise.resolve("abc"),
      arrayBuffer: () => Promise.resolve(new Uint8Array([9]).buffer),
      bytes: () => {
        bytesCalls++;
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    });
    const adapter = new BunFileSystemAdapter(fake.runtime);

    assertEquals(await adapter.readFile("/file.txt"), "abc");
    assertEquals([...await adapter.readFileBytes("/file.bin")], [1, 2, 3]);
    assertEquals(bytesCalls, 1);
    await adapter.writeFile("/output.txt", "value");
    const outputBytes = new Uint8Array([0, 255, 1]);
    await adapter.writeFileBytes("/output.bin", outputBytes);
    assertEquals(fake.writes, [
      ["/output.txt", "value"],
      ["/output.bin", outputBytes],
    ]);
  });

  it("falls back to the Blob-compatible arrayBuffer method", async () => {
    const fake = runtimeFor({
      size: 2,
      exists: () => Promise.resolve(true),
      text: () => Promise.resolve("ok"),
      arrayBuffer: () => Promise.resolve(new Uint8Array([4, 5]).buffer),
    });

    assertEquals(
      [...await new BunFileSystemAdapter(fake.runtime).readFileBytes("/file.bin")],
      [4, 5],
    );
  });

  it("fails clearly when Bun-native content methods are used outside Bun", async () => {
    const adapter = new BunFileSystemAdapter(null);

    await assertRejects(
      () => adapter.readFile("/file.txt"),
      Error,
      "only be used in the Bun runtime",
    );
    await assertRejects(
      () => adapter.writeFile("/file.txt", "value"),
      Error,
      "only be used in the Bun runtime",
    );
    await assertRejects(
      () => adapter.writeFileBytes("/file.bin", new Uint8Array([1])),
      Error,
      "only be used in the Bun runtime",
    );
  });
});
