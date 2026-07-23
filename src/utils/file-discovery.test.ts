import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { collectFiles, countFiles, discoverFiles, hasMatchingFiles } from "./file-discovery.ts";
import { cwd } from "../platform/compat/process.ts";

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

  it("applies glob ignore patterns to complete entry names", async () => {
    const names = [
      "page.ts",
      "page.test.ts",
      "page.spec.tsx",
      "page.test-helper.ts",
      "contest.ts",
    ];
    const adapter = {
      fs: {
        async *readDir() {
          for (const name of names) {
            yield { name, isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as unknown as RuntimeAdapter;

    const files = await collectFiles({
      baseDir: "/root",
      extensions: [".ts", ".tsx"],
      ignorePatterns: ["*.test.*", "*.spec.*"],
      adapter,
    });

    assertEquals(files.map((file) => file.name), [
      "page.ts",
      "page.test-helper.ts",
      "contest.ts",
    ]);
  });

  it("matches glob wildcards by Unicode code point", async () => {
    const names = ["😀page.ts", "😀.ts", "x.ts"];
    const adapter = {
      fs: {
        async *readDir() {
          for (const name of names) {
            yield { name, isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as unknown as RuntimeAdapter;

    const emojiPrefix = await collectFiles({
      baseDir: "/root",
      extensions: [".ts"],
      ignorePatterns: ["😀*"],
      adapter,
    });
    assertEquals(emojiPrefix.map((file) => file.name), ["x.ts"]);

    const singleCodePoint = await collectFiles({
      baseDir: "/root",
      extensions: [".ts"],
      ignorePatterns: ["?.ts"],
      adapter,
    });
    assertEquals(singleCodePoint.map((file) => file.name), ["😀page.ts"]);
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

  it("propagates directory read failures other than not-found", async () => {
    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const adapter = {
      fs: {
        readDir(): AsyncIterable<never> {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => Promise.reject(permissionError),
              };
            },
          };
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => collectFiles({ baseDir: "/protected", adapter }),
      Error,
      "permission denied",
    );
  });

  it("does not revisit a directory through a symlink cycle", async () => {
    const entries = new Map<
      string,
      Array<{
        name: string;
        isFile: boolean;
        isDirectory: boolean;
        isSymlink: boolean;
      }>
    >([
      ["/root", [{ name: "nested", isFile: false, isDirectory: true, isSymlink: false }]],
      [
        "/root/nested",
        [
          { name: "page.ts", isFile: true, isDirectory: false, isSymlink: false },
          { name: "loop", isFile: false, isDirectory: false, isSymlink: true },
        ],
      ],
      ["/root/nested/loop", [
        { name: "nested", isFile: false, isDirectory: true, isSymlink: false },
      ]],
      [
        "/root/nested/loop/nested",
        [
          { name: "page.ts", isFile: true, isDirectory: false, isSymlink: false },
          { name: "loop", isFile: false, isDirectory: false, isSymlink: true },
        ],
      ],
    ]);
    const adapter = {
      fs: {
        async *readDir(path: string) {
          for (const entry of entries.get(path) ?? []) yield entry;
        },
        stat: () =>
          Promise.resolve({
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            size: 0,
            mtime: null,
          }),
        realPath: (path: string) =>
          Promise.resolve(path.includes("loop") ? "/physical/root" : `/physical${path}`),
      },
    } as unknown as RuntimeAdapter;

    const files = await collectFiles({
      baseDir: "/root",
      extensions: [".ts"],
      followSymlinks: true,
      maxDepth: 4,
      adapter,
    });

    assertEquals(files.map((file) => file.name), ["page.ts"]);
  });

  it("does not follow symlinks whose physical target escapes baseDir", async () => {
    let statCalls = 0;
    const adapter = {
      fs: {
        async *readDir(path: string) {
          if (path !== "/root") throw new Error(`escaped read: ${path}`);
          yield { name: "outside", isFile: false, isDirectory: false, isSymlink: true };
        },
        realPath: (path: string) =>
          Promise.resolve(path === "/root" ? "/physical/root" : "/physical/outside/secret"),
        stat: () => {
          statCalls++;
          return Promise.resolve({
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            size: 1,
            mtime: null,
          });
        },
      },
    } as unknown as RuntimeAdapter;

    const files = await collectFiles({
      baseDir: "/root",
      followSymlinks: true,
      adapter,
    });

    assertEquals(files, []);
    assertEquals(statCalls, 0);
  });

  it("rejects invalid maximum depths", async () => {
    for (const maxDepth of [-1, 1.5, Number.NaN]) {
      await assertRejects(
        () => collectFiles({ baseDir: TEST_DIR, maxDepth }),
        RangeError,
      );
    }
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
});
