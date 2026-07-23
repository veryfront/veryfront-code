import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareFileSystemAdapter } from "./filesystem.ts";
import type {
  KVGetOptions,
  KVGetWithMetadataResult,
  KVListOptions,
  KVListResult,
  KVMetadata,
  KVNamespace,
  KVPutOptions,
  KVValueForType,
  KVValueType,
} from "./types.ts";

interface StoredValue {
  bytes: Uint8Array;
  metadata: KVMetadata | null;
}

class MemoryKV implements KVNamespace {
  readonly values = new Map<string, StoredValue>();
  readonly deleteCalls: string[] = [];
  pageSize = 2;

  get<Type extends KVValueType = "text">(
    key: string,
    typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVValueForType<Type> | null> {
    const stored = this.values.get(key);
    if (!stored) return Promise.resolve(null);
    const type = typeof typeOrOptions === "string" ? typeOrOptions : typeOrOptions?.type ?? "text";
    const value = type === "arrayBuffer"
      ? stored.bytes.buffer.slice(
        stored.bytes.byteOffset,
        stored.bytes.byteOffset + stored.bytes.byteLength,
      )
      : new TextDecoder().decode(stored.bytes);
    return Promise.resolve(value as KVValueForType<Type>);
  }

  put(key: string, value: string | ArrayBuffer, options?: KVPutOptions): Promise<void> {
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value.slice(0));
    this.values.set(key, { bytes, metadata: options?.metadata ?? null });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.values.delete(key);
    return Promise.resolve();
  }

  list(options?: KVListOptions): Promise<KVListResult> {
    const prefix = options?.prefix ?? "";
    const offset = Number(options?.cursor ?? 0);
    const matching = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    const nextOffset = Math.min(offset + this.pageSize, matching.length);
    return Promise.resolve({
      keys: matching.slice(offset, nextOffset).map(([name, stored]) => ({
        name,
        ...(stored.metadata === null ? {} : { metadata: stored.metadata }),
      })),
      list_complete: nextOffset >= matching.length,
      cursor: nextOffset < matching.length ? String(nextOffset) : "",
    });
  }

  async getWithMetadata<Type extends KVValueType = "text">(
    key: string,
    typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVGetWithMetadataResult<KVValueForType<Type>>> {
    const stored = this.values.get(key);
    return {
      value: await this.get(key, typeOrOptions),
      metadata: stored?.metadata ?? null,
    };
  }
}

async function collectNames(adapter: CloudflareFileSystemAdapter, path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of adapter.readDir(path)) names.push(entry.name);
  return names;
}

