import "#veryfront/schemas/_test-setup.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { collectFiles, countFiles, discoverFiles, hasMatchingFiles } from "./file-discovery.ts";
import { cwd } from "../platform/compat/process.ts";

const TEST_DIR = join(cwd(), "src/utils");

function withFixtureTree<T>(build: (root: string) => void, run: (root: string) => Promise<T>) {
  const root = mkdtempSync(join(tmpdir(), "veryfront-file-discovery-"));
  build(root);
  return run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

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

  it("filters by glob pattern", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["file-*.test.ts"],
      recursive: false,
    });

    assertEquals(files.some((f) => f.name === "file-discovery.test.ts"), true);
    assertEquals(
      files.every((f) => f.name.startsWith("file-") && f.name.endsWith(".test.ts")),
      true,
    );
  });

  it("filters by single-character glob pattern", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["file-discover?.ts"],
      recursive: false,
    });

    assertEquals(files.some((f) => f.name === "file-discovery.ts"), true);
    assertEquals(files.some((f) => f.name === "file-discovery.test.ts"), false);
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

  it("ignores glob patterns", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      ignorePatterns: ["*.test.*"],
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(files.some((f) => f.name === "file-discovery.ts"), true);
    assertEquals(files.every((f) => !f.name.includes(".test.")), true);
  });

  it("ignores single-character glob patterns", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      ignorePatterns: ["file-discover?.ts"],
      recursive: false,
    });

    assertExists(files);
    assertEquals(files.some((f) => f.name === "file-discovery.ts"), false);
    assertEquals(files.some((f) => f.name === "file-discovery.test.ts"), true);
  });

  it("treats a leading **/ include glob as any-depth entry matching", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["**/file-*.test.ts"],
      recursive: false,
    });

    assertEquals(files.some((f) => f.name === "file-discovery.test.ts"), true);
    assertEquals(
      files.every((f) => f.name.startsWith("file-") && f.name.endsWith(".test.ts")),
      true,
    );
  });

  it("treats a leading Windows **\\ include glob as any-depth entry matching", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["**\\file-*.test.ts"],
      recursive: false,
    });

    assertEquals(files.some((f) => f.name === "file-discovery.test.ts"), true);
    assertEquals(
      files.every((f) => f.name.startsWith("file-") && f.name.endsWith(".test.ts")),
      true,
    );
  });

  it("does not let an empty any-depth include pattern match every entry", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["**/"],
      recursive: false,
    });

    assertEquals(files, []);
  });

  it("disables path-shaped include patterns instead of silently matching everything", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["utils/*.ts"],
      recursive: false,
    });

    assertEquals(files.length, 0);
  });

  it("treats a leading **/ ignore glob as any-depth entry matching", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      ignorePatterns: ["**/*.test.*"],
      recursive: true,
    });

    assertEquals(files.length > 0, true);
    assertEquals(files.every((f) => !f.name.includes(".test.")), true);
  });

  it("does not let path-shaped ignore patterns hide files", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      ignorePatterns: ["utils/file-discovery.ts"],
      recursive: false,
    });

    assertEquals(files.some((f) => f.name === "file-discovery.ts"), true);
  });

  it("does not let empty or Windows path-shaped ignores hide files", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      ignorePatterns: ["**/", "utils\\file-discovery.ts"],
      recursive: false,
    });

    assertEquals(files.some((f) => f.name === "file-discovery.ts"), true);
  });

  it("does not prune directories with file-glob ignore patterns", async () => {
    await withFixtureTree(
      (root) => {
        mkdirSync(join(root, "fixtures.test.data"));
        writeFileSync(join(root, "fixtures.test.data", "inner.ts"), "export {};");
        writeFileSync(join(root, "keep.ts"), "export {};");
        writeFileSync(join(root, "skip.test.ts"), "export {};");
      },
      async (root) => {
        const files = await collectFiles({
          baseDir: root,
          extensions: [".ts"],
          ignorePatterns: ["*.test.*"],
          recursive: true,
        });
        const names = files.map((f) => f.name).sort();

        assertEquals(names, ["inner.ts", "keep.ts"]);
      },
    );
  });

  it("still prunes whole subtrees for literal directory-name ignores", async () => {
    await withFixtureTree(
      (root) => {
        mkdirSync(join(root, "__ignored__"));
        writeFileSync(join(root, "__ignored__", "nested.ts"), "export {};");
        writeFileSync(join(root, "keep.ts"), "export {};");
      },
      async (root) => {
        const files = await collectFiles({
          baseDir: root,
          extensions: [".ts"],
          ignorePatterns: ["__ignored__"],
          recursive: true,
        });

        assertEquals(files.map((f) => f.name), ["keep.ts"]);
      },
    );
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
});
