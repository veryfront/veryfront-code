import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { CloudflareFileSystemAdapter } from "./filesystem.ts";
import type { KVNamespace } from "./types.ts";

async function collectDirectory(
  entries: AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
  }>,
): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
  const result: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
  for await (const entry of entries) {
    result.push({
      name: entry.name,
      isFile: entry.isFile,
      isDirectory: entry.isDirectory,
    });
  }
  return result;
}

function createKVNamespace(initialEntries: Record<string, string>): KVNamespace {
  const entries = new Map<string, string | Uint8Array>(Object.entries(initialEntries));
  return {
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    get(key, type = "text") {
      const value = entries.get(key);
      if (value === undefined) return Promise.resolve(null);
      if (type === "stream") {
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
        return Promise.resolve(new Blob([bytes.slice()]).stream());
      }
      if (type === "arrayBuffer") {
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
        return Promise.resolve(bytes.slice().buffer);
      }
      return Promise.resolve(
        typeof value === "string" ? value : new TextDecoder().decode(value),
      );
    },
    getWithMetadata(key) {
      const value = entries.get(key);
      return Promise.resolve({
        metadata: null,
        value: value === undefined
          ? null
          : typeof value === "string"
          ? value
          : new TextDecoder().decode(value),
      });
    },
    list(options = {}) {
      const prefix = options.prefix ?? "";
      return Promise.resolve({
        keys: [...entries.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      });
    },
    put(key, value) {
      if (typeof value === "string") {
        entries.set(key, value);
      } else if (value instanceof ArrayBuffer) {
        entries.set(key, new Uint8Array(value.slice(0)));
      } else {
        entries.set(
          key,
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
        );
      }
      return Promise.resolve();
    },
  };
}

function createPaginatedKVNamespace(
  pages: ReadonlyMap<
    string,
    { keys: string[]; listComplete: boolean; cursor?: string }
  >,
): { kv: KVNamespace; cursors: Array<string | undefined> } {
  const cursors: Array<string | undefined> = [];
  const kv = createKVNamespace({});
  kv.list = (options = {}) => {
    const cursor = options.cursor;
    cursors.push(cursor);
    const page = pages.get(cursor ?? "") ?? {
      keys: [],
      listComplete: true,
      cursor: "",
    };
    return Promise.resolve({
      keys: page.keys.map((name) => ({ name })),
      list_complete: page.listComplete,
      cursor: page.cursor ?? "",
    });
  };
  return { kv, cursors };
}

describe("CloudflareFileSystemAdapter realPath", () => {
  it("omits generation-bound snapshot authority", () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({}));

    assertEquals("readFileSnapshotWithinLimit" in fs, false);
  });

  it("normalizes an existing KV path without allowing dot-segment ambiguity", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({
      "/project/pages/empty.mdx": "",
      "/project/pages/about.mdx": "# About",
    }));

    assertEquals(
      await fs.realPath("/project/pages/./guides/../about.mdx"),
      "/project/pages/about.mdx",
    );
    assertEquals(await fs.realPath("/project/pages/empty.mdx"), "/project/pages/empty.mdx");
    assertEquals((await fs.stat("/project/pages/empty.mdx")).size, 0);
  });

  it("uses stable canonical representations for relative and absolute roots", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({
      "pages/index.mdx": "# Relative",
      "pages/blog/post.mdx": "# Relative nested",
      "/project/pages/index.mdx": "# Absolute",
      "/project/layouts/main.mdx": "# Absolute layout",
    }));

    assertEquals(await fs.realPath(""), "");
    assertEquals(await fs.realPath("."), "");
    assertEquals(await fs.realPath("/"), "/");
    assertEquals((await fs.stat(".")).isDirectory, true);
    assertEquals((await fs.stat("/")).isDirectory, true);
    assertEquals(await fs.exists(""), true);
    assertEquals(await fs.exists("/"), true);

    assertEquals(await collectDirectory(fs.readDir(".")), [
      { name: "pages", isFile: false, isDirectory: true },
    ]);
    assertEquals(await collectDirectory(fs.readDir("/")), [
      { name: "project", isFile: false, isDirectory: true },
    ]);
    assertEquals(await collectDirectory(fs.readDir("pages")), [
      { name: "blog", isFile: false, isDirectory: true },
      { name: "index.mdx", isFile: true, isDirectory: false },
    ]);
    assertEquals(await collectDirectory(fs.readDir("/project")), [
      { name: "layouts", isFile: false, isDirectory: true },
      { name: "pages", isFile: false, isDirectory: true },
    ]);
  });

  it("does not treat path-prefix collisions as directory children", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({
      "foobar/nested.mdx": "# Not a child of foo",
    }));

    assertEquals(await fs.exists("foo"), false);
    assertEquals(await collectDirectory(fs.readDir("foo")), []);
    await assertRejects(() => fs.stat("foo"), Error, "File not found");
  });

  it("follows KV cursors even when an intermediate page has no visible keys", async () => {
    const { kv, cursors } = createPaginatedKVNamespace(
      new Map([
        ["", { keys: [], listComplete: false, cursor: "page-2" }],
        [
          "page-2",
          {
            keys: ["pages/about.mdx", "pages/guides/start.mdx"],
            listComplete: true,
          },
        ],
      ]),
    );
    const fs = new CloudflareFileSystemAdapter(kv);

    assertEquals(await fs.exists("pages"), true);
    assertEquals(await collectDirectory(fs.readDir("pages")), [
      { name: "about.mdx", isFile: true, isDirectory: false },
      { name: "guides", isFile: false, isDirectory: true },
    ]);
    assertEquals((await fs.stat("pages")).isDirectory, true);
    assertEquals(cursors.includes("page-2"), true);
  });

  it("detects file-directory conflicts that straddle KV pages", async () => {
    const { kv } = createPaginatedKVNamespace(
      new Map([
        [
          "",
          {
            keys: ["pages/conflict"],
            listComplete: false,
            cursor: "page-2",
          },
        ],
        [
          "page-2",
          {
            keys: ["pages/conflict/nested.mdx"],
            listComplete: true,
          },
        ],
      ]),
    );
    const fs = new CloudflareFileSystemAdapter(kv);

    await assertRejects(
      () => collectDirectory(fs.readDir("pages")),
      Error,
      "both a file and a directory",
    );
  });

  it("rejects malformed cursor responses instead of looping or truncating", async () => {
    const { kv } = createPaginatedKVNamespace(
      new Map([
        ["", { keys: [], listComplete: false }],
      ]),
    );
    const fs = new CloudflareFileSystemAdapter(kv);

    await assertRejects(
      () => collectDirectory(fs.readDir("pages")),
      Error,
      "pagination cursor",
    );
  });

  it("rejects duplicate or unsorted list pages instead of emitting ambiguous entries", async () => {
    const { kv } = createPaginatedKVNamespace(
      new Map([
        [
          "",
          {
            keys: ["pages/z.mdx", "pages/a.mdx"],
            listComplete: true,
          },
        ],
      ]),
    );
    const fs = new CloudflareFileSystemAdapter(kv);

    await assertRejects(
      () => collectDirectory(fs.readDir("pages")),
      Error,
      "duplicate or unsorted",
    );
  });

  it("rejects KV keys and values beyond Cloudflare's byte limits", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({}));

    await assertRejects(
      () => fs.writeFile("é".repeat(257), "value"),
      Error,
      "512-byte",
    );
    await assertRejects(
      () => fs.writeFile("oversized.txt", "x".repeat(25 * 1024 * 1024 + 1)),
      Error,
      "25 MiB",
    );
  });

  it("round-trips binary files without text decoding", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({}));
    const bytes = new Uint8Array([0, 255, 1, 128, 2]);

    await fs.writeFileBytes("assets/pixel.bin", bytes);

    assertEquals([...await fs.readFileBytes("assets/pixel.bin")], [...bytes]);
    assertEquals((await fs.stat("assets/pixel.bin")).size, bytes.byteLength);
    assertEquals(fs.maxWholeFileReadBytes, 25 * 1024 * 1024);
    assertEquals("readFileBytesBounded" in fs, false);
  });

  it("reads an admitted file through the KV streaming boundary", async () => {
    const requestedTypes: string[] = [];
    const kv = createKVNamespace({ "components/Card.tsx": "card" });
    const originalGet = kv.get.bind(kv);
    kv.get = (key, type = "text") => {
      requestedTypes.push(type);
      return originalGet(key, type);
    };
    const fs = new CloudflareFileSystemAdapter(kv);

    assertEquals(
      new TextDecoder().decode(
        await fs.readFileBytesWithinLimit("components/Card.tsx", 4),
      ),
      "card",
    );
    assertEquals(requestedTypes, ["stream"]);
  });

  it("rejects a streaming KV value at the first byte beyond the exact limit", async () => {
    let cancelled = false;
    const kv = createKVNamespace({});
    kv.get = (_key, type = "text") => {
      assertEquals(type, "stream");
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3]));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    const fs = new CloudflareFileSystemAdapter(kv);

    await assertRejects(
      () => fs.readFileBytesWithinLimit("components/Card.tsx", 2),
      RangeError,
      "exceeds 2 bytes",
    );
    assertEquals(cancelled, true);
  });

  it("does not silently succeed on mutating operations without a KV binding", async () => {
    const fs = new CloudflareFileSystemAdapter();

    await assertRejects(() => fs.mkdir("pages"), Error, "KV namespace required");
    await assertRejects(() => fs.remove("pages/index.mdx"), Error, "KV namespace required");
  });

  it("rejects file-directory collisions before writing them", async () => {
    const directoryFs = new CloudflareFileSystemAdapter(createKVNamespace({
      "pages/index.mdx": "# Existing child",
    }));
    await assertRejects(
      () => directoryFs.writeFile("pages", "file collision"),
      Error,
      "existing directory",
    );

    const parentFileFs = new CloudflareFileSystemAdapter(createKVNamespace({
      "pages": "existing file",
    }));
    await assertRejects(
      () => parentFileFs.writeFile("pages/index.mdx", "# Child collision"),
      Error,
      "parent path is a file",
    );
  });

  it("fails closed for virtual directory removal instead of reporting false success", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({
      "pages/index.mdx": "# Keep",
    }));

    await assertRejects(
      () => fs.remove("pages", { recursive: true }),
      Error,
      "directory removal",
    );
    assertEquals(await fs.readFile("pages/index.mdx"), "# Keep");
  });

  it("persists empty directory markers and removes an empty directory atomically", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({}));

    await fs.mkdir("project/cache", { recursive: true });

    assertEquals(await fs.exists("project"), true);
    assertEquals(await fs.exists("project/cache"), true);
    assertEquals((await fs.stat("project/cache")).isDirectory, true);
    assertEquals(await collectDirectory(fs.readDir("project/cache")), []);
    assertEquals(await collectDirectory(fs.readDir("project")), [
      { name: "cache", isFile: false, isDirectory: true },
    ]);

    await fs.remove("project/cache");
    assertEquals(await fs.exists("project/cache"), false);
    assertEquals(await fs.exists("project"), true);
  });

  it("requires an existing parent for non-recursive directory creation", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({}));

    await assertRejects(
      () => fs.mkdir("project/cache"),
      Error,
      "Parent directory not found",
    );
    await fs.mkdir("project");
    await fs.mkdir("project/cache");
    assertEquals(await fs.exists("project/cache"), true);
  });

  it("bounds paths and keeps virtual roots directory-only", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({
      "": "reserved relative root key",
      "/": "reserved absolute root key",
    }));

    await assertRejects(
      () => fs.stat("x".repeat(MAX_PATH_LENGTH_CHARS + 1)),
      Error,
      "supported boundary",
    );
    await assertRejects(
      () => fs.readFile("pages/\0secret.mdx"),
      Error,
      "control characters",
    );
    await assertRejects(() => fs.readFile("."), Error, "virtual root");
    await assertRejects(() => fs.readFile("/"), Error, "virtual root");
    await assertRejects(() => fs.writeFile("", "content"), Error, "virtual root");
    await assertRejects(() => fs.remove("/"), Error, "virtual root");
    assertEquals((await fs.stat("")).isDirectory, true);
    assertEquals((await fs.stat("/")).isDirectory, true);
  });

  it("rejects relative and absolute paths that traverse above their lexical root", async () => {
    const fs = new CloudflareFileSystemAdapter(createKVNamespace({
      "/secret.mdx": "# Secret",
      "../secret.mdx": "# Relative secret",
    }));

    await assertRejects(
      () => fs.realPath("../secret.mdx"),
      Error,
      "escapes its lexical root",
    );
    await assertRejects(
      () => fs.realPath("/../../secret.mdx"),
      Error,
      "escapes its lexical root",
    );
  });
});