describe("CloudflareFileSystemAdapter", () => {
  it("preserves binary values byte-for-byte", async () => {
    const kv = new MemoryKV();
    const adapter = new CloudflareFileSystemAdapter(kv);
    await adapter.writeFile("asset.bin", "placeholder");
    const [key, stored] = [...kv.values.entries()][0]!;
    stored.bytes = new Uint8Array([0x00, 0xff, 0x80, 0x01]);
    kv.values.set(key, stored);

    assertEquals(
      await adapter.readFileBytes("asset.bin"),
      new Uint8Array([0x00, 0xff, 0x80, 0x01]),
    );
  });

  it("reports UTF-8 byte size and persists empty directories", async () => {
    const kv = new MemoryKV();
    const adapter = new CloudflareFileSystemAdapter(kv);

    await adapter.writeFile("unicode.txt", "é");
    await adapter.mkdir("empty");

    assertEquals((await adapter.stat("unicode.txt")).size, 2);
    assertEquals(await adapter.stat("empty"), {
      size: 0,
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      mtime: null,
    });
    assertEquals(await collectNames(adapter, "empty"), []);
  });

  it("creates parent directory nodes only when recursive", async () => {
    const kv = new MemoryKV();
    const adapter = new CloudflareFileSystemAdapter(kv);

    await assertRejects(() => adapter.mkdir("one/two"), Error, "Parent directory");
    await adapter.mkdir("one/two", { recursive: true });

    assertEquals((await adapter.stat("one")).isDirectory, true);
    assertEquals((await adapter.stat("one/two")).isDirectory, true);
  });

  it("rejects file and directory type conflicts", async () => {
    const kv = new MemoryKV();
    const adapter = new CloudflareFileSystemAdapter(kv);
    await adapter.mkdir("directory");
    await adapter.writeFile("file.txt", "file");

    await assertRejects(() => adapter.writeFile("directory", "value"), Error, "directory");
    await assertRejects(() => adapter.mkdir("file.txt"), Error, "file");
    await assertRejects(() => collectNames(adapter, "file.txt"), Error, "not a directory");
  });

  it("rejects missing paths instead of treating them as empty directories", async () => {
    const adapter = new CloudflareFileSystemAdapter(new MemoryKV());

    await assertRejects(() => collectNames(adapter, "missing"), Error, "not found");
    await assertRejects(() => adapter.remove("missing"), Error, "not found");
  });

  it("removes individual files without affecting sibling keys", async () => {
    const kv = new MemoryKV();
    const adapter = new CloudflareFileSystemAdapter(kv);
    await adapter.mkdir("directory");
    await adapter.writeFile("directory/remove.txt", "remove");
    await adapter.writeFile("directory/keep.txt", "keep");

    await adapter.remove("directory/remove.txt");

    assertEquals(await adapter.exists("directory/remove.txt"), false);
    assertEquals(await adapter.readFile("directory/keep.txt"), "keep");
    assertEquals(kv.deleteCalls.length, 1);
  });

  it("rejects directory removal before mutating eventually consistent storage", async () => {
    for (const recursive of [false, true]) {
      const kv = new MemoryKV();
      const adapter = new CloudflareFileSystemAdapter(kv);
      await adapter.mkdir("directory");
      await adapter.writeFile("directory/file.txt", "keep");

      await assertRejects(
        () => adapter.remove("directory", { recursive }),
        Error,
        "does not support directory removal",
      );

      assertEquals(await adapter.readFile("directory/file.txt"), "keep");
      assertEquals(kv.deleteCalls, []);
    }
  });

  it("rejects every root or traversal alias before deleting anything", async () => {
    for (const path of ["", "/", "//", ".", "..", "safe/../other"]) {
      const kv = new MemoryKV();
      const adapter = new CloudflareFileSystemAdapter(kv);
      await adapter.writeFile("keep.txt", "keep");

      await assertRejects(() => adapter.remove(path, { recursive: true }), Error);
      assertEquals(await adapter.readFile("keep.txt"), "keep");
      assertEquals(kv.deleteCalls, []);
    }
  });

  it("bounds directory scans before yielding a partial listing", async () => {
    const kv = new MemoryKV();
    const adapter = new CloudflareFileSystemAdapter(kv, { maxListedKeys: 2 });
    await adapter.mkdir("directory");
    await adapter.writeFile("directory/one.txt", "one");
    await adapter.writeFile("directory/two.txt", "two");
    await adapter.writeFile("directory/three.txt", "three");

    await assertRejects(
      () => collectNames(adapter, "directory"),
      Error,
      "directory scan exceeds the configured key limit",
    );
    assertEquals(kv.deleteCalls, []);
  });

  it("validates the configured directory scan bound", () => {
    for (const maxListedKeys of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => new CloudflareFileSystemAdapter(new MemoryKV(), { maxListedKeys }),
        Error,
        "directory scan limit must be a positive integer",
      );
    }
  });

  it("surfaces a missing filesystem binding for every operation", async () => {
    const adapter = new CloudflareFileSystemAdapter();

    await assertRejects(() => adapter.exists("file.txt"), Error, "namespace is required");
    await assertRejects(() => collectNames(adapter, ""), Error, "namespace is required");
    await assertRejects(() => adapter.mkdir("directory"), Error, "namespace is required");
  });
});
