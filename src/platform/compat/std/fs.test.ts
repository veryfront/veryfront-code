import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove, writeTextFile } from "../fs.ts";
import { join, toFileUrl } from "../path/index.ts";
import { ensureDir, exists, existsSync, walk } from "./fs.ts";

describe("platform/compat/std/fs", () => {
  let root = "";
  let filePath = "";
  let nestedDirectory = "";
  let nestedFile = "";

  beforeAll(async () => {
    root = await makeTempDir({ prefix: "veryfront-std-fs-" });
    filePath = join(root, "root.txt");
    nestedDirectory = join(root, "nested");
    nestedFile = join(nestedDirectory, "nested.ts");

    await ensureDir(nestedDirectory);
    await writeTextFile(filePath, "root");
    await writeTextFile(join(root, "root.js"), "javascript");
    await writeTextFile(nestedFile, "nested");
  });

  afterAll(async () => {
    await remove(root, { recursive: true });
  });

  it("ensures directories but rejects an existing file path", async () => {
    const directory = join(root, "new", "deep");
    await ensureDir(directory);

    assertEquals(await exists(directory, { isDirectory: true }), true);
    await assertRejects(() => ensureDir(filePath));
  });

  it("classifies files and directories without hiding invalid options", async () => {
    assertEquals(await exists(filePath), true);
    assertEquals(await exists(filePath, { isFile: true }), true);
    assertEquals(await exists(filePath, { isDirectory: true }), false);
    assertEquals(await exists(nestedDirectory, { isDirectory: true }), true);
    assertEquals(await exists(join(root, "missing")), false);
    assertEquals(existsSync(toFileUrl(filePath), { isFile: true }), true);

    await assertRejects(
      () => exists(filePath, { isDirectory: true, isFile: true }),
      TypeError,
    );
  });

  it("includes the walk root and applies maxDepth from that root", async () => {
    const rootOnly = await Array.fromAsync(walk(root, { maxDepth: 0 }));
    assertEquals(rootOnly.map((entry) => entry.path), [root]);

    const oneLevel = await Array.fromAsync(walk(root, { maxDepth: 1 }));
    assertEquals(oneLevel.some((entry) => entry.path === nestedFile), false);
    assertEquals(oneLevel.some((entry) => entry.path === nestedDirectory), true);
    assertEquals(oneLevel.some((entry) => entry.path === filePath), true);
  });

  it("normalizes extension filters and does not prune unmatched directories", async () => {
    const byExtension = await Array.fromAsync(
      walk(root, {
        exts: ["ts"],
        includeDirs: false,
      }),
    );
    assertEquals(byExtension.map((entry) => entry.path), [nestedFile]);

    const byMatch = await Array.fromAsync(
      walk(root, {
        includeDirs: false,
        match: [/nested\.ts$/],
      }),
    );
    assertEquals(byMatch.map((entry) => entry.path), [nestedFile]);
  });

  it("accepts file URLs and propagates a missing walk root", async () => {
    const entries = await Array.fromAsync(
      walk(toFileUrl(root), { maxDepth: 0 }),
    );
    assertEquals(entries.map((entry) => entry.path), [root]);

    await assertRejects(() => Array.fromAsync(walk(join(root, "missing-directory"))));
  });
});
