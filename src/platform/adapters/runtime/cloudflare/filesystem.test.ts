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
  const entries = new Map(Object.entries(initialEntries));
  return {
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(entries.get(key) ?? null);
    },
    getWithMetadata(key) {
      return Promise.resolve({
        metadata: null,
        value: entries.get(key) ?? null,
      });
    },
    list(options = {}) {
      const prefix = options.prefix ?? "";
      return Promise.resolve({
        keys: [...entries.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
      });
    },
    put(key, value) {
      entries.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("CloudflareFileSystemAdapter realPath", () => {
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
