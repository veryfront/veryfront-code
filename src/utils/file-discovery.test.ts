import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { collectFiles, countFiles, discoverFiles, hasMatchingFiles } from "./file-discovery.ts";
import { cwd } from "../platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

const TEST_DIR = join(cwd(), "src/utils");

describe("file-discovery", () => {
  it("discovers files with extension filter", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      recursive: false,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(files.every((f) => f.name.endsWith(".ts")), true);
    assertEquals(files.every((f) => f.isFile), true);
  });

  it("discovers files recursively", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(files.some((f) => f.depth > 0), true);
  });

  it("filters by pattern", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["test"],
      recursive: false,
    });

    assertExists(files);
    assertEquals(files.every((f) => f.name.includes("test")), true);
  });

  it("respects maxDepth", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src"),
      extensions: [".ts"],
      maxDepth: 1,
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.every((f) => f.depth <= 1), true);
  });

  it("ignores patterns", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      ignorePatterns: ["test"],
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.every((f) => !f.name.includes("test")), true);
  });

  it("includes directories when requested", async () => {
    const results = await collectFiles({
      baseDir: TEST_DIR,
      includeDirs: true,
      recursive: false,
    });

    assertExists(results);
    assertEquals(results.some((r) => r.isDirectory), true);
  });

  it("async generator iteration", async () => {
    let count = 0;

    for await (
      const _file of discoverFiles({
        baseDir: TEST_DIR,
        extensions: [".ts"],
        recursive: false,
      })
    ) {
      count++;
    }

    assertEquals(count > 0, true);
  });

  it("hasMatchingFiles returns true when files exist", async () => {
    const hasFiles = await hasMatchingFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
    });

    assertEquals(hasFiles, true);
  });

  it("hasMatchingFiles returns false when no files match", async () => {
    const hasFiles = await hasMatchingFiles({
      baseDir: TEST_DIR,
      extensions: [".nonexistent"],
    });

    assertEquals(hasFiles, false);
  });

  it("countFiles counts correctly", async () => {
    const count = await countFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      recursive: false,
    });

    assertEquals(count > 0, true);
  });

  it("handles non-existent directory gracefully", async () => {
    const files = await collectFiles({
      baseDir: "/nonexistent/directory",
      extensions: [".ts"],
    });

    assertEquals(files.length, 0);
  });

  it("discovers multiple extension types", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src/routing"),
      extensions: [".ts", ".tsx"],
      maxDepth: 1,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(files.every((f) => f.name.endsWith(".ts") || f.name.endsWith(".tsx")), true);
  });

  it("combines extension and pattern filters", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src/routing"),
      extensions: [".ts"],
      patterns: ["route"],
      maxDepth: 1,
    });

    assertExists(files);
    assertEquals(files.every((f) => f.name.endsWith(".ts")), true);
    assertEquals(files.every((f) => f.name.includes("route")), true);
  });

  it("applies glob-style ignore patterns used by definition discovery", async () => {
    const root = await Deno.makeTempDir({ prefix: "file-discovery-ignore-" });

    try {
      await Deno.writeTextFile(join(root, "task.ts"), "export const task = true;");
      await Deno.writeTextFile(join(root, "task.test.ts"), "export const test = true;");

      const files = await collectFiles({
        baseDir: root,
        extensions: [".ts"],
        ignorePatterns: ["*.test.*"],
      });

      assertEquals(files.map((file) => file.name), ["task.ts"]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("propagates operational directory failures instead of reporting an empty directory", async () => {
    const failure = new Error("permission-failure-canary");
    const adapter = {
      fs: {
        readDir(): AsyncIterable<never> {
          throw failure;
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => collectFiles({ baseDir: "/project", adapter }),
      Error,
      "permission-failure-canary",
    );
  });

  it("rejects invalid depth limits", async () => {
    const error = await assertRejects(
      () => collectFiles({ baseDir: TEST_DIR, maxDepth: Number.POSITIVE_INFINITY }),
      Error,
      "maxDepth must be a non-negative integer",
    );
    assertEquals((error as { slug?: unknown }).slug, "invalid-argument");
  });

  it("rejects adapter entries that are not single path segments", async () => {
    const adapter = {
      fs: {
        async *readDir(): AsyncIterable<{
          name: string;
          isFile: boolean;
          isDirectory: boolean;
          isSymlink: boolean;
        }> {
          yield {
            name: "../outside.ts",
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
        },
      },
    } as unknown as RuntimeAdapter;

    const error = await assertRejects(
      () => collectFiles({ baseDir: "/project", adapter }),
      Error,
      "Filesystem entries must use a single valid path segment",
    );
    assertEquals((error as { slug?: unknown }).slug, "invalid-argument");
  });

  it("does not follow directory symlinks outside the discovery root", async () => {
    const root = await Deno.makeTempDir({ prefix: "file-discovery-root-" });
    const outside = await Deno.makeTempDir({ prefix: "file-discovery-outside-" });

    try {
      await Deno.writeTextFile(join(outside, "private.ts"), "export const privateValue = true;");
      await Deno.symlink(outside, join(root, "outside"));

      const files = await collectFiles({
        baseDir: root,
        extensions: [".ts"],
        followSymlinks: true,
      });

      assertEquals(files, []);
    } finally {
      await Deno.remove(root, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  });

  it("visits a canonical directory only once when symlinks form a cycle", async () => {
    const root = await Deno.makeTempDir({ prefix: "file-discovery-cycle-" });

    try {
      await Deno.writeTextFile(join(root, "entry.ts"), "export const entry = true;");
      await Deno.mkdir(join(root, "nested"));
      await Deno.symlink(root, join(root, "nested", "loop"));

      const files = await collectFiles({
        baseDir: root,
        extensions: [".ts"],
        followSymlinks: true,
        maxDepth: 8,
      });

      assertEquals(files.map((file) => file.name), ["entry.ts"]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
