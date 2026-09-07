import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderArtifacts } from "./render-artifacts.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";

function storage() {
  const files = new Map<string, Uint8Array>();
  let directories = 0;
  let removals = 0;
  const fs = {
    realPath: async (path: string) => path,
    makeTempDir: async () => `/tmp/vf-render-artifacts-${++directories}`,
    mkdir: async () => {},
    createFileBytesExclusive: async (path: string, bytes: Uint8Array) => {
      if (files.has(path)) throw new Error("already exists");
      files.set(path, bytes.slice());
    },
    remove: async (directory: string) => {
      removals++;
      for (const path of files.keys()) if (path.startsWith(`${directory}/`)) files.delete(path);
    },
  };
  return {
    fs,
    files,
    get directories() {
      return directories;
    },
    get removals() {
      return removals;
    },
  };
}

const limits = { maxEntries: 8, maxBytes: 4096 };
const input = () => ({
  files: [
    {
      path: "entry.mjs",
      source: 'export const load = () => import("./chunks/lazy.mjs?v=1#part");',
    },
    { path: "chunks/lazy.mjs", source: 'export { value } from "../shared.mjs";' },
    { path: "shared.mjs", source: 'export const value = "original";' },
  ],
  entrypoints: ["entry.mjs"],
});

describe("RenderArtifacts", () => {
  it("publishes a snapshotted graph without rewriting its modules", async () => {
    const data = input();
    const original = data.files.map((file) => ({ ...file }));
    const io = storage();
    const artifacts = new RenderArtifacts(data, limits, io.fs);
    data.files[2]!.source = 'export const value = "changed";';
    data.entrypoints[0] = "shared.mjs";
    const prepared = await artifacts.prepare();
    assertEquals(prepared.entrypointUrls, ["file:///tmp/vf-render-artifacts-1/entry.mjs"]);
    for (const file of original) {
      assertEquals(
        new TextDecoder().decode(io.files.get(`${prepared.directory}/${file.path}`)),
        file.source,
      );
    }
    assertEquals(prepared.fileCount, 3);
    assertEquals(await artifacts.prepare(), prepared);
    await artifacts.release();
    await artifacts.release();
    assertEquals(io.removals, 1);
    await assertRejects(() => artifacts.prepare(), Error, "released");
  });

  it("uses graph contents, not input order or publication location, for identity", async () => {
    const first = input();
    const second = input();
    second.files.reverse();
    const io = storage();
    const a = new RenderArtifacts(first, limits, io.fs);
    const b = new RenderArtifacts(second, limits, io.fs);
    assertEquals((await a.prepare()).id, (await b.prepare()).id);
    await a.release();
    assertEquals(io.files.size, 3, "releasing one publication must not delete another");
    await b.release();
  });

  it("rejects missing, escaping, remote, and nonliteral imports before filesystem writes", async () => {
    for (
      const source of [
        'import "./missing.mjs";',
        'export const load = () => import("../outside.mjs");',
        'export const load = () => import("../__veryfront_render_artifacts__/entry.mjs");',
        'export const load = () => import("./%2e%2e/__veryfront_render_artifacts__/entry.mjs");',
        'export const load = () => import("./.\\t./__veryfront_render_artifacts__/entry.mjs");',
        'export const load = () => import("./..\\\\__veryfront_render_artifacts__/entry.mjs");',
        'import "file:///outside.mjs";',
        'import "https://example.com/module.mjs";',
        'import "node:not-a-builtin";',
        "export const load = (name) => import(name);",
        'import "./chunks%2Flazy.mjs";',
      ]
    ) {
      const io = storage();
      const data = input();
      data.files[0]!.source = source;
      const artifacts = new RenderArtifacts(data, limits, io.fs);
      await assertRejects(() => artifacts.prepare());
      assertEquals(io.directories, 0, source);
      await artifacts.release();
    }
  });

  it("accepts cycles, runtime builtins, import.meta, and encoded filenames", async () => {
    const io = storage();
    const artifacts = new RenderArtifacts(
      {
        entrypoints: ["entry.mjs"],
        files: [
          {
            path: "entry.mjs",
            source:
              'import "node:path"; import "./caf%C3%A9.mjs"; export const url = import.meta.url;',
          },
          { path: "café.mjs", source: 'import "./entry.mjs";' },
        ],
      },
      limits,
      io.fs,
    );
    assertEquals((await artifacts.prepare()).fileCount, 2);
    await artifacts.release();
  });

  it("rejects path aliases, collisions, and capacity overflow without allocating storage", () => {
    const io = storage();
    for (
      const paths of [
        ["../entry.mjs"],
        ["/entry.mjs"],
        ["a\\entry.mjs"],
        ["entry.js"],
        ["a.mjs", "a.mjs"],
        ["A.mjs", "a.mjs"],
        ["a.mjs", "a.mjs/b.mjs"],
        ["a.mjs", "a.mjs-other.mjs", "a.mjs/b.mjs"],
        ["a.mjs/b.mjs", "a.mjs"],
        ["CON.mjs"],
        ["dir./entry.mjs"],
      ]
    ) {
      assertThrows(() =>
        new RenderArtifacts(
          {
            files: paths.map((path) => ({ path, source: "" })),
            entrypoints: [paths[0]!],
          },
          limits,
          io.fs,
        )
      );
    }
    assertThrows(() => new RenderArtifacts(input(), { ...limits, maxEntries: 2 }, io.fs));
    assertThrows(() => new RenderArtifacts(input(), { ...limits, maxBytes: 1 }, io.fs));
    for (const value of [0, -1, 1.5, NaN, Infinity]) {
      assertThrows(() => new RenderArtifacts(input(), { ...limits, maxEntries: value }, io.fs));
      assertThrows(() => new RenderArtifacts(input(), { ...limits, maxBytes: value }, io.fs));
    }
    assertEquals(io.directories, 0);
  });

  it("accounts for UTF-8 paths as well as source and rejects lossy text", async () => {
    const io = storage();
    const path = "café.mjs";
    const source = 'export const value = "😀";';
    const bytes = new TextEncoder().encode(path + source).byteLength;
    const data = { files: [{ path, source }], entrypoints: [path] };
    assertThrows(() => new RenderArtifacts(data, { maxEntries: 1, maxBytes: bytes - 1 }, io.fs));
    const exact = new RenderArtifacts(data, { maxEntries: 1, maxBytes: bytes }, io.fs);
    assertEquals((await exact.prepare()).byteLength, bytes);
    await exact.release();
    assertThrows(() =>
      new RenderArtifacts(
        {
          files: [{ path: "entry.mjs", source: 'export const value = "\ud800";' }],
          entrypoints: ["entry.mjs"],
        },
        limits,
        io.fs,
      )
    );
  });

  it("includes nested directories in the filesystem entry budget", () => {
    assertThrows(() =>
      new RenderArtifacts(
        {
          files: [{ path: "a/b/entry.mjs", source: "" }],
          entrypoints: ["a/b/entry.mjs"],
        },
        { maxEntries: 2, maxBytes: 4096 },
        storage().fs,
      )
    );
  });

  it("counts differently cased directories separately for case-sensitive filesystems", () => {
    assertThrows(() =>
      new RenderArtifacts(
        {
          files: [{ path: "A/one.mjs", source: "" }, { path: "a/two.mjs", source: "" }],
          entrypoints: ["A/one.mjs"],
        },
        { maxEntries: 3, maxBytes: 4096 },
        storage().fs,
      )
    );
  });

  it("rejects a temporary directory inside the disposable cache, including aliases", async () => {
    for (const prefix of ["/tmp/cache", "/tmp/alias"]) {
      const io = storage();
      const artifacts = runWithCacheDir("/tmp/cache", () =>
        new RenderArtifacts(input(), limits, {
          ...io.fs,
          makeTempDir: async () => `${prefix}/vf-render-artifacts-test`,
          realPath: async (path) => path.replace("/tmp/alias", "/tmp/cache"),
        }));
      await assertRejects(() => artifacts.prepare(), Error, "disposable cache");
      assertEquals(io.files.size, 0);
      assertEquals(io.removals, 1, "the rejected private directory is cleaned up");
      await artifacts.release();
    }
  });

  it("cleans a failed publication and retains ownership when cleanup needs a retry", async () => {
    const io = storage();
    let removeAttempts = 0;
    let writes = 0;
    const artifacts = new RenderArtifacts(input(), limits, {
      ...io.fs,
      createFileBytesExclusive: async () => {
        writes++;
        throw new Error("write failed");
      },
      remove: async () => {
        if (++removeAttempts === 1) throw new Error("remove failed");
      },
    });
    await assertRejects(() => artifacts.prepare());
    assertEquals(writes, 1);
    await artifacts.release();
    assertEquals(removeAttempts, 2);
  });

  it("waits for pending publication before releasing its directory", async () => {
    const io = storage();
    const writing = Promise.withResolvers<void>();
    const finishWrite = Promise.withResolvers<void>();
    const artifacts = new RenderArtifacts(input(), limits, {
      ...io.fs,
      createFileBytesExclusive: async () => {
        writing.resolve();
        await finishWrite.promise;
      },
    });
    const preparing = artifacts.prepare();
    const rejected = assertRejects(() => preparing, Error, "released");
    await writing.promise;
    const releasing = artifacts.release();
    assertEquals(io.removals, 0);
    finishWrite.resolve();
    await Promise.all([releasing, rejected]);
    assertEquals(io.removals, 1);
  });
});
