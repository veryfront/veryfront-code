import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CachePayload } from "../types.ts";
import { FilesystemCacheStore } from "./filesystem-store.ts";

function payload(html: string): CachePayload {
  return {
    result: {
      html,
      frontmatter: {},
      headings: [],
      stream: null,
    },
    storedAt: Date.now(),
  };
}

async function withProject(
  run: (paths: { projectDir: string; cacheDir: string; dataDir: string }) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-render-cache-" });
  const cacheDir = join(projectDir, ".veryfront", "render");
  const dataDir = join(cacheDir, "v2");
  try {
    await run({ projectDir, cacheDir, dataDir });
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

function withFilesystem(
  adapter: RuntimeAdapter,
  fs: FileSystemAdapter,
): RuntimeAdapter {
  return { ...adapter, fs } as RuntimeAdapter;
}

function overrideFilesystem(
  fs: FileSystemAdapter,
  overrides: Partial<FileSystemAdapter>,
): FileSystemAdapter {
  return new Proxy(fs, {
    get(target, property) {
      const override = Reflect.get(overrides, property);
      if (override !== undefined) return override;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("rendering/cache/stores/filesystem-store", () => {
  describe("constructor", () => {
    it("rejects blank directories", () => {
      assertThrows(
        () => new FilesystemCacheStore({ baseDir: "  " }),
        TypeError,
        "non-blank path",
      );
    });

    it("rejects configured directories outside the owner root", async () => {
      await withProject(async ({ projectDir }) => {
        assertThrows(
          () =>
            new FilesystemCacheStore({
              baseDir: join(projectDir, "..", "escaped-render-cache"),
              ownerRoot: projectDir,
            }),
          TypeError,
          "inside its owner root",
        );
      });
    });
  });

  describe("persistent operations", () => {
    it("returns undefined without creating a directory for a missing key", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

        assertEquals(await store.get("missing"), undefined);
        await assertRejects(() => Deno.stat(cacheDir), Deno.errors.NotFound);
      });
    });

    it("sets, gets, deletes, and reinitializes after clear", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

        await store.set("page", payload("first"));
        assertEquals((await store.get("page"))?.result.html, "first");

        await store.delete("page");
        assertEquals(await store.get("page"), undefined);
        await store.delete("page");

        await store.clear();
        await store.set("page", payload("second"));
        assertEquals((await store.get("page"))?.result.html, "second");
      });
    });

    it("initializes ownership once for concurrent first writes", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

        await Promise.all([
          store.set("page:a", payload("a")),
          store.set("page:b", payload("b")),
        ]);

        assertEquals((await store.get("page:a"))?.result.html, "a");
        assertEquals((await store.get("page:b"))?.result.html, "b");
      });
    });

    it("deletes only matching encoded key prefixes", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });
        await store.set("project:a", payload("a"));
        await store.set("project:b", payload("b"));
        await store.set("other:c", payload("c"));

        assertEquals(await store.deleteByPrefix("project:"), 2);
        assertEquals(await store.get("project:a"), undefined);
        assertEquals(await store.get("project:b"), undefined);
        assertEquals((await store.get("other:c"))?.result.html, "c");
      });
    });

    it("preserves entries across normal destroy", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        const first = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });
        await first.set("page", payload("persistent"));
        await first.destroy();

        const reopened = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });
        assertEquals((await reopened.get("page"))?.result.html, "persistent");
      });
    });

    it("evicts malformed cache files", async () => {
      await withProject(async ({ projectDir, cacheDir, dataDir }) => {
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });
        await store.set("broken", payload("valid"));
        const cacheEntry = [...Deno.readDirSync(dataDir)].find((entry) =>
          entry.isFile && entry.name.endsWith(".json")
        );
        const cacheFile = join(dataDir, cacheEntry!.name);
        await Deno.writeTextFile(cacheFile, "{not-json");

        assertEquals(await store.get("broken"), undefined);
        await assertRejects(() => Deno.stat(cacheFile), Deno.errors.NotFound);
      });
    });

    it("uses bounded filenames for long cache keys", async () => {
      await withProject(async ({ projectDir, cacheDir, dataDir }) => {
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });
        const longKey = `project:${"segment:".repeat(1_000)}`;

        await store.set(longKey, payload("long-key"));
        assertEquals((await store.get(longKey))?.result.html, "long-key");

        const files = [...Deno.readDirSync(dataDir)].filter((entry) =>
          entry.isFile && entry.name.endsWith(".json")
        );
        assertEquals(files.length, 1);
        assertEquals(files[0]!.name.length, 72);
      });
    });

    it("enforces persistent capacity across store instances", async () => {
      await withProject(async ({ projectDir, cacheDir, dataDir }) => {
        let now = 0;
        const first = new FilesystemCacheStore({
          baseDir: cacheDir,
          ownerRoot: projectDir,
          maxEntries: 2,
          now: () => now++,
        });
        await first.set("first", payload("first"));
        await first.set("second", payload("second"));
        await first.set("third", payload("third"));

        assertEquals(await first.get("first"), undefined);
        assertEquals((await first.get("second"))?.result.html, "second");
        assertEquals((await first.get("third"))?.result.html, "third");
        assertEquals(
          [...Deno.readDirSync(dataDir)].filter((entry) => entry.name.endsWith(".json")).length,
          2,
        );

        const reopened = new FilesystemCacheStore({
          baseDir: cacheDir,
          ownerRoot: projectDir,
          maxEntries: 2,
          now: () => now++,
        });
        await reopened.set("fourth", payload("fourth"));
        assertEquals(await reopened.get("second"), undefined);
        assertEquals((await reopened.get("third"))?.result.html, "third");
        assertEquals((await reopened.get("fourth"))?.result.html, "fourth");
      });
    });
  });

  describe("ownership and failure handling", () => {
    it("keeps legacy/unowned cache-root files outside its versioned owned directory", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        await Deno.mkdir(cacheDir, { recursive: true });
        const userFile = join(cacheDir, "user-data.txt");
        await Deno.writeTextFile(userFile, "keep me");
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

        await store.set("page", payload("safe"));
        assertEquals((await store.get("page"))?.result.html, "safe");
        await store.clear();
        assertEquals(await Deno.readTextFile(userFile), "keep me");
      });
    });

    it("refuses to claim a non-empty versioned directory without an owner marker", async () => {
      await withProject(async ({ projectDir, cacheDir, dataDir }) => {
        await Deno.mkdir(dataDir, { recursive: true });
        const userFile = join(dataDir, "user-data.txt");
        await Deno.writeTextFile(userFile, "keep me");
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

        await assertRejects(
          () => store.set("page", payload("unsafe")),
          TypeError,
          "Refusing to claim",
        );
        await assertRejects(() => store.clear(), TypeError, "not owned by Veryfront");
        assertEquals(await Deno.readTextFile(userFile), "keep me");
      });
    });

    it("rejects a symlinked cache directory even when its target is contained", async () => {
      await withProject(async ({ projectDir, cacheDir }) => {
        const target = join(projectDir, "real-cache");
        await Deno.mkdir(target);
        await Deno.mkdir(join(projectDir, ".veryfront"));
        await Deno.symlink(target, cacheDir);
        const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

        await assertRejects(
          () => store.set("page", payload("unsafe")),
          TypeError,
          "parent cannot be a symlink",
        );
      });
    });

    it("rejects a parent symlink that escapes the owner root", async () => {
      const external = await Deno.makeTempDir({ prefix: "vf-render-cache-external-" });
      try {
        await withProject(async ({ projectDir, cacheDir }) => {
          await Deno.mkdir(join(projectDir, ".veryfront"), { recursive: true });
          await Deno.symlink(external, cacheDir);
          const store = new FilesystemCacheStore({ baseDir: cacheDir, ownerRoot: projectDir });

          await assertRejects(
            () => store.set("page", payload("unsafe")),
            TypeError,
            "parent cannot be a symlink",
          );
          await assertRejects(
            () => Deno.stat(join(external, "v2")),
            Deno.errors.NotFound,
          );
        });
      } finally {
        await Deno.remove(external, { recursive: true });
      }
    });

    it("keeps the previous value when atomic replacement fails", async () => {
      await withProject(async ({ projectDir, cacheDir, dataDir }) => {
        const adapter = await getLocalAdapter();
        const store = new FilesystemCacheStore({
          baseDir: cacheDir,
          ownerRoot: projectDir,
          adapter,
        });
        await store.set("page", payload("previous"));

        const failedRename = new Error("rename failed");
        const fs = overrideFilesystem(adapter.fs, {
          rename: (_from, to) =>
            to.endsWith(".json") ? Promise.reject(failedRename) : adapter.fs.rename!(_from, to),
        });
        const failingStore = new FilesystemCacheStore({
          baseDir: cacheDir,
          ownerRoot: projectDir,
          adapter: withFilesystem(adapter, fs),
        });

        await assertRejects(() => failingStore.set("page", payload("replacement")));
        assertEquals((await store.get("page"))?.result.html, "previous");

        for await (const entry of Deno.readDir(dataDir)) {
          assertEquals(entry.name.endsWith(".tmp"), false);
        }
      });
    });

    it("propagates destructive filesystem failures", async () => {
      await withProject(async ({ projectDir, cacheDir, dataDir }) => {
        const adapter = await getLocalAdapter();
        const store = new FilesystemCacheStore({
          baseDir: cacheDir,
          ownerRoot: projectDir,
          adapter,
        });
        await store.set("page", payload("value"));

        const denied = new Error("permission denied");
        const fs = overrideFilesystem(adapter.fs, {
          remove: (path, options) =>
            path === dataDir && options?.recursive
              ? Promise.reject(denied)
              : adapter.fs.remove(path, options),
        });
        const failingStore = new FilesystemCacheStore({
          baseDir: cacheDir,
          ownerRoot: projectDir,
          adapter: withFilesystem(adapter, fs),
        });

        await assertRejects(() => failingStore.clear());
        assertEquals((await store.get("page"))?.result.html, "value");
      });
    });
  });
});
