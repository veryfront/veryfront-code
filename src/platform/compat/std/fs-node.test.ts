import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, exists, existsSync, walk } from "./fs-node.ts";
import type { WalkEntry, WalkOptions } from "./fs.ts";

async function withTempDirectory(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "veryfront-std-fs-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function collect(
  root: string | URL,
  options?: WalkOptions,
): Promise<WalkEntry[]> {
  return await Array.fromAsync(walk(root, options));
}

describe("platform/compat/std/fs Node adapter", () => {
  describe("exists", () => {
    it("supports file, directory, readable, and URL checks", async () => {
      await withTempDirectory(async (root) => {
        const file = join(root, "file.txt");
        await writeFile(file, "content");

        assertEquals(await exists(pathToFileURL(file), { isFile: true }), true);
        assertEquals(await exists(file, { isDirectory: true }), false);
        assertEquals(await exists(root, { isDirectory: true }), true);
        assertEquals(await exists(root, { isFile: true }), false);
        assertEquals(await exists(file, { isReadable: true }), true);

        assertEquals(existsSync(pathToFileURL(file), { isFile: true }), true);
        assertEquals(existsSync(file, { isDirectory: true }), false);
        assertEquals(existsSync(root, { isDirectory: true }), true);
        assertEquals(existsSync(root, { isFile: true }), false);
        assertEquals(existsSync(file, { isReadable: true }), true);
      });
    });

    it("rejects contradictory type checks after resolving an existing path", async () => {
      await withTempDirectory(async (root) => {
        await assertRejects(
          () => exists(root, { isDirectory: true, isFile: true }),
          TypeError,
          "must not be true together",
        );
        assertThrows(
          () => existsSync(root, { isDirectory: true, isFile: true }),
          TypeError,
          "must not be true together",
        );
      });
    });

    it("returns false only for missing paths and propagates invalid operations", async () => {
      await withTempDirectory(async (root) => {
        const missing = join(root, "missing");
        assertEquals(await exists(missing), false);
        assertEquals(existsSync(missing), false);
      });

      await assertRejects(() => exists("\0"), TypeError);
      assertThrows(() => existsSync("\0"), TypeError);
    });

    it("reports an existing but unreadable path as unreadable on POSIX", async () => {
      if (process.platform === "win32" || process.getuid?.() === 0) return;

      await withTempDirectory(async (root) => {
        const file = join(root, "private.txt");
        await writeFile(file, "private");
        await chmod(file, 0);
        try {
          assertEquals(await exists(file), true);
          assertEquals(await exists(file, { isReadable: true }), false);
          assertEquals(existsSync(file), true);
          assertEquals(existsSync(file, { isReadable: true }), false);
        } finally {
          await chmod(file, 0o600);
        }
      });
    });
  });

  describe("ensureDir", () => {
    it("creates directories and rejects when the path is an existing file", async () => {
      await withTempDirectory(async (root) => {
        const nested = join(root, "nested", "directory");
        await ensureDir(pathToFileURL(nested));
        assertEquals(await exists(nested, { isDirectory: true }), true);

        const file = join(root, "file.txt");
        await writeFile(file, "content");
        await assertRejects(() => ensureDir(file), Error);
      });
    });
  });

  describe("walk", () => {
    it("includes the root and applies maxDepth from the root", async () => {
      await withTempDirectory(async (root) => {
        await writeFile(join(root, "b.ts"), "b");
        await writeFile(join(root, "a.ts"), "a");
        await mkdir(join(root, "nested"));
        await writeFile(join(root, "nested", "deep.ts"), "deep");

        assertEquals(
          (await collect(root, { maxDepth: 0 })).map((entry) => entry.name),
          [basename(root)],
        );
        assertEquals(
          (await collect(root, { maxDepth: 1 })).map((entry) => entry.name),
          [basename(root), "a.ts", "b.ts", "nested"],
        );
        assertEquals(
          (await collect(root)).map((entry) => entry.name),
          [basename(root), "a.ts", "b.ts", "nested", "deep.ts"],
        );
      });
    });

    it("normalizes extension filters without blocking directory traversal", async () => {
      await withTempDirectory(async (root) => {
        await mkdir(join(root, "nested"));
        await writeFile(join(root, "top.js"), "js");
        await writeFile(join(root, "nested", "deep.ts"), "ts");

        for (const exts of [["ts"], [".ts"]]) {
          assertEquals(
            (await collect(root, { exts })).map((entry) => entry.name),
            ["deep.ts"],
          );
        }
      });
    });

    it("applies match only to yielded entries and skip to whole subtrees", async () => {
      await withTempDirectory(async (root) => {
        await mkdir(join(root, "nested"));
        await writeFile(join(root, "top.ts"), "top");
        await writeFile(join(root, "nested", "deep.ts"), "deep");

        assertEquals(
          (await collect(root, { match: [/deep\.ts$/] })).map((entry) => entry.name),
          ["deep.ts"],
        );
        assertEquals(
          (await collect(root, { skip: [/[/\\]nested(?:[/\\]|$)/] })).map((entry) => entry.name),
          [basename(root), "top.ts"],
        );
      });
    });

    it("handles global regular expressions deterministically without mutating them", async () => {
      await withTempDirectory(async (root) => {
        await writeFile(join(root, "a.ts"), "a");
        await writeFile(join(root, "b.ts"), "b");
        const pattern = /\.ts$/g;
        pattern.lastIndex = 2;

        assertEquals(
          (await collect(root, { match: [pattern] })).map((entry) => entry.name),
          ["a.ts", "b.ts"],
        );
        assertEquals(pattern.lastIndex, 2);
      });
    });

    it("preserves symlink options and bounds ancestor cycles", async () => {
      await withTempDirectory(async (root) => {
        const targetFile = join(root, "target.ts");
        const targetDir = join(root, "target-dir");
        const fileLink = join(root, "file-link");
        const directoryLink = join(root, "directory-link");
        const cycleLink = join(targetDir, "cycle");
        await writeFile(targetFile, "target");
        await mkdir(targetDir);
        await writeFile(join(targetDir, "nested.ts"), "nested");
        await symlink(targetFile, fileLink, "file");
        await symlink(targetDir, directoryLink, "dir");
        await symlink(root, cycleLink, "dir");

        const links = (await collect(root, { maxDepth: 1 })).filter((entry) => entry.isSymlink);
        assertEquals(links.map((entry) => entry.name), ["directory-link", "file-link"]);

        const withoutLinks = await collect(root, {
          includeSymlinks: false,
          maxDepth: 1,
        });
        assertEquals(withoutLinks.some((entry) => entry.isSymlink), false);

        const followedFile = (await collect(root, {
          followSymlinks: true,
          maxDepth: 1,
        })).find((entry) => entry.name === "file-link");
        assert(followedFile);
        assertEquals(followedFile.path, await realpath(targetFile));
        assertEquals(followedFile.isSymlink, true);

        const cycleEntries = await collect(root, {
          canonicalize: false,
          followSymlinks: true,
        });
        assert(cycleEntries.length < 20);
        assertEquals(
          cycleEntries.some((entry) => entry.path.includes(join("target-dir", "cycle"))),
          true,
        );
      });
    });

    it("propagates missing-root and broken-followed-link failures", async () => {
      await withTempDirectory(async (root) => {
        await assertRejects(
          async () => await collect(join(root, "missing")),
          Error,
        );

        const brokenLink = join(root, "broken");
        await symlink(join(root, "missing-target"), brokenLink, "file");
        await assertRejects(
          async () => await collect(root, { followSymlinks: true }),
          Error,
        );
      });
    });
  });
});
