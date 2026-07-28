import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
